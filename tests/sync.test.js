import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HISTORY, MAX_STORED_ATTEMPTS, capHistory, clearProfile, insertCloudProfile, mergeAndHold, mergeSynced, revokeClear,
  sameProfile, stampAfter, updateCloudProfile,
} from '../src/account.js';
import { MAX_PATTERN_RUNS, MAX_RUN_SUMMARIES } from '../src/insights.js';
import { conditionKey } from '../src/typing.js';

const minute = (n) => new Date(Date.UTC(2026, 9, 1, 12, 0) + n * 60000).toISOString();
const profile = (over = {}) => ({
  version: 2, profileId: 'p', preferences: { theme: 'system', fontSize: '28' },
  attempts: [], runs: [], loops: [], seenTextIds: [], bests: {}, ...over,
});
const item = (id, n, extra = {}) => ({ id, at: n === null ? null : minute(n), ...extra });
const ids = (items) => items.map((entry) => entry.id);

test('history is a union by id, ordered by date, before the caps apply', () => {
  const local = profile({ attempts: [item('a1', 1), item('a3', 3)], runs: [item('r1', 1), item('r3', 3)], loops: [item('l3', 3)] });
  const cloud = profile({ attempts: [item('a2', 2), item('a3', 3), item('a4', 4)], runs: [item('r2', 2), item('r4', 4)], loops: [item('l1', 1)] });
  const merged = mergeSynced(local, cloud);
  assert.deepEqual(ids(merged.attempts), ['a1', 'a2', 'a3', 'a4']);
  assert.deepEqual(ids(merged.runs), ['r1', 'r2', 'r3', 'r4']);
  assert.deepEqual(ids(merged.loops), ['l1', 'l3']);

  // Each side alone is within the cap; together they are not. The newest traces win, wherever they came from.
  const even = Array.from({ length: 20 }, (_, i) => item(`even-${i}`, i * 2 + 2));
  const odd = Array.from({ length: 20 }, (_, i) => item(`odd-${i}`, i * 2 + 1));
  const capped = mergeSynced(profile({ attempts: even }), profile({ attempts: odd }));
  assert.equal(capped.attempts.length, MAX_STORED_ATTEMPTS);
  assert.deepEqual(ids(capped.attempts), ids([...even, ...odd].sort((a, b) => a.at.localeCompare(b.at)).slice(-MAX_STORED_ATTEMPTS)));
  assert.deepEqual(capped.attempts.at(-1), even.at(-1));
  assert.deepEqual(capped.attempts.at(-2), odd.at(-1));

  // Run summaries: 1,000 newest across both sides, and pattern counts only on the newest 120.
  const run = (side, n) => item(`${side}-${n}`, n, { patterns: [['th', 1, 0, 0, null, null]] });
  const mine = Array.from({ length: 600 }, (_, n) => run('mine', n * 2 + 1));
  const theirs = Array.from({ length: 600 }, (_, n) => run('theirs', n * 2 + 2));
  const runs = mergeSynced(profile({ runs: mine }), profile({ runs: theirs })).runs;
  assert.equal(runs.length, MAX_RUN_SUMMARIES);
  assert.deepEqual(ids(runs).slice(-2), ['mine-1199', 'theirs-1200']);
  assert.equal(runs[0].id, 'mine-201');
  assert.equal(runs.filter((r) => r.patterns.length).length, MAX_PATTERN_RUNS);
  assert.ok(runs.slice(-MAX_PATTERN_RUNS).every((r) => r.patterns.length === 1));
});

test('undated records from older builds sort first (by id), and the fuller copy of a run is kept', () => {
  const merged = mergeSynced(
    profile({ runs: [item('old-a', null), item('new', 5, { patterns: [] })] }),
    profile({ runs: [item('old-b', null), item('new', 5, { patterns: [['th', 2, 1, 0, null, null]] })] }),
  );
  assert.deepEqual(ids(merged.runs), ['old-a', 'old-b', 'new']);
  assert.equal(merged.runs.at(-1).patterns.length, 1);
});

test('a merge never lowers a best', () => {
  const local = profile({ bests: { time30: { wpm: 80, at: minute(1) }, words25: { wpm: 60, at: minute(1) } } });
  const cloud = profile({ bests: { time30: { wpm: 70, at: minute(2) }, words25: { wpm: 90, at: minute(2) }, quote: { wpm: 50, at: minute(2) } } });
  for (const merged of [mergeSynced(local, cloud), mergeSynced(cloud, local)]) {
    assert.deepEqual(Object.fromEntries(Object.entries(merged.bests).map(([key, best]) => [key, best.wpm])), { time30: 80, words25: 90, quote: 50 });
  }
});

test('ties settle the same way whichever side merges, so copies stop rewriting the row', () => {
  // The same best speed from two runs: the earlier record stands, as a later run must beat a best.
  const laptop = profile({ bests: { k: { wpm: 72, attemptId: 'laptop-run', at: minute(3) } }, runs: [item('b', null), item('x', 2)] });
  const phone = profile({ bests: { k: { wpm: 72, attemptId: 'phone-run', at: minute(1) } }, runs: [item('a', null), item('y', 2)] });
  const merged = mergeSynced(laptop, phone);
  assert.ok(sameProfile(merged, mergeSynced(phone, laptop)));
  assert.equal(merged.bests.k.attemptId, 'phone-run');
  // Undated records, and records with the same date, order by id.
  assert.deepEqual(ids(merged.runs), ['a', 'b', 'x', 'y']);
  // With nothing else to tell them apart, the attempt id decides.
  const mine = profile({ bests: { k: { wpm: 70, attemptId: 'mine' } } });
  const theirs = profile({ bests: { k: { wpm: 70, attemptId: 'theirs' } } });
  assert.equal(mergeSynced(mine, theirs).bests.k.attemptId, 'mine');
  assert.equal(mergeSynced(theirs, mine).bests.k.attemptId, 'mine');
  // Each side merging the other's result changes nothing, so neither pushes again.
  assert.ok(sameProfile(mergeSynced(laptop, merged), merged));
  assert.ok(sameProfile(mergeSynced(phone, merged), merged));
});

test('seen passages are a union, so nothing seen is offered as fresh again', () => {
  const merged = mergeSynced(profile({ seenTextIds: ['q1', 'q2', 'daily-2026-10-01-v1'] }), profile({ seenTextIds: ['q2', 'q3'] }));
  assert.deepEqual([...merged.seenTextIds].sort(), ['daily-2026-10-01-v1', 'q1', 'q2', 'q3']);
});

test('each setting comes from the side that changed it last', () => {
  const light = { theme: 'light', fontSize: '28', mode: 'time' };
  const large = { theme: 'system', fontSize: '36', mode: 'words' };
  // The laptop changed the theme, then the phone the text size, then the laptop the test shape.
  const laptop = profile({ preferences: light, preferencesAt: { theme: minute(1), mode: minute(3) }, updatedAt: minute(9) });
  const phone = profile({ preferences: large, preferencesAt: { fontSize: minute(2), mode: minute(0) }, updatedAt: minute(4) });
  for (const merged of [mergeSynced(laptop, phone), mergeSynced(phone, laptop)]) {
    assert.deepEqual(merged.preferences, { theme: 'light', fontSize: '36', mode: 'time' });
    assert.deepEqual(merged.preferencesAt, { theme: minute(1), fontSize: minute(2), mode: minute(3) });
  }

  // A setting only one side has stamped comes from that side, even against a newer save: the other
  // side has recorded no change to it since stamps began.
  const unstamped = profile({ preferences: light, updatedAt: minute(9) });
  const stamped = profile({ preferences: large, preferencesAt: { fontSize: minute(2) }, updatedAt: minute(3) });
  assert.equal(mergeSynced(unstamped, stamped).preferences.fontSize, '36');
  assert.equal(mergeSynced(stamped, unstamped).preferences.fontSize, '36');
  // Settings neither side has stamped (profiles saved before stamps) follow the newer profile, as
  // whole-profile sync did.
  assert.equal(mergeSynced(unstamped, stamped).preferences.theme, 'light');
  assert.equal(mergeSynced(stamped, unstamped).preferences.mode, 'time');
  const stale = profile({ preferences: light, updatedAt: minute(1) });
  const fresh = profile({ preferences: large, updatedAt: minute(2) });
  assert.deepEqual(mergeSynced(stale, fresh).preferences, large);
  assert.deepEqual(mergeSynced(fresh, stale).preferences, large);
  assert.equal(mergeSynced(fresh, stale).preferencesAt, undefined);
  // With nothing to go on at all, this device keeps its own; a setting an older build lacks is filled in.
  assert.deepEqual(mergeSynced(profile({ preferences: light }), profile({ preferences: large })).preferences, light);
  const older = profile({ preferences: { theme: 'dark' } });
  assert.equal(mergeSynced(older, profile({ preferences: { theme: 'light', wordList: '1k' }, updatedAt: minute(1) })).preferences.wordList, '1k');
  // A tie keeps this device's.
  const tie = { theme: minute(5) };
  const mine = profile({ preferences: { theme: 'dark' }, preferencesAt: tie });
  assert.equal(mergeSynced(mine, profile({ preferences: { theme: 'light' }, preferencesAt: tie })).preferences.theme, 'dark');
});

test('a clear drops what the other side held from before it, without losing later work', () => {
  const marker = minute(10);
  const cleared = profile({ historyClearedAt: marker, runs: [item('after-here', 12, { textId: 'q-after-here' })], seenTextIds: ['q-after-here'] });
  // A device that hasn't heard of the clear: older history, plus one run (a daily) after the clear.
  const stale = profile({
    attempts: [item('old-a', 5)],
    runs: [item('old-r', 5, { textId: 'q-old' }), item('undated', null), item('daily-after', 11, { textId: 'daily-src', challengeDate: '2026-10-01' })],
    loops: [item('old-l', 6)],
    seenTextIds: ['q-old', 'q-shown-only', 'daily-src', 'daily-2026-10-01-v1'],
    bests: { k: { wpm: 99, at: minute(5) }, j: { wpm: 40, at: minute(11) }, legacy: { wpm: 50 } },
  });
  for (const merged of [mergeSynced(cleared, stale), mergeSynced(stale, cleared)]) {
    assert.equal(merged.historyClearedAt, marker);
    assert.deepEqual(ids(merged.attempts), []);
    assert.deepEqual(ids(merged.runs), ['daily-after', 'after-here']);
    assert.deepEqual(ids(merged.loops), []);
    assert.deepEqual(Object.keys(merged.bests), ['j']);
    // Seen ids carry no date: the stale side keeps only those its surviving runs show after the clear.
    assert.deepEqual([...merged.seenTextIds].sort(), ['daily-2026-10-01-v1', 'daily-src', 'q-after-here']);
  }
  // A side that has applied the clear keeps everything it holds; nothing is dropped twice.
  const caughtUp = mergeSynced(cleared, stale);
  const later = mergeSynced(caughtUp, profile({ historyClearedAt: marker, runs: [item('other', 13)], seenTextIds: ['q-other'] }));
  assert.deepEqual(ids(later.runs), ['daily-after', 'after-here', 'other']);
  assert.ok(later.seenTextIds.includes('q-other'));
});

test('a run the cleared best had blocked becomes the best once that best is dropped', () => {
  const conditions = { mode: 'words', count: 10, punctuation: false, wordList: '200', inputClass: 'physical-keyboard', correctionPolicy: 'relaxed' };
  const key = conditionKey(conditions);
  const run = (id, n, wpm, extra = {}) => item(id, n, { kind: 'test', status: 'complete', interrupted: false, conditions, score: { wpm, accuracy: 100 }, ...extra });
  // The stale device's 60 wpm run came after the clear but didn't beat the 90 wpm best from before it.
  const stale = profile({ runs: [run('old', 1, 90), run('slower', 12, 60), run('drill', 13, 70, { kind: 'drill' })], bests: { [key]: { wpm: 90, attemptId: 'old', at: minute(1) } } });
  const cleared = profile({ historyClearedAt: minute(10) });
  for (const merged of [mergeSynced(cleared, stale), mergeSynced(stale, cleared)]) {
    assert.deepEqual(merged.bests, { [key]: { wpm: 60, attemptId: 'slower', at: minute(12) } });
  }
  // Without a clear, history alone never changes a best.
  assert.deepEqual(mergeSynced(profile({ runs: [run('a', 1, 99)] }), profile()).bests, {});
});

test('undo restores history even after the clear has synced, and a later clear still works', () => {
  const history = profile({ runs: [item('r1', 1, { textId: 'q1' })], attempts: [item('r1', 1)], seenTextIds: ['q1'], bests: { k: { wpm: 80, at: minute(1) } } });
  const cleared = clearProfile(history);
  const marker = cleared.historyClearedAt;
  assert.ok(marker > minute(1));
  assert.deepEqual([cleared.attempts, cleared.runs, cleared.loops, cleared.seenTextIds, cleared.bests], [[], [], [], [], {}]);
  assert.deepEqual(cleared.preferences, history.preferences);
  assert.equal(cleared.historyClearedIds, undefined);
  // The clear reaches the account row and another device that had the same history.
  const row = mergeSynced(cleared, history);
  const otherDevice = mergeSynced(profile({ ...history, runs: [...history.runs, item('r2', 2)] }), row);
  assert.deepEqual(ids(row.runs), []);
  assert.deepEqual(ids(otherDevice.runs), []);

  const restored = revokeClear(cleared, history, marker);
  assert.deepEqual(restored.undoneClears, [marker]);
  assert.equal(restored.historyClearedAt, undefined);
  assert.deepEqual(ids(restored.runs), ['r1']);
  for (const merged of [mergeSynced(restored, row), mergeSynced(row, restored), mergeSynced(otherDevice, mergeSynced(restored, row))]) {
    assert.deepEqual(ids(merged.runs), ['r1']);
    assert.deepEqual(merged.seenTextIds, ['q1']);
    assert.equal(merged.bests.k.wpm, 80);
    assert.equal(merged.historyClearedAt, undefined);
  }

  // Work added after the clear, here or elsewhere, survives the undo too.
  const sinceClear = profile({ historyClearedAt: marker, runs: [item('r3', 20)] });
  assert.deepEqual(ids(revokeClear(sinceClear, history, marker).runs), ['r1', 'r3']);

  // The undone marker never applies again, but a new clear does.
  const clearedAgain = clearProfile(revokeClear(cleared, history, marker));
  assert.ok(clearedAgain.historyClearedAt > marker);
  assert.deepEqual(ids(mergeSynced(clearedAgain, mergeSynced(restored, row)).runs), []);
});

test('undo restores what the clear removed from copies the clearing tab never saw', () => {
  // The phone ran d1 and pushed it; the laptop never pulled it. The phone also holds d2, which never
  // reached the account (it was offline).
  const laptopBefore = profile({ runs: [item('l1', 1, { textId: 'ql' })], seenTextIds: ['ql'] });
  let row = profile({ runs: [item('l1', 1, { textId: 'ql' }), item('d1', 2, { textId: 'qd' })], seenTextIds: ['ql', 'qd'] });
  let phone = profile({ runs: [...row.runs, item('d2', 3, { textId: 'q2' })], seenTextIds: [...row.seenTextIds, 'q2'] });

  // The laptop clears, and its push merges the row and writes the result.
  let laptop = clearProfile(laptopBefore);
  let laptopHeld = { marker: laptop.historyClearedAt, before: laptopBefore };
  ({ merged: laptop, held: laptopHeld } = mergeAndHold(laptopHeld, laptop, row));
  row = laptop;
  assert.deepEqual(ids(row.runs), []);
  assert.deepEqual(ids(laptopHeld.before.runs), ['l1', 'd1']);

  // The phone comes back online before the undo: it hears of the clear and drops its copies.
  let phoneHeld = null;
  ({ merged: phone, held: phoneHeld } = mergeAndHold(phoneHeld, phone, row));
  row = phone;
  assert.deepEqual(ids(phone.runs), []);

  // Undo on the laptop, from what it held, reaches the row; the phone then gives back what it held.
  laptop = revokeClear(laptop, laptopHeld.before, laptopHeld.marker);
  ({ merged: row } = mergeAndHold(null, laptop, row));
  assert.deepEqual(ids(row.runs), ['l1', 'd1']);
  ({ merged: phone, held: phoneHeld } = mergeAndHold(phoneHeld, phone, row));
  assert.equal(phoneHeld, null);
  assert.deepEqual(ids(phone.runs), ['l1', 'd1', 'd2']);
  assert.deepEqual([...phone.seenTextIds].sort(), ['q2', 'qd', 'ql']);
  assert.equal(phone.historyClearedAt, undefined);
  // And the laptop's next merge with the phone's copy brings d2 there too.
  assert.deepEqual(ids(mergeAndHold(null, laptop, phone).merged.runs), ['l1', 'd1', 'd2']);

  // A clear that is never undone keeps everything it removed out, held or not.
  const kept = mergeAndHold(null, profile({ runs: [item('old', 1)] }), clearProfile(profile()));
  assert.deepEqual(ids(kept.merged.runs), []);
  assert.deepEqual(ids(kept.held.before.runs), ['old']);
  assert.deepEqual(ids(mergeAndHold(kept.held, kept.merged, profile({ historyClearedAt: kept.merged.historyClearedAt })).merged.runs), []);
});

test('a clock running ahead elsewhere can’t move a clear into the future', () => {
  const hours = (n) => new Date(Date.now() + n * 3600000).toISOString();
  // The laptop holds a run (and best) from a tablet whose clock runs 6 h fast.
  const tablet = { id: 'tablet', at: hours(5), textId: 'q-tablet' };
  const laptop = profile({ runs: [item('mine', 1), tablet], seenTextIds: ['q-tablet'], bests: { k: { wpm: 90, attemptId: 'tablet', at: hours(5) } } });
  const cleared = clearProfile(laptop);
  assert.ok(Date.parse(cleared.historyClearedAt) <= Date.now() + 1000);
  assert.deepEqual(cleared.historyClearedIds, ['tablet']);

  // A phone with a right clock hadn't heard of the clear: it still holds both, and ran again 2 h later.
  const later = { id: 'later', at: hours(2), textId: 'q-later' };
  const phone = profile({ runs: [item('mine', 1), tablet, later], seenTextIds: ['q-tablet', 'q-later'], bests: { k: { wpm: 90, attemptId: 'tablet', at: hours(5) } } });
  for (const merged of [mergeSynced(cleared, phone), mergeSynced(phone, cleared)]) {
    assert.deepEqual(ids(merged.runs), ['later']);
    assert.deepEqual(merged.seenTextIds, ['q-later']);
    assert.deepEqual(merged.bests, {});
    assert.deepEqual(merged.historyClearedIds, ['tablet']);
  }
  // Undone, the named records come back like any other.
  const restored = mergeSynced(revokeClear(cleared, laptop, cleared.historyClearedAt), phone);
  assert.deepEqual(ids(restored.runs), ['mine', 'later', 'tablet']);
  assert.equal(restored.historyClearedIds, undefined);
});

test('an undone clear stays undone however many clears follow it', () => {
  // A device applies the first clear and goes offline; elsewhere it is undone, then cleared and
  // undone 25 more times.
  const history = profile({ runs: [item('r1', 1)] });
  const first = clearProfile(history);
  let row = revokeClear(first, history, first.historyClearedAt);
  for (let n = 0; n < 25; n += 1) {
    const cleared = clearProfile(row);
    row = revokeClear(cleared, row, cleared.historyClearedAt);
  }
  assert.equal(row.undoneClears.length, 26);
  for (const back of [mergeSynced(first, row), mergeSynced(row, first)]) {
    assert.deepEqual(ids(back.runs), ['r1']);
    assert.equal(back.historyClearedAt, undefined);
  }
});

test('fields this build does not know, and profiles from older builds, survive a merge', () => {
  const local = { version: 2, profileId: 'b', preferences: { theme: 'dark' }, attempts: [item('a', 1)], goal: { daily: 10 }, updatedAt: minute(1) };
  const cloud = { version: 2, profileId: 'a', preferences: { theme: 'light' }, runs: [item('r', 2)], goal: { daily: 5 }, streak: 3, updatedAt: minute(4) };
  const merged = mergeSynced(local, cloud);
  assert.deepEqual(merged.goal, { daily: 10 }, 'this device’s copy of a shared unknown field');
  assert.equal(merged.streak, 3, 'an unknown field only the other side has');
  assert.deepEqual(ids(merged.attempts), ['a']);
  assert.deepEqual(ids(merged.runs), ['r']);
  assert.deepEqual(merged.loops, []);
  assert.deepEqual(merged.seenTextIds, []);
  assert.deepEqual(merged.bests, {});
  assert.equal(merged.updatedAt, minute(4));
  assert.equal(merged.version, 2);
  // Every copy settles on one profile id, whichever side merges.
  assert.equal(merged.profileId, 'a');
  assert.equal(mergeSynced(cloud, local).profileId, 'a');
  assert.equal(merged.historyClearedAt, undefined);
  assert.equal(merged.undoneClears, undefined);
  // Merging again changes nothing.
  assert.ok(sameProfile(mergeSynced(merged, merged), merged));
  assert.ok(sameProfile(mergeSynced(merged, cloud), merged));
});

test('one list of history collections drives the caps on save and merge', () => {
  assert.deepEqual(Object.keys(HISTORY), ['attempts', 'runs', 'loops']);
  const big = profile({
    attempts: Array.from({ length: 30 }, (_, n) => item(`a${n}`, n)),
    runs: Array.from({ length: MAX_RUN_SUMMARIES + 5 }, (_, n) => item(`r${n}`, n, { patterns: [] })),
    loops: Array.from({ length: 30 }, (_, n) => item(`l${n}`, n)),
  });
  capHistory(big);
  assert.equal(big.attempts.length, MAX_STORED_ATTEMPTS);
  assert.equal(big.attempts[0].id, 'a6');
  assert.equal(big.runs.length, MAX_RUN_SUMMARIES);
  assert.equal(big.loops.length, 30);
});

test('stamps move forward even when this clock is behind', () => {
  const ahead = new Date(Date.now() + 3600000).toISOString();
  assert.ok(Date.parse(stampAfter(ahead)) > Date.parse(ahead));
  assert.ok(Date.parse(stampAfter('2026-10-01T12:00:00.000+00:00')) >= Date.now() - 1000);
  assert.ok(Date.parse(stampAfter(undefined, null)) <= Date.now());
});

test('sameProfile ignores key order but sees a new record or setting', () => {
  const a = profile({ runs: [item('r1', 1)], preferences: { theme: 'dark', fontSize: '28' }, updatedAt: minute(1) });
  const reordered = { updatedAt: minute(1), seenTextIds: [], bests: {}, loops: [], runs: [item('r1', 1)], attempts: [],
    preferences: { fontSize: '28', theme: 'dark' }, profileId: 'p', version: 2 };
  assert.ok(sameProfile(a, reordered));
  assert.ok(!sameProfile(a, { ...reordered, runs: [item('r1', 1), item('r2', 2)] }));
  assert.ok(!sameProfile(a, { ...reordered, preferences: { fontSize: '36', theme: 'dark' } }));
  assert.ok(!sameProfile(a, { ...reordered, seenTextIds: ['q'] }));
});

test('profile writes are conditional: an update names the version it replaces, an insert never overwrites', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  let reply = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, status: 200, text: async () => JSON.stringify(reply) };
  };
  try {
    const session = { access_token: 't', user: { id: 'u1' } };
    const seen = '2026-10-01T12:00:00.123+00:00';
    reply = [{ updated_at: '2026-10-01T12:00:01+00:00' }];
    assert.equal(await updateCloudProfile(session, { version: 2 }, seen), '2026-10-01T12:00:01+00:00');
    const update = calls.at(-1);
    assert.equal(update.init.method, 'PATCH');
    assert.match(update.url, /\/rest\/v1\/profiles\?user_id=eq\.u1&updated_at=eq\.2026-10-01T12%3A00%3A00\.123%2B00%3A00&select=updated_at$/);
    assert.equal(update.init.headers.Prefer, 'return=representation');
    assert.ok(Date.parse(JSON.parse(update.init.body).updated_at) > Date.parse(seen));

    reply = [];
    assert.equal(await updateCloudProfile(session, { version: 2 }, seen), null, 'another writer won');
    assert.equal(await insertCloudProfile(session, { version: 2 }), null, 'the row already exists');
    const insert = calls.at(-1);
    assert.equal(insert.init.method, 'POST');
    assert.equal(insert.init.headers.Prefer, 'resolution=ignore-duplicates,return=representation');
    assert.equal(JSON.parse(insert.init.body).user_id, 'u1');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
