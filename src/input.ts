import { allowsBackspace, awaitingSubmit, blocksOnError, carriedKey, failureFor, refusesSpace, replayAttempt } from './typing.js';
import type { Attempt, AttemptEvent } from './typing.js';
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
  const now = () => performance.now();
  const attempt = (type: InputSurface) => type === 'online' ? online?.attempt ?? null : owner.attempt(type);

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
    owner.start(current, type, at);
    const replay = replayAttempt(current);
    const offsetMs = offsetFor(type, at);
    const position = replay.typed.length;
    const unresolved = blocksOnError(current.conditions.correctionPolicy) && position > 0 && replay.typed.at(-1) !== current.text[position - 1];

    if (unresolved) { current.events.push({ type: 'blocked-insert', text: char, position: position - 1, offsetMs });

 return { previousLength: position, blocked: 'unresolved' }; }

    if (awaitingSubmit(current, replay.typed)) {
      if (char !== ' ') return { previousLength: position, blocked: 'submit' };
      current.events.push({ type: 'submit', offsetMs });

      return { previousLength: position, blocked: false, submit: true };
    }

    if (refusesSpace(current.conditions, current.text, position, char)) {
      current.events.push({ type: 'insert', text: char, position, accepted: false, offsetMs });

      return { previousLength: position, blocked: 'space', correct: false, failed: failureFor(current.conditions.correctionPolicy, current.text, replay.typed, char) };
    }

    let event: AttemptEvent | null = { type: 'insert', text: char, position, accepted: true, offsetMs };

    if (carried && position >= current.text.length) event = carriedKey(current, char, offsetMs);

    if (event) current.events.push(event);
    const correct = !event || ('accepted' in event && event.accepted === true && char === current.text[position]);

    return { previousLength: position, blocked: false, correct, failed: failureFor(current.conditions.correctionPolicy, current.text, replay.typed, char) };
  }

  function typeKeys(keys: string[], type: InputSurface, at = now()) {
    if (!keys.length || !accepting(type, at)) return;
    const current = required(type);
    const room = current.text.length - replayAttempt(current).typed.length;
    const changes = keys.map((key, index) => pushInsert(key, type, at, room > 0 && index >= room));
    owner.play(keyOutcome(changes.map((change) => ({ correct: change.correct, blocked: Boolean(change.blocked) }))));
    const failure = changes.find((change) => change.failed)?.failed;

    if (changes.some((change) => change.submit)) { owner.finish(type);

 return; }

    if (failure) { current.interrupted = true; current.failed = failure; }

    const first = changes[0];
    const last = changes[changes.length - 1];

    if (first && last) owner.refresh(type, first.previousLength, last.blocked, at);

    if (failure && current.status === 'running') owner.finish(type);
  }

  const host = createTypingHost<Attempt>({
    attempt,
    typed(type) { const current = attempt(type);

 return current ? replayAttempt(current).typed : ''; },
    accepting,
    inTime: (type, at) => type === 'online' ? online?.accepting(at) ?? false : !timeUp(at),
    typeKeys,
    deleteKey(type) {
      const current = required(type);

      if (!allowsBackspace(current.conditions.correctionPolicy)) return;
      const replay = replayAttempt(current);

      if (replay.typed.length) current.events.push({ type: 'delete', count: 1, offsetMs: offsetFor(type) });
      owner.play(KEY_OUTCOME.delete);
      owner.refresh(type, replay.typed.length);
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
    attempt, offsetFor, timeUp, accepting, finishIfTimeUp,
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

export type InputController = ReturnType<typeof createInputController>;
