import type { CSSProperties } from 'react';
import { useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import { flushSync } from 'react-dom';
import { createStore } from './store.js';
import type { ComposeKey, CompositionSummary } from './compose.js';
import type { CompositionRecord } from './profile-types.js';
import type { KeyOutcome } from './sound.js';

type EndedBy = 'time' | 'done';

interface ComposeOptions {
  setRunning(running: boolean): void;
  announce(message: string): void;
  save(record: CompositionRecord): boolean;
  signedIn(): boolean;
  uid(): string;
  playKeySound(outcome: KeyOutcome): void;
}

interface ComposeResult { heading: string; summary: CompositionSummary; wpm: number | null; backspaceRate: number | null; status: string }

interface ComposeView { prompt: string; conditions: string; privacy: string; help: string; seconds: number; progress: number; progressLabel: string; doneDisabled: boolean; finished: boolean; result: ComposeResult | null }

// The composing surface on the practice screen: prompt, free-typing field, a one-minute limit and
// the result. Only compositionRecord() numbers leave this module (through `save`); the text stays
// in the field until the next start and is never written anywhere.
import {
  COMPOSE_LIMIT_MS,
  COMPOSE_MIN_ACTIVE_MS,
  composeSummary,
  compositionRecord,
  keyedChange,
  keyedEdit,
  promptDeck,
  promptText,
  refusedEdit,
} from './compose.js';
import { drawCaret, holdsCaretStill } from './compose-caret.js';
import { KEY_OUTCOME } from './sound.js';
import { formatSpeed, unitText } from './units.js';

const now = () => performance.now();
const LIMIT_S = COMPOSE_LIMIT_MS / 1000;

const COMPOSE_NOTICES = {
  paste: 'Paste is off. Type your answer.',
  edit: 'Only typed keys count, so cut, drop and undo are off.',
  lineDelete: 'Delete a letter or a word at a time.',
  selection: 'Edit at the caret. Typing or deleting over a selection is off.',
  multiCharacter: 'One key at a time.',
  repeat: 'Key repeat ignored.',
  composition: 'IME input isn’t measured. Esc to start over.',
};

export function createCompose() {
  let options: ComposeOptions = { setRunning() {}, announce() {}, save: () => false, signedIn: () => false, uid: () => '', playKeySound() {} };
  let native: HTMLTextAreaElement | null = null;
  let focusNext: (() => void) | null = null;
  let detach: (() => void) | null = null;
  let caret: ReturnType<typeof drawCaret> | null = null;
  const view = createStore<ComposeView>({ prompt: '', conditions: '', privacy: '', help: '', seconds: LIMIT_S, progress: 0, progressLabel: 'Not started', doneDisabled: true, finished: false, result: null });
  const publish = (patch: Partial<ComposeView>) => flushSync(() => view.publish({ ...view.getSnapshot(), ...patch }));

  function field(): HTMLTextAreaElement { if (!native) throw new Error('Composing input is detached');

 return native; }

  let state: 'ready' | 'running' | 'complete' | 'interrupted' = 'ready';
  let keys: ComposeKey[] = [];
  // The text the counted keys built, edit by edit: the only source of what was typed.
  let typed = '';
  let startedAt: number | null = null;
  // The elapsed time a finished session ended at, so the clock and the heading agree.
  let endedMs: number | null = null;
  let ticker: ReturnType<typeof setInterval> | null = null;
  let interrupted = false;
  let unsupported = false;
  let inputClass = 'physical-keyboard';
  let notice = '';
  let deck: string[] = [];
  let deckIndex = -1;
  let promptId: string | null = null;

  const elapsed = () => endedMs ?? (startedAt === null ? 0 : Math.min(COMPOSE_LIMIT_MS, now() - startedAt));
  const inputLabel = () => (inputClass === 'touch' ? 'touch input' : 'physical keyboard');

  

  function nextPrompt() {
    deckIndex += 1;

    if (deckIndex >= deck.length) {
      deck = promptDeck(Math.random, promptId);
      deckIndex = 0;
    }

    promptId = deck[deckIndex] ?? null;
    publish({ prompt: promptText(promptId) ?? '' });
  }

  function renderConditions() { publish({ conditions: 'composing · up to ' + LIMIT_S + ' s · ' + inputLabel() }); }

  function renderPrivacy() { publish({ privacy: options.signedIn() ? 'Your words are never saved. Only the numbers go to your history.' : 'Your words are never saved. Only the numbers are kept, for this tab.' }); }

  function showNotice(message: string, { sticky = false } = {}) { if (sticky) notice = message; publish({ help: message }); options.announce(message); }

  // Running, whole seconds left round up, like a countdown; finished, the time used rounds the
  // same way as the result heading, so the two always add up to the minute.
  function renderClock() {
    const spent = elapsed();
    const ended = endedMs !== null;
    const left = ended ? LIMIT_S - Math.round(spent / 1000) : Math.max(0, Math.ceil((COMPOSE_LIMIT_MS - spent) / 1000));
    publish({ seconds: left, progress: spent / COMPOSE_LIMIT_MS,
      progressLabel: startedAt === null ? 'Not started' : ended ? 'Ended after ' + (LIMIT_S - left) + ' seconds' : left + ' seconds left' });
  }

  function tick() {
    renderClock();

    if (elapsed() >= COMPOSE_LIMIT_MS) finish('time');
  }

  function start() {
    state = 'running';
    startedAt = now();
    ticker = setInterval(tick, 100);
    renderClock();
  }

  function markUnsupported() {
    if (unsupported) return;
    unsupported = true;
    showNotice(COMPOSE_NOTICES.composition, { sticky: true });
  }

  // A key counts only when the field changed by exactly that key at one place. Any other change,
  // whatever its input type, fails closed: the session is unsupported input and is never scored.
  function record(inputType: string, data: string | null) {
    if (unsupported) return;

    // A counted key that changed nothing (for example at the length cap) is not a keystroke.
    if (keyedEdit(inputType) && field().value === typed) return;
    const kind = keyedChange(typed, field().value, { inputType, data });

    if (!kind) {
      markUnsupported();

      return;
    }

    if (startedAt === null) return;
    keys.push({ type: kind, at: now() - startedAt });
    typed = field().value;
    options.playKeySound(kind === 'delete' ? KEY_OUTCOME.delete : KEY_OUTCOME.correct);
  }

  function resultHeading(summary: CompositionSummary, endedBy: EndedBy, counted: boolean) {
    if (state === 'interrupted') return 'Interrupted · not saved';

    if (unsupported) return 'IME input · not measured or saved';

    if (!counted) return summary.activeMs < COMPOSE_MIN_ACTIVE_MS ? 'Too short to measure · not saved' : 'No text left to measure · not saved';

    return endedBy === 'time' ? `Time’s up at ${LIMIT_S} s` : `Finished after ${Math.round(summary.elapsedMs / 1000)} s`;
  }

  function renderResult(summary: CompositionSummary, { endedBy, counted, saved }: { endedBy: EndedBy; counted: boolean; saved: boolean | null }) {
    let status = notice;

    if (counted) {
      if (saved === false) status = 'Couldn’t save on this device.';
      else status = options.signedIn() ? 'Saved to your history: these numbers, not your words.' : 'Kept for this tab: these numbers, not your words.';
    } else if (!notice) status = summary.activeMs < COMPOSE_MIN_ACTIVE_MS
      ? 'A speed needs at least ' + COMPOSE_MIN_ACTIVE_MS / 1000 + ' s of active typing.' : 'The field was empty at the end, so there is no speed.';
    publish({ result: { heading: resultHeading(summary, endedBy, counted), summary,
      wpm: unsupported ? null : summary.wpm, backspaceRate: unsupported ? null : summary.backspaceRate, status } });
  }

  function finish(endedBy: EndedBy, { focus = true } = {}) {
    if (state !== 'running') return;
    clearInterval(ticker ?? undefined);
    ticker = null;
    const elapsedMs = endedBy === 'time' ? COMPOSE_LIMIT_MS : elapsed();

    // A field that no longer holds what the keys built was changed with no input event at all.
    if (field().value !== typed) markUnsupported();
    // Only the recorded text is ever scored; an unsupported session just shows what the field holds.
    const summary = composeSummary({ keys, text: unsupported ? field().value : typed, elapsedMs });
    endedMs = summary.elapsedMs;
    state = interrupted ? 'interrupted' : 'complete';
    // Read-only and out of the tab order: a finished field has no caret to show focus with.
    field().readOnly = true;
    field().tabIndex = -1;
    publish({ finished: true });
    caret?.update();
    renderClock();
    options.setRunning(false);
    const counted = state === 'complete' && !unsupported && summary.measurable;

    const saved = counted
      ? options.save(compositionRecord(summary, { id: options.uid(), at: new Date().toISOString(), promptId, inputClass, endedBy }))
      : null;

    renderResult(summary, { endedBy, counted, saved });

    if (focus) focusNext?.();
    options.announce(counted
      ? `${formatSpeed(summary.wpm ?? 0)} free-typing speed, ${summary.backspaceRate}% backspace rate.${saved === false ? ' Couldn’t save on this device.' : ''}`
      : `${view.getSnapshot().result?.heading ?? ''}.`);
  }

  function restart({ focus = true } = {}) {
    clearInterval(ticker ?? undefined);
    ticker = 0;
    state = 'ready';
    keys = [];
    typed = '';
    startedAt = null;
    endedMs = null;
    interrupted = false;
    unsupported = false;
    notice = '';
    // Each session starts as a physical keyboard, like a practice attempt.
    inputClass = 'physical-keyboard';
    field().value = '';
    field().readOnly = false;
    field().removeAttribute('tabindex');
    publish({ finished: false });
    caret?.update();
    publish({ doneDisabled: true, result: null, help: '' });
    renderConditions();
    renderPrivacy();
    renderClock();
    options.setRunning(false);

    if (focus) field().focus({ preventScroll: true });
  }

  function attach(input: HTMLTextAreaElement, next: () => void) {
    detach?.();
    native = input;
    focusNext = next;
    const controller = new AbortController();
    const { signal } = controller;
    caret = holdsCaretStill() ? null : drawCaret(input);
  input.addEventListener('beforeinput', (event) => {
    if (state === 'complete' || state === 'interrupted') {
      event.preventDefault();

      return;
    }

    if (state === 'running' && elapsed() >= COMPOSE_LIMIT_MS) {
      event.preventDefault();
      finish('time');

      return;
    }

    const type = event.inputType || '';

    if (type.includes('Composition') || event.isComposing) return;
    // Typing and deleting at the caret are measured; anything else that changes the text is refused.
    const refused = refusedEdit({ inputType: type, data: event.data, selectionStart: input.selectionStart, selectionEnd: input.selectionEnd });

    if (!refused) return;
    event.preventDefault();

    // A refusal the browser can't cancel lands anyway, uncounted, so nothing after it is measured.
    if (!event.defaultPrevented) markUnsupported();
    else showNotice(COMPOSE_NOTICES[refused]);
  }, { signal });

  // Counted after the change lands, so a key the field refused (for example at its length cap) never counts.
  input.addEventListener('input', (event) => {
    if (state === 'complete' || state === 'interrupted') return;
    const type = event.inputType || '';

    if (state === 'ready') start();

    if (type.includes('Composition') || event.isComposing) markUnsupported();
    else record(type, event.data);
    publish({ doneDisabled: false });

    if (!notice) publish({ help: '' });
    options.setRunning(true);
  }, { signal });

  input.addEventListener('compositionstart', () => {
    if (state === 'complete' || state === 'interrupted') return;

    if (state === 'ready') start();
    markUnsupported();
  }, { signal });

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      finish('done');

      return;
    }

    // A held key would type faster than any hand; Backspace may repeat, since deleting isn't speed.
    if (event.repeat && (event.key.length === 1 || event.key === 'Enter') && state !== 'complete' && state !== 'interrupted') {
      event.preventDefault();
      showNotice(COMPOSE_NOTICES.repeat);
    }
  }, { signal });

  input.addEventListener('paste', (event) => {
    event.preventDefault();

    if (state === 'ready' || state === 'running') showNotice(COMPOSE_NOTICES.paste);
  }, { signal });
  input.addEventListener('drop', (event) => {
    event.preventDefault();

    if (state === 'ready' || state === 'running') showNotice(COMPOSE_NOTICES.edit);
  }, { signal });

  // Only a touch on the writing field before the first key marks the session as touch input, as on
  // the practice field; a tap on a button (Another prompt, Write another) types nothing.
  input.addEventListener('pointerdown', (event) => {
    if (event.pointerType !== 'touch' || state !== 'ready') return;
    inputClass = 'touch';
    renderConditions();
  }, { signal });

    const release = () => {
      controller.abort();
      caret?.dispose();
      caret = null;

      if (native === input) { native = null; focusNext = null; }
    };

    detach = release;

    return release;
  }

  return {
    view, attach,
    configure(next: ComposeOptions) { options = next; },
    finish,
    dispose() { clearInterval(ticker ?? undefined); ticker = null; detach?.(); detach = null; },
    open({ focus = true } = {}) {
      if (!promptId) nextPrompt();
      restart({ focus });
    },
    // Leaving composing drops whatever was typed; nothing was stored for an unfinished session.
    close() {
      clearInterval(ticker ?? undefined);
      ticker = 0;
      state = 'ready';
      keys = [];
      typed = '';
      startedAt = null;
      endedMs = null;
      field().value = '';
    },
    restart,
    another() {
      nextPrompt();
      restart();
    },
    focus() {
      if (state === 'complete' || state === 'interrupted') focusNext?.();
      else field().focus({ preventScroll: true });
    },
    // Focus loss, the palette or the suggestion dialog mid-way: it can finish, but it won't be saved.
    interrupt(message: string, { end = false } = {}) {
      if (state !== 'running') return;

      if (!interrupted) {
        interrupted = true;
        showNotice(message, { sticky: true });
      }

      // Ended by leaving the screen: the result waits there, and focus stays where you went.
      if (end) finish('done', { focus: false });
    },
    isRunning: () => state === 'running',
    get promptId() { return promptId; },
  };
}

export type ComposeController = ReturnType<typeof createCompose>;

interface ProgressStyle extends CSSProperties { '--progress': string }

export function ComposeSurface({ compose, visible = false }: { compose: ComposeController; visible?: boolean }) {
  const view = useSyncExternalStore(compose.view.subscribe, compose.view.getSnapshot, compose.view.getSnapshot);
  const input = useRef<HTMLTextAreaElement>(null);
  const next = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    const field = input.current;

    if (field) return compose.attach(field, () => next.current?.focus({ preventScroll: true }));
  }, [compose]);
  const progressStyle: ProgressStyle = { '--progress': String(view.progress) };

  return (
        <form id="compose-form" data-state={view.finished ? 'done' : 'ready'} onSubmit={(event) => event.preventDefault()} className="compose-form" autoComplete="off" noValidate hidden={!visible}>
          <div className="measure-row compose-measure">
            <div className="compose-intro">
              <p className="sr-only">Composing practice. Write in response to the prompt; there is no text to copy.</p>
              <h1 id="compose-prompt" className="compose-prompt">{view.prompt}</h1>
              <p id="compose-conditions" className="condition-copy">{view.conditions}</p>
            </div>
            <div className="compose-side">
              <button onClick={() => compose.another()} id="compose-another" className="btn btn-ghost btn-sm compose-another" type="button">Another prompt</button>
              <div className="live-stat timer-stat">
                <strong id="compose-timer" className="num">{view.seconds}</strong><span>s</span>
                <small className="sr-only">remaining</small>
              </div>
            </div>
          </div>

          <div className="compose-wrap">
            <label className="sr-only" htmlFor="compose-input">Your answer to the prompt</label>
            <textarea ref={input} id="compose-input" aria-describedby="compose-prompt compose-hint compose-privacy" maxLength={2000} spellCheck={false} autoCapitalize="sentences" autoComplete="off" autoCorrect="off" placeholder="Start typing. The minute starts with your first key."></textarea>
            <span id="compose-hint" className="sr-only">Up to 60 seconds from your first key. Press Control+Enter or Done to finish. Escape starts over.</span>
          </div>

          <div id="compose-progress" className="progress-line" role="progressbar" aria-label="Composing time used" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(view.progress * 100)} aria-valuetext={view.progressLabel}>
            <span id="compose-progress-bar" style={progressStyle}></span>
          </div>

          <div id="compose-footer" className="typing-footer compose-footer" hidden={Boolean(view.result)}>
            <div className="compose-notes">
              <p id="compose-help" className="compose-help">{view.help}</p>
              <p id="compose-privacy" className="compose-privacy">{view.privacy}</p>
            </div>
            
            <div className="typing-actions">
              <button onClick={() => compose.finish('done')} id="compose-done" className="btn btn-primary" type="button" aria-keyshortcuts="Control+Enter Meta+Enter" disabled={view.doneDisabled}>Done</button>
              <button onClick={() => compose.restart()} id="compose-restart" className="icon-control" type="button" title="Start over (Escape)" aria-label="Start over">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.34 5.66M20 4v7h-7" /></svg>
              </button>
            </div>
          </div>

          <section id="compose-result" className="compose-result" aria-labelledby="compose-result-heading" hidden={!view.result}>
            <h2 id="compose-result-heading">{view.result?.heading}</h2>
            <dl className="compose-facts">
              <div><dt>free-typing speed</dt><dd><strong id="compose-wpm" className="num" data-bare="" data-wpm={view.result?.wpm ?? undefined}>{view.result?.wpm === null || !view.result ? '—' : formatSpeed(view.result.wpm, { bare: true })}</strong><span data-speed-unit="">{unitText('{unit}')}</span></dd></div>
              <div><dt>backspace rate</dt><dd><strong id="compose-backspace" className="num">{view.result?.backspaceRate ?? '—'}</strong><span>%</span></dd></div>
              <div><dt>active typing</dt><dd><strong id="compose-active" className="num">{view.result ? (view.result.summary.activeMs / 1000).toFixed(1) : '—'}</strong><span>s</span></dd></div>
              <div><dt>characters</dt><dd><strong id="compose-characters" className="num">{view.result?.summary.characters ?? '—'}</strong></dd></div>
            </dl>
            <p id="compose-definition" className="metric-note">{view.result && <><span data-speed-unit="Free-typing {unit}: characters in your text{wpm: ÷ 5}, per minute of active typing (a pause over 2 s counts as your average gap). ">{unitText('Free-typing {unit}: characters in your text{wpm: ÷ 5}, per minute of active typing (a pause over 2 s counts as your average gap). ')}</span>{`Backspace rate: ${view.result.summary.backspaces} of ${view.result.summary.keystrokes} ${view.result.summary.keystrokes === 1 ? 'keystroke was' : 'keystrokes were'} backspace or delete, held repeats included. Never compared with copy tests, and never a best.`}</>}</p>
            <div className="compose-result-foot">
              <p id="compose-saved" className="compose-saved">{view.result?.status}</p>
              <div className="compose-result-actions">
                <button onClick={() => compose.restart()} id="compose-retry" className="btn btn-ghost" type="button">Retry this prompt</button>
                <button ref={next} onClick={() => compose.another()} id="compose-next" className="btn btn-primary" type="button">Write another</button>
              </div>
            </div>
          </section>
        </form>
  );
}
