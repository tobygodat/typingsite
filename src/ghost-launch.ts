import { accountLifetime } from './async-runtime.js';
import { challengeConditions, getChallenge, ghostPoints, validTrace } from './ghost-race.js';
import type { challengePayload } from './ghost-race.js';
import type { AccountSession } from './account-session.js';
import type { InboxController } from './inbox.js';
import type { OnlineRaceController } from './online-race.js';
import type { TrainingMemory } from './training-memory.js';
import type { createGhostResult } from './ghost-result.js';

interface LaunchPorts {
  context(): string;
  running(): boolean;
  beforeStart(): void;
  reset(): void;
  practice(): void;
  notice(message: string): void;
  ownBest(): ReturnType<typeof challengePayload>;
}

export function createGhostLaunch(accounts: AccountSession, online: OnlineRaceController, inbox: InboxController,
  training: TrainingMemory, result: ReturnType<typeof createGhostResult>, ports: LaunchPorts) {
  let request: object | null = null;
  let heldError = '';
  let disposed = false;

  function onlineRoomFirst() {
    if (!online.liveRoomId) return false;
    ports.notice('Leave your online race before starting a ghost race.');

    return true;
  }

  async function start(id: string) {
    if (disposed || onlineRoomFirst()) return;
    heldError = '';
    const current = request = { id, context: ports.context() };
    const owner = accountLifetime();
    let view: Awaited<ReturnType<typeof getChallenge>> | null = null;
    let failure: Error | null = null;

    try { view = await getChallenge(accounts.session, id); }
    catch (error) { failure = error instanceof Error ? error : new Error(String(error)); }

    if (disposed || owner !== accountLifetime() || request !== current) return;
    request = null;
    const here = ports.context() === current.context && !online.pending;
    let conditions;

    try {
      if (failure) throw failure;

      if (!view || view.role !== 'received' || view.status !== 'open' || typeof view.passage !== 'string' || !validTrace(view.trace)) {
        throw new Error(view?.status === 'done' ? 'You have already raced this run.'
          : view?.status === 'expired' ? 'This ghost race has expired.' : 'That ghost race is unavailable.');
      }

      conditions = challengeConditions(view.conditions, view.duration ?? null);

      if (!conditions) throw new Error('This ghost race was recorded with settings this app can’t reproduce, so it can’t be raced fairly.');
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);

      if (here) ports.notice(reason);
      else {
        const message = `${view?.name ? `${view.name}’s race` : 'The ghost race'} didn’t start. ${reason}`;

        if (ports.running()) heldError = message;
        else ports.notice(message);
      }

      return;
    }

    if (!here) { inbox.offer(`challenge:${id}`, `${view.name}’s race is ready.`);

      return; }

    ports.beforeStart();
    result.race = { id, name: view.name, passage: view.passage, conditions, duration: view.duration ?? null,
      points: ghostPoints(view.trace, view.passage.length), sender: view.sender, result: null, run: null, state: 'ready' };
    training.baseline = null;
    training.context = null;
    inbox.settle(`challenge:${id}`);
    ports.reset();
  }

  function own() {
    if (disposed) return;
    const best = ports.ownBest();

    if (!best || onlineRoomFirst()) return;
    ports.beforeStart();

    if (typeof best.passage !== 'string') throw new TypeError('A native ghost race requires recorded text');
    result.race = { id: null, own: true, name: 'Your best run', passage: best.passage, conditions: best.conditions, duration: best.duration,
      points: ghostPoints(best.trace, best.passage.length), sender: best.score, result: null, run: null, state: 'ready' };
    training.baseline = null;
    training.context = null;
    ports.practice();
    ports.reset();
  }

  return {
    start, own,
    runChanged() {
      if (disposed || !heldError || ports.running()) return;
      const message = heldError;
      heldError = '';
      ports.notice(message);
    },
    dispose() { disposed = true; request = null; heldError = ''; },
  };
}
