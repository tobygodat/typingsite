// The quick match control: one element (#quick-match) with one click handler, so it can move to another
// screen as it is. The queue's states live in src/quick-match.js; this runs their effects and draws them.
import { QUEUE_IDLE, queueStep, queued, ratingLine } from './quick-match.js';
import { quickMatch } from './multiplayer.js';

const TOLD = 'stilltype-quick-match-told:';

export function createQuickMatch({ root, getSession, signIn, racerName, enterRoom, busyElsewhere, ownBest, raceOwnBest }) {
  let state = QUEUE_IDLE;
  let requests = Promise.resolve();
  let pollTimer = 0;
  let tickTimer = 0;
  let rating = null;
  let notice = '';
  const part = (name) => root.querySelector(`[data-quick-part="${name}"]`);

  // Every request of this tab's queue goes out after the one before has settled, so they reach the service
  // in order: a Stop always lands after the poll it overtook.
  function send(type, ticket) {
    const session = getSession();
    const data = type === 'queue' ? { displayName: racerName() } : {};
    requests = requests.then(() => quickMatch(session, type, data).then((result) => {
      if (result?.state === 'waiting') rating = { rating: result.rating, races: result.races };

      if (type === 'queue') dispatch({ type: 'reply', ticket, result });
    }, (error) => {
      if (type === 'queue') dispatch({ type: 'fail', ticket, message: error.message || 'The race service is unavailable. Try again.', unavailable: Boolean(error.unavailable) });
    }));
  }

  function dispatch(event) {
    const step = queueStep(state, { now: Date.now(), ...event });
    state = step.state;

    for (const effect of step.effects) {
      if (effect.send) send(effect.send, effect.ticket);

      if (effect.poll) {
        clearTimeout(pollTimer);
        pollTimer = setTimeout(() => { if (queued(state) && state.ticket === effect.ticket) send('queue', effect.ticket); }, effect.poll);
      }

      if (effect.enter) {
        enterRoom(effect.enter);
        state = queueStep(state, { type: 'entered' }).state;
      }

      if (effect.raceBest) raceOwnBest();
    }

    if (!queued(state)) notice = '';
    render();
  }

  // Said once on this device for each account: what a stranger sees.
  function tellOnce() {
    const key = `${TOLD}${getSession()?.user.id}`;

    try {
      if (localStorage.getItem(key)) return;
      localStorage.setItem(key, '1');
    } catch {}

    notice = `The other racer sees only your race name, ${racerName()}, and the race itself.`;
  }

  function render() {
    const searching = queued(state);
    const toggle = part('toggle');
    const label = searching ? 'Stop looking' : 'Quick match';

    if (toggle.textContent !== label) toggle.textContent = label;
    const best = state.phase === 'lonely' ? ownBest() : null;

    const status = {
      joining: notice || 'Looking for a racer near your rating.',
      waiting: notice || 'Looking for a racer near your rating.',
      lonely: best ? 'Nobody else is looking right now.' : 'Nobody else is looking right now, and this device has no 30-second run of yours to race.',
      unavailable: state.message,
      failed: state.message,
    }[state.phase] || '';

    if (part('status').textContent !== status) part('status').textContent = status;
    part('lonely').hidden = state.phase !== 'lonely';
    part('best').hidden = !best;
    const line = getSession() ? ratingLine(rating) : '';
    part('rating').textContent = line;
    part('rating').hidden = !line;

    if (searching && !tickTimer) tickTimer = setInterval(() => dispatch({ type: 'tick' }), 1000);
    else if (!searching && tickTimer) { clearInterval(tickTimer); tickTimer = 0; }
  }

  root.addEventListener('click', (event) => {
    const action = event.target.closest('[data-quick]')?.dataset.quick;

    if (action === 'toggle') {
      if (!getSession()) { signIn();

 return; }

      if (!queued(state) && busyElsewhere()) {
        part('status').textContent = 'Leave your current race first.';

        return;
      }

      if (!queued(state)) tellOnce();
      dispatch({ type: 'press' });
    } else if (action === 'keep') dispatch({ type: 'keep-waiting' });
    else if (action === 'best') dispatch({ type: 'race-best' });
  });

  render();

  return {
    // Leaves the queue (another room opened, or the person signed out). Changes nothing when not queued.
    leave() { dispatch({ type: 'leave' }); },
    get searching() { return queued(state); },
    async refresh() {
      const session = getSession();

      if (!session) { rating = null; render();

 return; }

      try { rating = await quickMatch(session, 'rating'); } catch { rating = null; }

      render();
    },
    render,
  };
}
