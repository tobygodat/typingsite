import { useSyncExternalStore } from 'react';
import { flushSync } from 'react-dom';
import { QUEUE_IDLE, queueStep, queued, ratingChangeLine, ratingLine } from './quick-match.js';
import type { QueueEvent, QueueReply, QueueState, Rating } from './quick-match.js';
import { quickMatch } from './multiplayer.js';
import type { QuickMatchReply } from './multiplayer.js';
import type { Session } from './network.js';
import { createStore } from './store.js';

const TOLD = 'stilltype-quick-match-told:';
const SEEN = 'stilltype-quick-match-seen:';

type LastRating = Extract<QuickMatchReply, { last?: object }>;

type DisplayRating = Rating & { last?: LastRating['last'] };

interface QuickMatchView { label: string; status: string; rating: string; lonely: boolean; best: boolean; signedIn: boolean }

interface QuickMatchOptions {
  getSession(): Session | null;
  signIn(): void;
  racerName(): string;
  enterRoom(result: Extract<QueueReply, { state: 'paired' }>): void;
  busyElsewhere(): boolean;
  ownBest(): boolean;
  raceOwnBest(): void;
}

type TimedEvent = Extract<QueueEvent, { now: number }>;

type DispatchEvent = Exclude<QueueEvent, TimedEvent> | Omit<Extract<QueueEvent, { type: 'reply' }>, 'now'> | { type: 'tick' | 'keep-waiting' };

export function createQuickMatch() {
  const view = createStore<QuickMatchView>({ label: 'Find a race', status: '', rating: '', lonely: false, best: false, signedIn: false });
  let options: QuickMatchOptions | null = null;
  let state: QueueState = QUEUE_IDLE;
  let requests = Promise.resolve();
  let pollTimer = 0;
  let tickTimer = 0;
  let rating: DisplayRating | null = null;
  let notice = '';
  let disposed = false;
  const getSession = () => options?.getSession() ?? null;

  const sessionIdentity = () => { const session = getSession();

 return session ? `${session.user.id}:${session.signInId || ''}` : null; };

  const seenKey = () => `${SEEN}${getSession()?.user.id}`;

  function markSeen(roomId: string) {
    try { localStorage.setItem(seenKey(), roomId); } catch {}
  }

  function lastResult() {
    const last = rating?.last;

    if (!last?.roomId || !getSession()) return '';

    try { if (localStorage.getItem(seenKey()) === last.roomId) return ''; } catch {}

    return ratingChangeLine(last);
  }

  function render() {
    if (disposed) return;
    const searching = queued(state);
    const best = state.phase === 'lonely' && Boolean(options?.ownBest());
    let status = '';

    switch (state.phase) {
      case 'joining': case 'waiting': status = notice || 'Looking for a racer near your rating.'; break;
      case 'lonely': status = best ? 'Nobody else is looking right now.' : 'Nobody else is looking right now, and this device has no 30-second run of yours to race.'; break;
      case 'unavailable': case 'failed': status = state.message; break;
      case 'idle': status = lastResult(); break;
    }

    flushSync(() => view.publish({ label: searching ? 'Stop looking' : 'Find a race', status, rating: getSession() ? ratingLine(rating) : '', lonely: state.phase === 'lonely', best, signedIn: Boolean(getSession()) }));

    if (searching && !tickTimer) tickTimer = window.setInterval(() => dispatch({ type: 'tick' }), 1000);
    else if (!searching && tickTimer) { clearInterval(tickTimer); tickTimer = 0; }
  }

  // Queue requests settle in order; Stop reaches the service after the poll it overtook.
  function send(type: 'queue' | 'unqueue', ticket: number) {
    const session = getSession();
    const identity = sessionIdentity();
    const data = type === 'queue' ? { displayName: options?.racerName() ?? 'Racer' } : {};
    requests = requests.then(async () => {
      if (disposed) return;

      try {
        const result = await quickMatch(session, type, data);

        if (disposed || sessionIdentity() !== identity) return;

        if ('state' in result && result.state === 'waiting') rating = { rating: result.rating, races: result.races };

        if (type === 'queue') dispatch({ type: 'reply', ticket, result: 'state' in result && result.state !== 'idle' ? result : undefined });
      } catch (error) {
        if (disposed || sessionIdentity() !== identity || type !== 'queue') return;
        dispatch({ type: 'fail', ticket, message: error instanceof Error && error.message ? error.message : 'The race service is unavailable. Try again.', unavailable: error instanceof Error && 'unavailable' in error && Boolean(error.unavailable) });
      }
    });
  }

  function dispatch(event: DispatchEvent) {
    if (disposed) return;
    const timed = { now: Date.now(), ...event };
    const step = queueStep(state, timed);
    state = step.state;

    for (const effect of step.effects) {
      if ('send' in effect) send(effect.send, effect.ticket);

      if ('poll' in effect) {
        clearTimeout(pollTimer);
        pollTimer = window.setTimeout(() => { if (queued(state) && state.ticket === effect.ticket) send('queue', effect.ticket); }, effect.poll);
      }

      if ('enter' in effect) { options?.enterRoom(effect.enter); state = queueStep(state, { type: 'entered' }).state; }

      if ('raceBest' in effect) options?.raceOwnBest();
    }

    if (!queued(state)) notice = '';
    render();
  }

  function press(action: 'toggle' | 'keep' | 'best') {
    if (!options || disposed) return;

    if (action === 'keep') { dispatch({ type: 'keep-waiting' });

 return; }

    if (action === 'best') { dispatch({ type: 'race-best' });

 return; }

    if (!getSession()) { options.signIn();

 return; }

    if (!queued(state) && options.busyElsewhere()) {
      flushSync(() => view.publish({ ...view.getSnapshot(), status: 'Leave your current race first.' }));

      return;
    }

    if (!queued(state)) {
      const key = `${TOLD}${getSession()?.user.id}`;
      let told = false;

      try { told = Boolean(localStorage.getItem(key));

 if (!told) localStorage.setItem(key, '1'); } catch {}

      if (!told) notice = `The other racer sees your race name, ${options.racerName()}, and your keystroke timing in this race.`;

      if (rating?.last?.roomId) markSeen(rating.last.roomId);
    }

    dispatch({ type: 'press' });
  }

  return {
    view, press, render,
    configure(next: QuickMatchOptions) { options = next; disposed = false; render(); },
    leave() { dispatch({ type: 'leave' }); },
    get searching() { return queued(state); },
    seen: markSeen,
    async refresh() {
      const session = getSession();
      const identity = sessionIdentity();

      if (!session) { rating = null; render();

 return; }

      try {
        const result = await quickMatch(session, 'rating');

        if (disposed || sessionIdentity() !== identity) return;
        rating = 'rating' in result ? result : null;
      } catch { if (disposed || sessionIdentity() !== identity) return; rating = null; }

      render();
    },
    dispose() { disposed = true; clearTimeout(pollTimer); clearInterval(tickTimer); tickTimer = 0; },
  };
}

export type QuickMatchController = ReturnType<typeof createQuickMatch>;

export function QuickMatch({ controller }: { controller: QuickMatchController }) {
  const view = useSyncExternalStore(controller.view.subscribe, controller.view.getSnapshot, controller.view.getSnapshot);

  return <section id="quick-match" className="quick-match" aria-labelledby="quick-match-heading">
    <div className="quick-match-head"><h2 id="quick-match-heading" tabIndex={-1}>Quick match</h2><p className="quick-match-rating num" data-quick-part="rating" hidden={!view.rating}>{view.rating}</p><p className="quick-match-rating" data-guest="" hidden={view.signedIn}>Sign in to be matched.</p></div>
    <button className="btn btn-primary quick-match-go" type="button" data-quick="toggle" data-quick-part="toggle" onClick={() => controller.press('toggle')}>{view.label}</button>
    <p className="online-copy quick-match-status" role="status" data-quick-part="status">{view.status}</p>
    <div className="online-actions quick-match-lonely" data-quick-part="lonely" hidden={!view.lonely}><button className="btn btn-ghost btn-sm" type="button" data-quick="keep" onClick={() => controller.press('keep')}>Keep waiting</button><button className="btn btn-ghost btn-sm" type="button" data-quick="best" data-quick-part="best" hidden={!view.best} onClick={() => controller.press('best')}>Race your best run</button></div>
  </section>;
}
