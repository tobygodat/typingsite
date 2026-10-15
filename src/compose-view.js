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

const $ = (id) => document.getElementById(id);
const now = () => performance.now();
const LIMIT_S = COMPOSE_LIMIT_MS / 1000;

export const COMPOSE_NOTICES = {
  paste: 'Paste is off. Type your answer.',
  edit: 'Only typed keys count, so cut, drop and undo are off.',
  lineDelete: 'Delete a letter or a word at a time.',
  selection: 'Edit at the caret. Typing or deleting over a selection is off.',
  multiCharacter: 'One key at a time.',
  repeat: 'Key repeat ignored.',
  composition: 'IME input isn’t measured. Esc to start over.',
};

export function createCompose({ setRunning, announce, save, signedIn, uid, playKeySound = () => {} }) {
  const input = $('compose-input');
  const done = $('compose-done');
  // Only where the native caret would blink; Chromium holds its own still with `caret-animation`.
  const caret = holdsCaretStill() ? null : drawCaret(input);
  let state = 'ready';
  let keys = [];
  // The text the counted keys built, edit by edit: the only source of what was typed.
  let typed = '';
  let startedAt = null;
  // The elapsed time a finished session ended at, so the clock and the heading agree.
  let endedMs = null;
  let ticker = 0;
  let interrupted = false;
  let unsupported = false;
  let inputClass = 'physical-keyboard';
  let notice = '';
  let deck = [];
  let deckIndex = -1;
  let promptId = null;

  const elapsed = () => endedMs ?? (startedAt === null ? 0 : Math.min(COMPOSE_LIMIT_MS, now() - startedAt));
  const inputLabel = () => (inputClass === 'touch' ? 'touch input' : 'physical keyboard');

  function setText(element, value) {
    const text = String(value);
    if (element.textContent !== text) element.textContent = text;
  }

  function nextPrompt() {
    deckIndex += 1;
    if (deckIndex >= deck.length) {
      deck = promptDeck(Math.random, promptId);
      deckIndex = 0;
    }
    promptId = deck[deckIndex];
    $('compose-prompt').textContent = promptText(promptId);
  }

  function renderConditions() {
    setText($('compose-conditions'), `composing · up to ${LIMIT_S} s · ${inputLabel()} · not compared with copy tests`);
  }

  function renderPrivacy() {
    setText($('compose-privacy'), signedIn()
      ? 'Your words are never saved. Only the numbers go to your history.'
      : 'Your words are never saved. Only the numbers are kept, for this tab.');
  }

  function showNotice(message, { sticky = false } = {}) {
    if (sticky) notice = message;
    setText($('compose-help'), message);
    announce(message);
  }

  // Running, whole seconds left round up, like a countdown; finished, the time used rounds the
  // same way as the result heading, so the two always add up to the minute.
  function renderClock() {
    const spent = elapsed();
    const ended = endedMs !== null;
    const left = ended ? LIMIT_S - Math.round(spent / 1000) : Math.max(0, Math.ceil((COMPOSE_LIMIT_MS - spent) / 1000));
    setText($('compose-timer'), left);
    const percent = Math.round((spent / COMPOSE_LIMIT_MS) * 100);
    $('compose-progress-bar').style.setProperty('--progress', String(spent / COMPOSE_LIMIT_MS));
    const track = $('compose-progress');
    track.setAttribute('aria-valuenow', String(percent));
    let label = `${left} seconds left`;
    if (startedAt === null) label = 'Not started';
    else if (ended) label = `Ended after ${LIMIT_S - left} seconds`;
    track.setAttribute('aria-valuetext', label);
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
  function record(inputType, data) {
    if (unsupported) return;
    // A counted key that changed nothing (for example at the length cap) is not a keystroke.
    if (keyedEdit(inputType) && input.value === typed) return;
    const kind = keyedChange(typed, input.value, { inputType, data });
    if (!kind) {
      markUnsupported();
      return;
    }
    keys.push({ type: kind, at: now() - startedAt });
    typed = input.value;
    playKeySound(kind === "delete" ? "delete" : "correct");
  }

  function resultHeading(summary, endedBy, counted) {
    if (state === 'interrupted') return 'Interrupted · not saved';
    if (unsupported) return 'IME input · not measured or saved';
    if (!counted) return summary.activeMs < COMPOSE_MIN_ACTIVE_MS ? 'Too short to measure · not saved' : 'No text left to measure · not saved';
    return endedBy === 'time' ? `Time’s up at ${LIMIT_S} s` : `Finished after ${Math.round(summary.elapsedMs / 1000)} s`;
  }

  function renderResult(summary, { endedBy, counted, saved }) {
    setText($('compose-result-heading'), resultHeading(summary, endedBy, counted));
    // IME text was never keyed, so neither rate means anything.
    setText($('compose-wpm'), unsupported ? '—' : summary.wpm ?? '—');
    setText($('compose-backspace'), unsupported ? '—' : summary.backspaceRate ?? '—');
    setText($('compose-active'), (summary.activeMs / 1000).toFixed(1));
    setText($('compose-characters'), summary.characters);
    setText($('compose-definition'), 'Free-typing wpm: characters in your text ÷ 5, per minute of active typing (a pause over 2\u00a0s counts as your average gap). '
      + `Backspace rate: ${summary.backspaces} of ${summary.keystrokes} ${summary.keystrokes === 1 ? 'keystroke was' : 'keystrokes were'} backspace or delete, held repeats included. `
      + 'Never compared with copy tests, and never a best.');
    let status = notice;
    if (counted) {
      if (saved === false) status = 'Couldn’t save on this device.';
      else status = signedIn() ? 'Saved to your history: these numbers, not your words.' : 'Kept for this tab: these numbers, not your words.';
    } else if (!notice) {
      status = summary.activeMs < COMPOSE_MIN_ACTIVE_MS
        ? `A speed needs at least ${COMPOSE_MIN_ACTIVE_MS / 1000} s of active typing.`
        : 'The field was empty at the end, so there is no speed.';
    }
    setText($('compose-saved'), status);
    $('compose-result').hidden = false;
    $('compose-footer').hidden = true;
  }

  function finish(endedBy, { focus = true } = {}) {
    if (state !== 'running') return;
    clearInterval(ticker);
    ticker = 0;
    const elapsedMs = endedBy === 'time' ? COMPOSE_LIMIT_MS : elapsed();
    // A field that no longer holds what the keys built was changed with no input event at all.
    if (input.value !== typed) markUnsupported();
    // Only the recorded text is ever scored; an unsupported session just shows what the field holds.
    const summary = composeSummary({ keys, text: unsupported ? input.value : typed, elapsedMs });
    endedMs = summary.elapsedMs;
    state = interrupted ? 'interrupted' : 'complete';
    // Read-only and out of the tab order: a finished field has no caret to show focus with.
    input.readOnly = true;
    input.tabIndex = -1;
    $('compose-form').dataset.state = 'done';
    caret?.update();
    renderClock();
    setRunning(false);
    const counted = state === 'complete' && !unsupported && summary.measurable;
    const saved = counted
      ? save(compositionRecord(summary, { id: uid(), at: new Date().toISOString(), promptId, inputClass, endedBy }))
      : null;
    renderResult(summary, { endedBy, counted, saved });
    if (focus) $('compose-next').focus();
    announce(counted
      ? `${summary.wpm} wpm free-typing speed, ${summary.backspaceRate}% backspace rate.${saved === false ? ' Couldn’t save on this device.' : ''}`
      : `${$('compose-result-heading').textContent}.`);
  }

  function restart({ focus = true } = {}) {
    clearInterval(ticker);
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
    input.value = '';
    input.readOnly = false;
    input.removeAttribute('tabindex');
    $('compose-form').dataset.state = 'ready';
    caret?.update();
    done.disabled = true;
    $('compose-result').hidden = true;
    $('compose-footer').hidden = false;
    setText($('compose-help'), '');
    renderConditions();
    renderPrivacy();
    renderClock();
    setRunning(false);
    if (focus) input.focus({ preventScroll: true });
  }

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
  });

  // Counted after the change lands, so a key the field refused (for example at its length cap) never counts.
  input.addEventListener('input', (event) => {
    if (state === 'complete' || state === 'interrupted') return;
    const type = event.inputType || '';
    if (state === 'ready') start();
    if (type.includes('Composition') || event.isComposing) markUnsupported();
    else record(type, event.data);
    done.disabled = false;
    if (!notice) setText($('compose-help'), '');
    setRunning(true);
  });

  input.addEventListener('compositionstart', () => {
    if (state === 'complete' || state === 'interrupted') return;
    if (state === 'ready') start();
    markUnsupported();
  });

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
  });

  input.addEventListener('paste', (event) => {
    event.preventDefault();
    if (state === 'ready' || state === 'running') showNotice(COMPOSE_NOTICES.paste);
  });
  input.addEventListener('drop', (event) => {
    event.preventDefault();
    if (state === 'ready' || state === 'running') showNotice(COMPOSE_NOTICES.edit);
  });

  // Only a touch on the writing field before the first key marks the session as touch input, as on
  // the practice field; a tap on a button (Another prompt, Write another) types nothing.
  input.addEventListener('pointerdown', (event) => {
    if (event.pointerType !== 'touch' || state !== 'ready') return;
    inputClass = 'touch';
    renderConditions();
  });
  $('compose-form').addEventListener('submit', (event) => event.preventDefault());
  done.addEventListener('click', () => finish('done'));
  $('compose-restart').addEventListener('click', () => restart());
  $('compose-another').addEventListener('click', () => { nextPrompt(); restart(); });
  $('compose-next').addEventListener('click', () => { nextPrompt(); restart(); });
  $('compose-retry').addEventListener('click', () => restart());

  return {
    open({ focus = true } = {}) {
      if (!promptId) nextPrompt();
      restart({ focus });
    },
    // Leaving composing drops whatever was typed; nothing was stored for an unfinished session.
    close() {
      clearInterval(ticker);
      ticker = 0;
      state = 'ready';
      keys = [];
      typed = '';
      startedAt = null;
      endedMs = null;
      input.value = '';
    },
    restart,
    another() {
      nextPrompt();
      restart();
    },
    focus() {
      if (state === 'complete' || state === 'interrupted') $('compose-next').focus({ preventScroll: true });
      else input.focus({ preventScroll: true });
    },
    // Focus loss, the palette or the suggestion dialog mid-way: it can finish, but it won't be saved.
    interrupt(message, { end = false } = {}) {
      if (state !== 'running') return;
      if (!interrupted) {
        interrupted = true;
        showNotice(message, { sticky: true });
      }
      // Ended by leaving the screen: the result waits there, and focus stays where you went.
      if (end) finish('done', { focus: false });
    },
    refreshAccount: renderPrivacy,
    isRunning: () => state === 'running',
    get promptId() { return promptId; },
  };
}
