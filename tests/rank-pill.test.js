import test from 'node:test';
import assert from 'node:assert/strict';
import { rankPill } from '../src/rank-pill.js';
import { createQuickMatch } from '../src/quick-match-view.js';
import { SESSION_KEY } from '../src/account.js';

const plain = (pill) => ({ ...pill, line: pill.line.replaceAll(' ', ' ') });

test('a guest, or a rating not loaded, shows no pill', () => {
  assert.equal(rankPill(null), null);
  assert.equal(rankPill(undefined), null);
});

test('the rating everyone starts with, before any rated race, shows no pill', () => {
  assert.equal(rankPill({ rating: 1500, races: 0 }), null);
});

test('a provisional rating shows its figure and how many of the ten races to a rank are run', () => {
  assert.deepEqual(plain(rankPill({ rating: 1540, races: 3 })), { rank: null, rating: 1540, lit: 3, note: '3/10 races to a rank', line: 'Race rating 1540 · 3 rated races · provisional' });
});

test('a stepped rank shows the rank and step, and how far the step is filled', () => {
  assert.deepEqual(plain(rankPill({ rating: 1920, races: 18 })), { rank: 'Gale II', rating: 1920, lit: 2, note: '80 to Gale I · 18 rated races', line: 'Gale II · 1920 · 18 rated races' });
});

test('the top rank has no step and a full ring', () => {
  assert.deepEqual(plain(rankPill({ rating: 2480, races: 60 })), { rank: 'Hurricane', rating: 2480, lit: 10, note: '60 rated races', line: 'Hurricane · 2480 · 60 rated races' });
});

test('the pill carries the racer’s own rating and nothing of anyone else’s', () => {
  const pill = rankPill({ rating: 1920, races: 18, last: { roomId: 'r1', opponent: 'Mara', opponentRating: 2210 } });
  assert.deepEqual(Object.keys(pill).sort(), ['line', 'lit', 'note', 'rank', 'rating']);
  assert.doesNotMatch(JSON.stringify(pill), /Mara|2210|Tempest/);
});

test('a sign-out in another tab takes the pill away, and a later refresh does not bring it back', async () => {
  const session = { access_token: 'a', refresh_token: 'r', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: 'u1' } };
  const store = new Map([[SESSION_KEY, JSON.stringify(session)]]);
  const originalStorage = globalThis.localStorage;
  const originalFetch = globalThis.fetch;
  let asked = 0;
  globalThis.localStorage = { getItem: (key) => store.get(key) ?? null, setItem: (key, value) => store.set(key, value), removeItem: (key) => store.delete(key) };
  globalThis.fetch = async () => { asked += 1;

    return new Response(JSON.stringify({ rating: 1920, races: 18 }), { status: 200 }); };

  try {
    const quick = createQuickMatch();
    quick.configure({ getSession: () => session, signIn() {}, racerName: () => 'Racer', enterRoom() {}, busyElsewhere: () => false, ownBest: () => false, raceOwnBest() {} });
    await quick.refresh();
    assert.equal(rankPill(quick.view.getSnapshot().mine)?.rank, 'Gale II');

    quick.signOutElsewhere();
    assert.equal(quick.view.getSnapshot().mine, null);
    const before = asked;
    await quick.refresh();
    quick.render();
    assert.equal(quick.view.getSnapshot().mine, null);
    assert.equal(asked, before);
    quick.dispose();
  } finally {
    globalThis.localStorage = originalStorage;
    globalThis.fetch = originalFetch;
  }
});
