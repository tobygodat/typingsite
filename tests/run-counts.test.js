import test from 'node:test';
import assert from 'node:assert/strict';
import { clearProfile, mergeAndHold, mergeSynced, revokeClear, sameProfile, undoClearHere } from '../src/account.js';
import { MAX_PRACTICE_DAYS, dayKey } from '../src/insights.js';
import { normalizeProfile } from '../src/profile.js';
import { createRunCounter, mergeRunCounts, retainRunCounts, runCountTotals, validRunCounts } from '../src/run-counts.js';

const today = dayKey(new Date());
const profile = (over = {}) => ({
  version: 2, profileId: 'p', preferences: {}, attempts: [], runs: [], loops: [], seenTextIds: [], bests: {}, runCounts: {}, ...over,
});
const totals = (copy) => runCountTotals(copy.runCounts);
// A tab: its own copy of the profile and its own counter, as each page load has.
let minted = 0;
const tab = (copy) => ({ copy: structuredClone(copy), counter: createRunCounter(() => `c${(minted += 1)}`) });
// A run typed in a tab: started at the first key, and finished or not (a restart, an abandoned run, a failure).
function run(t, { finished = true, day = today } = {}) {
  const { counts, ticket } = t.counter.start(t.copy.runCounts, day);
  t.copy.runCounts = counts;
  if (finished) t.copy.runCounts = t.counter.finish(t.copy.runCounts, ticket);
}

test('a tab counts every start and only the finishes', () => {
  const t = tab(profile());
  run(t);
  run(t, { finished: false });
  run(t, { finished: false });
  run(t);
  assert.deepEqual(totals(t.copy), { started: 4, finished: 2 });
  assert.equal(Object.keys(t.copy.runCounts).length, 1, 'one counter per tab');
});

test('a finish counts on the day its run started', () => {
  const t = tab(profile());
  const { counts, ticket } = t.counter.start({}, '2026-10-19');
  const finished = t.counter.finish(counts, ticket);
  assert.deepEqual(Object.values(finished)[0], { '2026-10-19': [1, 1] });
});

test('two tabs and two devices counting at once merge to the exact sum, in any order, any number of times', () => {
  const row = profile();
  // Each device's tabs read the same cached copy, then count runs concurrently, unaware of each other.
  const [laptop1, laptop2, phone1, phone2] = [tab(row), tab(row), tab(row), tab(row)];
  for (let n = 0; n < 3; n += 1) run(laptop1, { finished: n !== 1 });
  for (let n = 0; n < 5; n += 1) run(laptop2, { finished: n % 2 === 0 });
  run(phone1, { finished: false });
  for (let n = 0; n < 4; n += 1) run(phone2);
  const truth = { started: 13, finished: 9 };

  // Each laptop tab saves into the device cache, each merging what the other wrote; the phone does the same.
  const laptopCache = mergeSynced(mergeSynced(laptop1.copy, row), laptop2.copy);
  const phoneCache = mergeSynced(phone2.copy, mergeSynced(phone1.copy, row));
  const pushedLaptop = mergeSynced(laptopCache, row);
  const account = mergeSynced(phoneCache, pushedLaptop);
  assert.deepEqual(totals(account), truth);
  assert.deepEqual(totals(mergeSynced(pushedLaptop, phoneCache)), truth, 'merge order does not matter');

  // Stale copies keep arriving: tabs that saved before merging, the row before either push, the caches.
  let settled = account;
  for (const stale of [laptop1.copy, laptop2.copy, phone1.copy, phone2.copy, row, laptopCache, phoneCache, account]) {
    settled = mergeSynced(settled, stale);
    settled = mergeSynced(stale, settled);
  }
  assert.deepEqual(totals(settled), truth, 'nothing counts twice');
  assert.ok(sameProfile(settled, account), 'copies settle');

  // The tabs carry on from the merged copy: their counters keep counting without recounting anything.
  laptop1.copy = mergeSynced(laptop1.copy, settled);
  phone2.copy = mergeSynced(phone2.copy, settled);
  run(laptop1);
  run(phone2, { finished: false });
  assert.deepEqual(totals(mergeSynced(laptop1.copy, phone2.copy)), { started: 15, finished: 10 });
});

test('a clear takes the counts, a stale copy cannot bring them back, and Undo restores them with runs counted since', () => {
  const laptop = tab(profile());
  const phone = tab(profile());
  for (let n = 0; n < 4; n += 1) run(laptop, { finished: n < 3 });
  run(phone);
  run(phone, { finished: false });
  const before = mergeSynced(laptop.copy, phone.copy);
  assert.deepEqual(totals(before), { started: 6, finished: 4 });

  const cleared = clearProfile(before);
  assert.deepEqual(cleared.runCounts, {});
  // The phone, which never heard of the clear, syncs: its counts from the clear's day and earlier go, as archived practice days do.
  const { merged: synced, holds } = mergeAndHold({}, cleared, phone.copy);
  assert.deepEqual(totals(synced), { started: 0, finished: 0 });

  // The laptop types after the clear: its counter's numbers are gone, so it counts under a fresh one.
  laptop.copy = synced;
  run(laptop);
  run(laptop, { finished: false });
  assert.deepEqual(totals(laptop.copy), { started: 2, finished: 1 });
  assert.equal(Object.keys(laptop.copy.runCounts).length, 1);

  // Undo: everything from before the clear, the phone's held copy included, plus the runs counted since.
  const { merged: restored } = undoClearHere(holds, laptop.copy, cleared.historyClearedAt, before);
  assert.deepEqual(totals(restored), { started: 8, finished: 5 });
  // The same Undo arriving elsewhere as a marker (revokeClear) gives the same counts.
  assert.deepEqual(totals(revokeClear(laptop.copy, before, cleared.historyClearedAt)), { started: 8, finished: 5 });
  // Copies that saw the clear or missed it settle on the undone count.
  assert.deepEqual(totals(mergeSynced(mergeSynced(restored, phone.copy), synced)), { started: 8, finished: 5 });
});

test('a clear heard from elsewhere sends the counter to a fresh one; an undo heard first lets it go on', () => {
  const t = tab(profile());
  run(t);
  run(t);
  const [first] = Object.keys(t.copy.runCounts);
  const kept = structuredClone(t.copy);
  const elsewhere = clearProfile(t.copy);
  t.copy = mergeSynced(t.copy, elsewhere);
  run(t, { finished: false });
  assert.deepEqual(totals(t.copy), { started: 1, finished: 0 });
  assert.notDeepEqual(Object.keys(t.copy.runCounts), [first]);
  // That clear's undo arriving later brings back both runs beside the one counted since.
  assert.deepEqual(totals(revokeClear(t.copy, kept, elsewhere.historyClearedAt)), { started: 3, finished: 2 });

  const u = tab(profile());
  run(u);
  const keep = structuredClone(u.copy);
  const clear = clearProfile(u.copy);
  u.copy = revokeClear(clear, keep, clear.historyClearedAt);
  run(u);
  assert.equal(Object.keys(u.copy.runCounts).length, 1, 'restored numbers are its own, so it counts on from them');
  assert.deepEqual(totals(u.copy), { started: 2, finished: 2 });
});

test('a run whose start a clear took still counts as started when it finishes', () => {
  const t = tab(profile());
  const { counts, ticket } = t.counter.start(t.copy.runCounts, today);
  t.copy.runCounts = counts;
  t.copy = clearProfile(t.copy);
  t.copy.runCounts = t.counter.finish(t.copy.runCounts, ticket);
  assert.deepEqual(totals(t.copy), { started: 1, finished: 1 });
});

test('totals read a window of days', () => {
  const counts = { a: { '2026-10-01': [2, 1], '2026-10-10': [3, 3] }, b: { '2026-10-10': [1, 0], '2026-10-15': [4, 2] } };
  assert.deepEqual(runCountTotals(counts), { started: 10, finished: 6 });
  assert.deepEqual(runCountTotals(counts, { from: '2026-10-10', to: '2026-10-14' }), { started: 4, finished: 3 });
  assert.deepEqual(runCountTotals({}), { started: 0, finished: 0 });
});

test('stored counts are checked, kept through a load, and bounded to the newest days', () => {
  const messy = { a: { '2026-10-01': [2, 1], 'yesterday': [1, 1], '2026-10-02': [-1, 0.5], '2026-10-03': 'x' }, b: [1], c: null };
  assert.deepEqual(validRunCounts(messy), { a: { '2026-10-01': [2, 1] } });
  assert.deepEqual(normalizeProfile({ version: 2, runCounts: messy }).runCounts, { a: { '2026-10-01': [2, 1] } });
  assert.deepEqual(normalizeProfile({ version: 2 }).runCounts, {}, 'a profile from before counts nothing');

  const day = (n) => dayKey(new Date(2024, 0, 1 + n));
  const many = { a: Object.fromEntries(Array.from({ length: MAX_PRACTICE_DAYS + 5 }, (_, n) => [day(n), [1, 1]])) };
  const kept = retainRunCounts(many);
  assert.equal(Object.keys(kept.a).length, MAX_PRACTICE_DAYS);
  assert.equal(Object.keys(kept.a).sort()[0], day(5));
  assert.deepEqual(mergeRunCounts(kept, many), kept, 'a longer copy merged in is trimmed the same way');
});

test('counts with the same numbers sign the same whatever order their keys were written in', () => {
  const a = profile({ runCounts: { x: { '2026-10-01': [1, 0], '2026-10-02': [2, 2] }, y: { '2026-10-01': [1, 1] } } });
  const b = profile({ runCounts: { y: { '2026-10-01': [1, 1] }, x: { '2026-10-02': [2, 2], '2026-10-01': [1, 0] } } });
  assert.ok(sameProfile(a, b));
  assert.ok(!sameProfile(a, profile({ runCounts: { ...a.runCounts, y: { '2026-10-01': [2, 1] } } })));
});
