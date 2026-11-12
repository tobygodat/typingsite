import { accentComposition, composedKeys, deadMark } from './typing.js';

export type InputSurface = 'primary' | 'race' | 'online';

interface TypingInputEvent {
  inputType: string;
  data: string | null;
  isComposing: boolean;
  preventDefault(): void;
}

interface Composition<A> {
  type: InputSurface;
  attempt: A | null;
  refused: boolean;
  replaces: string | null;
  keyed: boolean;
  leaving: boolean;
  repeated: boolean;
  heldMark: string | null;
  key: string | null;
  mark: string | null;
  commit: string | null;
  at: number;
}

interface AccentPair<A> {
  type: InputSurface;
  attempt: A | null;
  key: string | null;
  mark: string | null;
  at: number;
  repeated: boolean;
}

export interface TypingPort<A> {
  attempt(type: InputSurface): A | null;
  typed(type: InputSurface): string;
  accepting(type: InputSurface, at?: number): boolean;
  inTime(type: InputSurface, at: number): boolean;
  typeKeys(keys: string[], type: InputSurface, at?: number): void;
  deleteKey(type: InputSurface): void;
  refuseComposition(type: InputSurface): void;
  unsupported(type: InputSurface): void;
  refusePaste(type: InputSurface): void;
  showRepeat(type: InputSurface): void;
  finishIfTimeUp(): void;
}

export function createTypingHost<A>(port: TypingPort<A>) {
  const now = () => performance.now();
  const inputAttempt = port.attempt;
  const acceptingInput = port.accepting;
  const typeKeys = port.typeKeys;
  const refuseComposition = port.refuseComposition;
  const refusePaste = port.refusePaste;
  const finishIfTimeUp = port.finishIfTimeUp;
  let composition: Composition<A> | null = null;
  let lostComposition: Composition<A> | null = null;
  let heldDeadKey: { mark: string | null } | null = null;
  let accentPair: AccentPair<A> | null = null;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const leases = new Map<HTMLTextAreaElement, AbortController>();

  function schedule(callback: () => void, delay: number) {
    const timer = setTimeout(() => { timers.delete(timer); callback(); }, delay);
    timers.add(timer);
  }

// What a composition committed, scored once the key that ended it is known. A mark pending when focus
// leaves is dropped, and browsers commit it on the way out: Chrome and Firefox send that key (Tab)
// before compositionend, Safari after it, and Chrome on macOS commits as a click begins, a task before
// focus moves. So a commit no key came before waits for one, or for the blur. The next key, input or
// composition on the field scores it first, so keys keep their order.
const COMMIT_KEY_WAIT_MS = 100;

// Keys pressed while composing that don't end it: the accent key itself (Safari sends its keydown after
// the mark shows) and modifiers held for the next letter.
const COMPOSING_KEYS = new Set(['Dead', 'Shift', 'Control', 'Alt', 'AltGraph', 'Meta', 'CapsLock', 'Fn']);

// Keys whose auto-repeat is a held accent key: Dead, and Process, which Chromium on Linux sends for every
// key its input method takes (the accent key among them), with the repeat flag kept.
const ACCENT_REPEAT_KEYS = new Set(['Dead', 'Process']);

function scoreCommit(type: InputSurface) {
  const session = composition?.type === type && composition.commit !== null ? composition : null;

  if (!session) return;
  composition = null;

  if (session.attempt !== inputAttempt(type) || !acceptingInput(type, session.at)) return;
  const keys = composedKeys(session.commit ?? '');

  // A held accent key commits its mark again and again (^^): ignore it, like any held key, and the
  // letter that commits the last repeated mark (â) with it. Committing the same letters back (typing on
  // past the accent menu) changes nothing; any other change to letters already scored is an input
  // method's edit, not keys. A composition no accent key opened is an input method's, even when it
  // commits one Latin letter; a cancelled one (nothing committed) types nothing.
  if (session.repeated) port.showRepeat(type);
  else if (session.replaces !== null) { if (session.commit !== session.replaces) refuseComposition(type); }
  else if (keys === null || (keys.length && !accentComposition({ key: session.key, preview: session.mark }))) refuseComposition(type);
  else typeKeys(keys, type, session.at);

  // The clock may have run out while the commit waited: the run ends now, at its limit.
  if (type === 'primary') finishIfTimeUp();
}

// A composition's end: what it committed is scored once the key that ended it is known, unless it was
// refused already or left with Tab. The field goes back to the passage.
function endComposition(session: Composition<A>, commit: string | null, type: InputSurface, input: HTMLTextAreaElement) {
  if (session.refused || session.leaving || session.attempt !== inputAttempt(type)) composition = null;
  else {
    composition = Object.assign(session, { commit: commit ?? '', at: now() });
    schedule(() => { if (composition === session) scoreCommit(type); }, session.keyed ? 0 : COMMIT_KEY_WAIT_MS);
  }

  const current = inputAttempt(type);

  if (current) input.value = port.typed(type);
}

// Stops following a composition before its compositionend. An accent key's pending mark is just dropped;
// an input method's that is still open is kept (lostComposition), so the plain text it may commit later
// is still that input method's.
function forgetComposition(type: InputSurface) {
  if (composition?.type !== type) return;

  if (composition.commit === null && !accentComposition({ key: composition.key, preview: composition.mark })) lostComposition = composition;
  composition = null;
}

// A Windows accent mark scored without the key it waited for (keys, given when that key's input came), as
// a commit is: together, at the mark's time, so on the last letter the passage can't end between them.
function scoreAccentPair(type: InputSurface, keys: string[] | null = null) {
  const pair = accentPair?.type === type && accentPair.mark !== null ? accentPair : null;

  if (!pair) return;
  accentPair = null;

  if (pair.attempt === inputAttempt(type)) typeKeys(keys ?? (pair.mark === null ? [] : [pair.mark]), type, pair.at);

  if (type === 'primary') finishIfTimeUp();
}

// WebKit sends no beforeinput for a Backspace in an empty field, so there that key would make no sound.
// It is taken from its keydown instead, in every browser, as the delete it would have been.
function backspaceInEmptyField(event: KeyboardEvent, type: InputSurface, input: HTMLTextAreaElement) {
  if (event.key !== 'Backspace' || event.isComposing || event.defaultPrevented || input.value !== '') return;
  event.preventDefault();
  beforeTypingInput({ inputType: 'deleteContentBackward', data: null, isComposing: false, preventDefault() {} }, type, input);
}

function beforeTypingInput(event: TypingInputEvent, type: InputSurface, input: HTMLTextAreaElement) {
  const compositionInput = event.inputType?.includes('Composition');

  // Safari can insert a commit's text after compositionend; that is the commit itself, not a next key.
  if (!compositionInput) scoreCommit(type);

  // Windows: the input of the key a typed mark waits for is scored with it; anything else scores the mark first.
  if (accentPair?.type === type && accentPair.mark !== null && event.inputType === 'insertText' && event.data !== null && event.data === accentPair.key) {
    event.preventDefault();
    scoreAccentPair(type, [accentPair.mark, event.data]);

    return;
  }

  scoreAccentPair(type);

  if (!acceptingInput(type)) {
    event.preventDefault();

    return;
  }

  if (event.inputType === 'insertFromPaste' || event.inputType === 'insertFromDrop') {
    event.preventDefault();
    refusePaste(type);

    return;
  }

  // A plain key with isComposing false means the composition ended without compositionend
  // (the field changed under it, or the browser dropped the event): let this key through, unless the
  // composition was an input method's (its commit, below).
  if (composition?.type === type && !event.isComposing && !compositionInput
    && (event.inputType === 'insertText' || event.inputType?.startsWith('delete'))) forgetComposition(type);

  // Composition text is scored once, after compositionend; until then the field is the browser's.
  if (compositionInput || event.isComposing || composition?.type === type) return;

  if (event.inputType?.startsWith('delete')) {
    event.preventDefault();

    port.deleteKey(type);

    return;
  }

  if (event.inputType === 'insertLineBreak') {
    event.preventDefault();

    return;
  }

  if (event.inputType !== 'insertText' || !event.data || /[\r\n]/u.test(event.data)) return;
  event.preventDefault();
  // The first text after an input method's composition that ended unseen is what it committed (Pinyin's
  // 你 after n), scored as that commit: refused, as after compositionend, and never typed as a key.
  const lost = lostComposition?.type === type ? lostComposition : null;

  if (lost) {
    lostComposition = null;

    if (lost.attempt === inputAttempt(type)) {
      endComposition(lost, event.data, type, input);

      return;
    }
  }

  // One key, or an accent mark and the letter it couldn't combine with (Windows sends both).
  const keys = [...event.data].length === 1 ? [event.data] : composedKeys(event.data);

  if (!keys) {
    if (type === 'online') return;
    port.unsupported(type);

    return;
  }

  // Windows: the key pressed after an accent key may type the mark first, with its own input to follow.
  const pair = accentPair?.type === type ? accentPair : null;

  // Windows: a held accent key's repeats arrive as plain text (^^), and so does the next key's commit of a
  // mark they left pending (â, ^h, or ^ then h): all that key types, unless it types just itself.
  if (heldDeadKey || (pair?.repeated && (pair.key === null || event.data !== pair.key))) {
    if (pair?.repeated) pair.key = null;
    port.showRepeat(type);

    return;
  }

  accentPair = null;

  if (pair && keys.length === 1 && keys[0] !== pair.key && deadMark(keys[0] ?? '') && pair.attempt === inputAttempt(type)) {
    accentPair = Object.assign(pair, { mark: keys[0] ?? null, at: now() });
    schedule(() => { if (accentPair === pair) scoreAccentPair(type); }, COMMIT_KEY_WAIT_MS);

    return;
  }

  typeKeys(keys, type);
}

// An accent key's composition is typed characters, scored after compositionend. Any other composition
// (no accent key opened it), or a preview or commit no accent key could produce, is IME text and stops
// the run counting.
function wireComposition(input: HTMLTextAreaElement, type: InputSurface, signal: AbortSignal) {
  // The last key pressed in the field: Chrome and Firefox send an accent key (Dead) before its composition.
  let lastKey: string | null = null;
  // An accent key was the last key but modifiers, and opened no composition: Windows, where the next key
  // types its mark as plain text. 'held' if it was repeating: no composition marks a mark it leaves pending.
  let afterAccent: boolean | 'held' = false;

  // Tab commits a pending mark on its way to the next control: dropped, like any mark as focus leaves.
  const drop = () => {
    composition = null;
    const current = inputAttempt(type);

    if (current) input.value = port.typed(type);
  };

  input.addEventListener('keydown', (event) => {
    const session = composition?.type === type ? composition : null;
    const repeat = event.repeat && ACCENT_REPEAT_KEYS.has(event.key);

    if (session?.commit === null) {
      // Chrome (keyCode 229 on macOS) and Firefox send the key that will end the composition first.
      if (!COMPOSING_KEYS.has(event.key)) Object.assign(session, { keyed: true, leaving: event.key === 'Tab' });

      // Safari sends the accent key's own keydown after its mark shows.
      if (event.key === 'Dead') session.key = 'Dead';

      // A held accent key's repeat adds its mark to this composition, or (Safari) is the key that opened it.
      if (repeat) Object.assign(session, { repeated: true, heldMark: null });
    } else if (session) {
      // Safari sends the key that ended a composition after compositionend.
      if (repeat && !session.keyed) session.repeated = true;

      if (event.key === 'Tab') drop();
    }

    scoreCommit(type);
    scoreAccentPair(type);
    heldDeadKey = repeat ? { mark: session?.mark ?? heldDeadKey?.mark ?? null } : null;
    lastKey = event.key;
    // Windows: the key after an accent key types the mark, then itself if they don't combine ("h; a space
    // types the mark alone). After a held one, that key (a space, or the accent key again, too) commits any
    // mark the repeats left pending, so what it types is repeat (repeated) until the next key.
    const held = afterAccent === 'held' && !repeat;

    if (!COMPOSING_KEYS.has(event.key) || event.key === 'Dead') {
      accentPair = afterAccent && composition?.type !== type
        && (held ? [...event.key].length === 1 || event.key === 'Dead' : [...event.key].length === 1 && event.key !== ' ')
        ? { type, attempt: inputAttempt(type), key: event.key, mark: null, at: 0, repeated: held } : null;
    }

    afterAccent = event.key === 'Dead' ? (repeat ? 'held' : true) : COMPOSING_KEYS.has(event.key) && afterAccent;
  }, { signal });
  // Letting go of a held accent key ends its repeats; what it left pending stays repeated.
  input.addEventListener('keyup', (event) => { if (event.key === 'Dead') heldDeadKey = null; }, { signal });
  input.addEventListener('compositionstart', (event) => {
    // A key opens one composition at most, and an accent key that opens one types nothing as plain text.
    const key = lastKey;
    lastKey = null;
    afterAccent = false;
    scoreCommit(type);
    scoreAccentPair(type);

    // A new composition: the one that ended unseen sent no commit as plain text.
    if (lostComposition?.type === type) lostComposition = null;

    if (!acceptingInput(type)) {
      composition = null;

      return;
    }

    // An accent key's mark starts as a caret after the typed text. A composition over letters already
    // typed (the macOS press-and-hold accent menu, a keyboard re-composing a word) is not new keys.
    const over = event.data || input.value.slice(input.selectionStart, input.selectionEnd);
    // Chrome and Firefox send the key that opens a composition first: a held accent key's repeat opens a
    // repeated one, and the letter that later commits its mark (â) is ignored with it.
    composition = { type, attempt: inputAttempt(type), refused: false, replaces: over || null, keyed: false, leaving: false, repeated: Boolean(heldDeadKey), heldMark: heldDeadKey?.mark ?? null, key, mark: null, commit: null, at: 0 };
  }, { signal });
  input.addEventListener('compositionupdate', (event) => {
    if (composition?.type !== type || composition.refused || composition.attempt !== inputAttempt(type)) return;

    // Safari sends a key's composition before its keydown, so one opened while an accent key is held may be
    // another accent key's: it is the held key's repeat only if it first shows that key's mark.
    if (composition.mark === null) {
      if (composition.heldMark !== null && event.data !== composition.heldMark) composition.repeated = false;
      composition.mark = event.data;
    }

    if (!acceptingInput(type)) return;

    if (composedKeys(event.data) === null) {
      composition.refused = true;
      refuseComposition(type);
    }
  }, { signal });
  input.addEventListener('compositionend', (event) => {
    // Safari sends the accent key's keydown inside its composition.
    afterAccent = false;

    // One let go first ends here after all: what it commits now is dropped, as when focus leaves.
    if (lostComposition?.type === type) lostComposition = null;

    // Hand the field back to the passage once the composition is over (finishing commits a pending mark).
    if (composition?.type === type) endComposition(composition, event.data, type, input);
    else if (inputAttempt(type)) input.value = port.typed(type);
  }, { signal });
  // Focus moving anywhere drops a mark still pending, or committed on the way out, whichever comes first.
  // A held accent key is let go out of the field's hearing; if it is still down when focus returns, its
  // repeats say so again.
  input.addEventListener('blur', () => {
    heldDeadKey = null;
    lastKey = null;
    afterAccent = false;
    forgetComposition(type);

    if (accentPair?.type === type) accentPair = null;
  }, { signal });
}


  function clearFor(type: InputSurface) {
    if (composition?.type === type) composition = null;

    if (accentPair?.type === type) accentPair = null;
    heldDeadKey = null;
  }

  function attach(input: HTMLTextAreaElement, type: InputSurface) {
    leases.get(input)?.abort();
    const controller = new AbortController();
    leases.set(input, controller);
    const { signal } = controller;
    input.addEventListener('beforeinput', (event) => beforeTypingInput(event, type, input), { signal });
    input.addEventListener('input', (event) => {
      if (event.isComposing || composition?.type === type) return;
      input.value = port.typed(type);
    }, { signal });
    wireComposition(input, type, signal);
    input.addEventListener('keydown', (event) => {
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)
        || ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a')) event.preventDefault();
      backspaceInEmptyField(event, type, input);
    }, { signal });
    input.addEventListener('paste', (event) => { event.preventDefault(); refusePaste(type); }, { signal });
    input.addEventListener('drop', (event) => event.preventDefault(), { signal });
    input.addEventListener('click', () => input.setSelectionRange(input.value.length, input.value.length), { signal });

    return () => {
      controller.abort();

      if (leases.get(input) === controller) leases.delete(input);
    };
  }

  return {
    attach,
    forget: forgetComposition,
    clearFor,
    pending(type: InputSurface = 'primary') {
      return (composition?.type === type && composition.commit !== null
        && composition.attempt === inputAttempt(type) && port.inTime(type, composition.at))
        || (accentPair?.type === type && accentPair.mark !== null
          && accentPair.attempt === inputAttempt(type) && port.inTime(type, accentPair.at));
    },
    get accentCompositionActive() {
      return Boolean(composition && !composition.refused
        && accentComposition({ key: composition.key, preview: composition.mark }));
    },
    keydown(event: KeyboardEvent, type: InputSurface, input: HTMLTextAreaElement) {
      backspaceInEmptyField(event, type, input);
    },
    dispose() {
      for (const lease of leases.values()) lease.abort();
      leases.clear();

      for (const timer of timers) clearTimeout(timer);
      timers.clear();
      composition = null;
      lostComposition = null;
      accentPair = null;
      heldDeadKey = null;
    },
  };
}
