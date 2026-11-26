import { allowsBackspace, awaitingSubmit, blocksOnError, carriedKey, failureFor, fluidWords, refusesSpace, replayFlow } from './typing.js';
import type { Attempt, AttemptEvent } from './typing.js';
import { applyWordFlowDelete, applyWordFlowDeleteWord, applyWordFlowKey, createWordFlow, linearWordDeleteCount } from './word-flow.js';
import type { WordFlowResult, WordFlowState, WordFlowStep } from './word-flow.js';
import { KEY_OUTCOME, keyOutcome } from './sound.js';
import type { KeyOutcome } from './sound.js';
import { createTypingHost } from './typing-host.js';
import type { InputSurface, OnlineTypingLease, OnlineTypingSurface } from './typing-host.js';
import { NOTICES } from './input-notices.js';

export type InputBlock = false | 'unresolved' | 'submit' | 'space';

interface InsertChange { previousLength: number; blocked: InputBlock; submit?: true; correct?: boolean; failed?: string | null }

interface InputOwner {
  attempt(type: Exclude<InputSurface, 'online'>): Attempt | null;
  origin(type: Exclude<InputSurface, 'online'>): number | null;
  durationMs(): number | null;
  start(attempt: Attempt, type: InputSurface, stamp: number): void;
  finish(type: InputSurface, elapsed?: number | null): void;
  refresh(type: InputSurface, previousLength: number, blocked?: InputBlock, at?: number): void;
  notice(type: InputSurface, message: string, options?: { sticky?: boolean; speak?: boolean }): void;
  play(outcome: KeyOutcome): void;
}

// Scoring, timing and native composition share one attempt identity for each input surface.
export function createInputController(owner: InputOwner) {
  let online: OnlineTypingSurface | null = null;
  const cursors = new WeakMap<Attempt, ReturnType<typeof replayFlow>>();
  const now = () => performance.now();
  const attempt = (type: InputSurface) => type === 'online' ? online?.attempt ?? null : owner.attempt(type);

  function flowOf(current: Attempt) {
    let cursor = cursors.get(current);

    if (!cursor) {
      cursor = replayFlow(current);
      cursors.set(current, cursor);
    }

    // Live attempts append events. The cursor consumes all new events since the previous read.
    return cursor(Infinity);
  }

  function flow(type: InputSurface): WordFlowState {
    const current = attempt(type);

    return current ? flowOf(current) : createWordFlow('');
  }

  const typed = (type: InputSurface) => flow(type).typed;

  function record(current: Attempt, { steps }: WordFlowResult, offsetMs: number) {
    for (const step of steps) current.events.push(stepEvent(step, offsetMs));

    return steps;
  }

  function required(type: InputSurface) { const current = attempt(type);

 if (!current) throw new Error(`No ${type} typing attempt`);

 return current; }

  function offsetFor(type: InputSurface = 'primary', at = now()) {
    const origin = type === 'online' ? online?.origin ?? null : owner.origin(type);

    return origin === null ? 0 : Math.max(0, at - origin);
  }

  const timeUp = (at = now()) => {
    const origin = owner.origin('primary');
    const duration = owner.durationMs();

    return origin !== null && Boolean(duration) && at - origin >= (duration ?? 0);
  };

  function accepting(type: InputSurface, at = now()) {
    const current = attempt(type);

    if (!current || current.status === 'complete' || current.status === 'interrupted') return false;

    if (type === 'online') return online?.accepting(at) ?? false;

    if (type === 'primary' && timeUp(at)) { owner.finish('primary', owner.durationMs());

 return false; }

    return true;
  }

  function finishIfTimeUp(at = now()) {
    if (attempt('primary')?.status === 'running' && timeUp(at) && !host.pending('primary')) owner.finish('primary', owner.durationMs());
  }

  function pushInsert(char: string, type: InputSurface, at: number, carried: boolean): InsertChange {
    const current = required(type);
    // Past the passage end a key is scored as in a linear run: an accent commit's carried key included.
    const flowed = fluidWords(current.conditions) && typed(type).length < current.text.length ? applyWordFlowKey(flowOf(current), char) : null;

    // A key fluid word flow ignores (a space at a word's start, a letter past the extras' limit) starts nothing.
    if (flowed && !flowed.steps.length) return { previousLength: typed(type).length, blocked: false };
    owner.start(current, type, at);
    const prefix = typed(type);
    const offsetMs = offsetFor(type, at);
    const position = prefix.length;
    const unresolved = blocksOnError(current.conditions.correctionPolicy) && position > 0 && prefix.at(-1) !== current.text[position - 1];

    if (unresolved) { current.events.push({ type: 'blocked-insert', text: char, position: position - 1, offsetMs });

 return { previousLength: position, blocked: 'unresolved' }; }

    if (awaitingSubmit(current, prefix)) {
      if (char !== ' ') return { previousLength: position, blocked: 'submit' };
      current.events.push({ type: 'submit', offsetMs });

      return { previousLength: position, blocked: false, submit: true };
    }

    if (flowed) {
      const [step] = record(current, flowed, offsetMs);
      // A space that skips the rest of the last word ends the run as it stands, as a submit would.
      const change: InsertChange = { previousLength: position, blocked: false, correct: step ? step.type === 'insert' && char === current.text[position] : undefined };

      if (step?.type === 'skip' && awaitingSubmit(current, typed(type))) {
        current.events.push({ type: 'submit', offsetMs });
        change.submit = true;
      }

      return change;
    }

    if (refusesSpace(current.conditions, current.text, position, char)) {
      current.events.push({ type: 'insert', text: char, position, accepted: false, offsetMs });

      return { previousLength: position, blocked: 'space', correct: false, failed: failureFor(current.conditions.correctionPolicy, current.text, prefix, char) };
    }

    let event: AttemptEvent | null = { type: 'insert', text: char, position, accepted: true, offsetMs };

    if (carried && position >= current.text.length) event = carriedKey(current, char, offsetMs);

    if (event) current.events.push(event);
    const correct = !event || ('accepted' in event && event.accepted === true && char === current.text[position]);

    return { previousLength: position, blocked: false, correct, failed: failureFor(current.conditions.correctionPolicy, current.text, prefix, char) };
  }

  function typeKeys(keys: string[], type: InputSurface, at = now()) {
    if (!keys.length || !accepting(type, at)) return;
    const current = required(type);
    const room = current.text.length - typed(type).length;
    const changes = keys.map((key, index) => pushInsert(key, type, at, room > 0 && index >= room));
    owner.play(keyOutcome(changes.map((change) => ({ correct: change.correct, blocked: Boolean(change.blocked) }))));
    const failure = changes.find((change) => change.failed)?.failed;

    if (changes.some((change) => change.submit)) { owner.finish(type);

 return; }

    if (failure) { current.interrupted = true; current.failed = failure; }

    const first = changes[0];
    const last = changes.at(-1);

    if (first && last) owner.refresh(type, first.previousLength, last.blocked, at);

    if (failure && current.status === 'running') owner.finish(type);
  }

  const host = createTypingHost<Attempt>({
    attempt,
    typed,
    accepting,
    inTime: (type, at) => type === 'online' ? online?.accepting(at) ?? false : !timeUp(at),
    typeKeys,
    deleteKey(type) {
      const current = required(type);

      if (!allowsBackspace(current.conditions.correctionPolicy)) return;
      const length = typed(type).length;

      if (fluidWords(current.conditions)) record(current, applyWordFlowDelete(flowOf(current)), offsetFor(type));
      else if (length) current.events.push({ type: 'delete', count: 1, offsetMs: offsetFor(type) });
      owner.play(KEY_OUTCOME.delete);
      owner.refresh(type, length);
    },
    // Option+Backspace or Ctrl+Backspace. An online race keeps its one-letter delete.
    deleteWord(type) {
      const current = required(type);

      if (!allowsBackspace(current.conditions.correctionPolicy)) return;
      const length = typed(type).length;

      if (fluidWords(current.conditions)) record(current, applyWordFlowDeleteWord(flowOf(current)), offsetFor(type));
      else if (length) current.events.push({ type: 'delete', count: type === 'online' ? 1 : linearWordDeleteCount(typed(type)), offsetMs: offsetFor(type) });
      owner.play(KEY_OUTCOME.delete);
      owner.refresh(type, length);
    },
    refuseComposition(type) {
      if (type === 'online') { owner.notice(type, NOTICES.onlineComposition);

 return; }

      const current = required(type);

      if (type === 'primary' && current.status === 'ready') owner.start(current, type, now());
      current.unsupportedInput = true;
      current.interrupted = true;
      current.events.push({ type: 'composition', offsetMs: offsetFor(type) });
      owner.notice(type, NOTICES.composition, { sticky: true });
    },
    unsupported(type) {
      const current = required(type);
      current.unsupportedInput = true;
      current.interrupted = true;
      owner.notice(type, NOTICES.multiCharacter, { sticky: true });
    },
    refusePaste: (type) => owner.notice(type, NOTICES.paste),
    showRepeat: (type) => owner.notice(type, NOTICES.repeat, { speak: false }),
    finishIfTimeUp,
  });

  return {
    attach: host.attach, forget: host.forget, clearFor: host.clearFor, pending: host.pending, keydown: host.keydown,
    get accentCompositionActive() { return host.accentCompositionActive; },
    attempt, typed, flow, offsetFor, timeUp, accepting, finishIfTimeUp,
    get online() { return online; },
    wireOnlineTyping(input: HTMLTextAreaElement, surface: OnlineTypingSurface): OnlineTypingLease {
      online = surface;
      const detach = host.attach(input, 'online');

      return { pending: () => host.pending('online'), keydown: (event) => host.keydown(event, 'online', input), dispose() { detach();

 if (online === surface) online = null; } };
    },
    dispose() { host.dispose(); online = null; },
  };
}

function stepEvent(step: WordFlowStep, offsetMs: number): AttemptEvent {
  if (step.type === 'insert') return { type: 'insert', text: step.text, position: step.position, accepted: true, offsetMs };

  if (step.type === 'delete') return { type: 'delete', count: step.count, offsetMs };

  return { ...step, offsetMs };
}

export type InputController = ReturnType<typeof createInputController>;
