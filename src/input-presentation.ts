import { RATE_FLOOR_MS, atRunEnd, awaitingSubmit, minimumStop, passageComplete, replayAttempt } from './typing.js';
import type { Attempt, MinimumFailure } from './typing.js';
import type { InputSurface } from './typing-host.js';
import type { InputBlock, InputController } from './input.js';
import type { PracticeSession } from './practice-session.js';
import type { PracticeRun } from './practice-run.js';
import type { LearningStore } from './learning-store.js';
import type { LocalRaceController } from './local-race.js';
import type { renderText } from './passage-view.js';
import { updateCharacterStates } from './passage-view.js';
import type { createTypingFx } from './motion.js';
import { bindingLabel } from './keybindings.js';
import { NOTICES } from './input-notices.js';
import { setText } from './native-copy.js';
import { showSpeed } from './units.js';

export interface NativeTypingView {
  input: HTMLTextAreaElement; characters: HTMLSpanElement[]; textView: ReturnType<typeof renderText> | null; fx: ReturnType<typeof createTypingFx>;
}

interface LiveElements { help: HTMLElement; wpm: HTMLElement; accuracy: HTMLElement; timer: HTMLElement; timerUnit: HTMLElement; timerLabel: HTMLElement; progressBar: HTMLElement; progressTrack: HTMLElement }

interface PresentationPorts {
  durationMs(): number | null; surface(type: 'primary' | 'race'): NativeTypingView;
  setRunning(on: boolean): void; announce(message: string): void;
  finishPrimary(elapsed?: number | null, options?: { stop?: MinimumFailure }): void;
}

export function createInputPresentation({ practice, learning, run, local, input, elements, ports }: {
  practice: PracticeSession; learning: LearningStore; run: PracticeRun; local: LocalRaceController;
  input: InputController; elements: LiveElements; ports: PresentationPorts;
}) {
  let primaryNotice = '';
  let liveSecond = -1;
  const race = local.state;
  const now = () => performance.now();

function startAttempt(targetAttempt: Attempt, type: InputSurface = 'primary', stamp = now()) {
  if (type === 'primary') {
    run.start(stamp);
  } else if (type === 'online') {
    // The race clock started at the shared start.
    targetAttempt.status = 'running';
  } else {
    local.startTyping(stamp);
  }
}

function showInputNotice(type: InputSurface, message: string, { sticky = false, speak = true } = {}) {
  if (learning.preferences.keybindings.restart !== 'Escape') {
    const hint = learning.preferences.keybindings.restart ? `${bindingLabel(learning.preferences.keybindings.restart)} to restart` : 'Restart shortcut is disabled';
    message = message.replace('Esc to restart', hint);
  }

  if (type === 'primary') {
    elements.help.textContent = message;

    if (sticky) primaryNotice = message;
  } else if (type === 'online') input.online?.notice(message);
  else {
    local.message(message);

    if (sticky) race.notice = message;
  }

  if (speak) ports.announce(message);
}

function withRule(sticky: string, rule: string) {
  return sticky ? `${sticky} ${rule}` : rule;
}

function refreshAfterInput(type: InputSurface, previousLength: number, blocked: InputBlock = false, at = now()) {
  const isPrimary = type === 'primary';
  const targetAttempt = input.attempt(type);

  if (!targetAttempt) throw new Error('No typing attempt to paint');
  const replay = replayAttempt(targetAttempt);
  const online = input.online;
  const view = type === 'online' ? online?.view : ports.surface(type);

  if (!view || !view.textView) return;
  const { input: field, characters, textView, fx } = view;

  field.value = replay.typed;
  field.setSelectionRange(replay.typed.length, replay.typed.length);
  textView.ensureAhead(replay.typed.length);
  updateCharacterStates(characters, replay.typed, targetAttempt.text, previousLength);
  const length = replay.typed.length;
  const lastCorrect = length > 0 && replay.typed[length - 1] === targetAttempt.text[length - 1];
  let outcome = 'delete';

  if (blocked) outcome = 'blocked';
  else if (length > previousLength) outcome = lastCorrect ? 'correct' : 'wrong';

  // A refused space is a miss at the letter it skipped: that letter is tinted until the next key,
  // so the coral caret always sits beside a tinted letter.
  if (blocked === 'space') {
    const skipped = characters[length];

    if (!skipped) throw new Error('Strict-space position is outside the rendered passage');
    skipped.className = 'char wrong';
  }

  fx.update(length, outcome, (length > 0 && !lastCorrect) || blocked === 'space');
  textView.trimBehind(length);
  const waiting = awaitingSubmit(targetAttempt, replay.typed);
  const rule = blocked === 'space' ? NOTICES.strictSpace : waiting ? NOTICES.submit : '';

  // Said once when the space is refused or the run starts waiting, and again if a key is ignored.
  if (blocked === 'space' || (waiting && (length > previousLength || blocked === 'submit'))) ports.announce(rule);

  if (isPrimary) {
    // A backspace before the first letter starts nothing. Once the run has started, every key marks it as
    // under way, which restores the mark after leaving the screen mid-run.
    if (practice.startTime !== null) ports.setRunning(true);
    elements.help.textContent = rule ? withRule(primaryNotice, rule) : blocked ? NOTICES.blocked : primaryNotice;
    updateLive(false, at);

    if (ports.durationMs() === null && passageComplete(targetAttempt, replay.typed)) ports.finishPrimary();
  } else if (type === 'online') {
    if (!online) return;
    online.notice(rule || (blocked ? NOTICES.onlineBlocked : ''));
    online.changed();

    if (passageComplete(targetAttempt, replay.typed)) online.finish();
  } else {
    const help = local.view.getSnapshot().help;

    if (rule) local.message(withRule(race.notice, rule));
    else if ([NOTICES.strictSpace, NOTICES.submit].some((notice) => help.endsWith(notice))) {
      if (race.notice) local.message(race.notice);
      else local.restartHint();
    }

    local.progress(replay);

    if (passageComplete(targetAttempt, replay.typed)) local.finish();
  }
}

function updateLive(reset = false, at = now()) {
  if (!practice.attempt) return;
  const replay = replayAttempt(practice.attempt);
  const elapsed = practice.startTime === null ? 0 : now() - practice.startTime;
  const duration = ports.durationMs();
  const boundedElapsed = duration ? Math.min(elapsed, duration) : elapsed;
  // A rate over the first second is mostly noise (one key in 5 ms reads as thousands of wpm),
  // and a number that changes every keystroke pulls the eye off the text: update once a second.
  const second = practice.startTime === null ? -1 : Math.floor(boundedElapsed / 1000);

  if (reset || second !== liveSecond) {
    liveSecond = second;
    const live = second >= 0 && boundedElapsed >= RATE_FLOOR_MS ? replayAttempt({ ...practice.attempt, endedAt: boundedElapsed }) : null;
    const score = live?.score;
    showSpeed(elements.wpm, score ? score.wpm : null);
    setText(elements.accuracy, score ? score.accuracy : '—');

    // Minimums are judged on this once-a-second tick, after the grace period, never per keystroke.
    // At the run's end (its duration, or its last character) this live check stands aside: the
    // end-of-run check in finishPrimary judges it.
    if (!reset && live && practice.attempt.minimums && practice.attempt.status === 'running' && !practice.attempt.interrupted && !practice.attempt.unsupportedInput) {
      const position = run.position(live, boundedElapsed);
      const stop = atRunEnd(position) ? null : minimumStop(practice.attempt.minimums, live, position);

      if (stop) {
        ports.finishPrimary(boundedElapsed, { stop });

        return;
      }
    }
  }

  let progress;

  if (duration) {
    const remaining = Math.max(0, Math.ceil((duration - boundedElapsed) / 1000));
    setText(elements.timer, remaining);
    setText(elements.timerUnit, 's');
    setText(elements.timerLabel, 'remaining');
    progress = boundedElapsed / duration;
  } else {
    const wordTotal = practice.attempt.text.split(' ').length;
    const wordCount = replay.typed.length === practice.attempt.text.length ? wordTotal : (replay.typed.match(/ /g) || []).length;
    setText(elements.timer, wordCount);
    setText(elements.timerUnit, `/${wordTotal}`);
    setText(elements.timerLabel, 'words');
    progress = replay.typed.length / practice.attempt.text.length;
  }

  const percent = Math.max(0, Math.min(100, progress * 100));
  elements.progressBar.style.setProperty('--progress', String(percent / 100));
  elements.progressTrack.setAttribute('aria-valuenow', String(Math.round(percent)));
  elements.progressTrack.setAttribute('aria-valuetext', reset ? 'Not started' : `${Math.round(percent)} percent complete`);
  input.finishIfTimeUp(at);
}

return { start: startAttempt, notice: showInputNotice, refresh: refreshAfterInput, live: updateLive,
  get noticeText() { return primaryNotice; }, set noticeText(value: string) { primaryNotice = value; } };
}
