// Properties of mergeSynced (ADR 0005: copies merge and never replace each other) over generated copies
// of one account's profile. tests/sync.test.js covers the cases one by one.
//
// The generated copies hold what real copies hold: records drawn from one shared history, since an id
// names one record everywhere and records are never edited, bests that point at those records, seen
// passages and stamped settings. A copy this build saved carries its save stamp (stampProfile); one never saved
// carries none. Copies an older build saved last, and settings saved before stamps, follow the
// replace-on-save rules of those builds instead, so they are left to tests/sync.test.js. Within the caps, so nothing is dropped for space.
import test from 'node:test';
import assert from 'node:assert/strict';
import fc from './fast-check.js';
import { MAX_STORED_ATTEMPTS, clearProfile, mergeSynced, revokeClear, sameProfile, stampProfile, syncSignature } from '../src/account.js';

const minute = (n) => new Date(Date.UTC(2026, 9, 1, 12, 0) + n * 60000).toISOString();
const HISTORY_NAMES = ['attempts', 'runs', 'loops'];
const BEST_KEYS = ['time:30', 'words:25', 'quote'];

// The shared history: records with unique ids, each with its own date and speed. Speeds come from a
// narrow band so that two copies often hold different bests at the same speed, where ties must settle.
const sharedHistory = fc.uniqueArray(fc.record({ n: fc.integer({ min: 0, max: 5000 }), wpm: fc.integer({ min: 60, max: 63 }) }), { selector: ({ n }) => n, maxLength: 30 })
  .map((drawn) => drawn.map(({ n, wpm }) => ({ id: `r${n}`, at: minute(n), kind: 'test', status: 'complete', textId: `t${n % 7}`, score: { wpm, accuracy: 100 } })));

// Settings with the stamp of their last change, as this build writes them (preferencesAt).
const setting = (values) => fc.tuple(fc.constantFrom(...values), fc.integer({ min: 0, max: 6000 }));

const preferences = fc.record({ theme: setting(['system', 'dark', 'light']), fontSize: setting(['24', '28', '32']) }, { requiredKeys: [] })
  .map((chosen) => ({
    preferences: Object.fromEntries(Object.entries(chosen).map(([name, [value]]) => [name, value])),
    preferencesAt: Object.fromEntries(Object.entries(chosen).map(([name, [, changed]]) => [name, minute(changed)])),
  }));

// One copy of the profile: some of the shared records, and bests for some of the records it holds.
const copyOf = (history) => fc.record({
  attempts: fc.subarray(history, { maxLength: Math.min(history.length, Math.floor(MAX_STORED_ATTEMPTS / 3)) }),
  runs: fc.subarray(history),
  loops: fc.subarray(history, { maxLength: Math.min(history.length, 6) }),
  best: fc.array(fc.tuple(fc.constantFrom(...BEST_KEYS), fc.nat()), { maxLength: 3 }),
  seenTextIds: fc.subarray(['t0', 't1', 't2', 't3', 't4', 't5', 't6']),
  preferences,
  saved: fc.option(fc.integer({ min: 0, max: 6000 }), { nil: undefined }),
}).map(({ attempts, runs, loops, best, seenTextIds, preferences: prefs, saved }) => {
  const bests = {};

  for (const [key, pick] of best) {
    const run = runs[pick % Math.max(1, runs.length)];

    if (run) bests[key] = { wpm: run.score.wpm, at: run.at, attemptId: run.id };
  }

  const copy = { version: 2, profileId: 'p', ...prefs, attempts, runs, loops, seenTextIds, bests };

  return saved === undefined ? copy : stampProfile(copy, minute(saved));
});

const copies = (count) => sharedHistory.chain((history) => fc.tuple(...Array.from({ length: count }, () => copyOf(history))));

const ids = (items) => items.map((item) => item.id);
const sameAs = (actual, expected) => assert.equal(syncSignature(actual), syncSignature(expected));

test('a merge keeps every record from both copies, in date order', () => {
  fc.assert(fc.property(copies(2), ([a, b]) => {
    const merged = mergeSynced(a, b);

    for (const name of HISTORY_NAMES) {
      const union = new Map([...a[name], ...b[name]].map((item) => [item.id, item]));
      const expected = [...union.values()].sort((x, y) => x.at.localeCompare(y.at) || x.id.localeCompare(y.id));
      assert.deepEqual(ids(merged[name]), ids(expected), name);
    }

    assert.deepEqual(new Set(merged.seenTextIds), new Set([...a.seenTextIds, ...b.seenTextIds]));
  }));
});

test('a merge never lowers a best, and keeps one for every condition either copy had', () => {
  fc.assert(fc.property(copies(2), ([a, b]) => {
    const merged = mergeSynced(a, b);

    for (const key of new Set([...Object.keys(a.bests), ...Object.keys(b.bests)])) {
      const highest = Math.max(a.bests[key]?.wpm ?? 0, b.bests[key]?.wpm ?? 0);
      assert.equal(merged.bests[key]?.wpm, highest, key);
    }
  }));
});

test('which copy merges into which makes no difference', () => {
  fc.assert(fc.property(copies(2), ([a, b]) => sameAs(mergeSynced(a, b), mergeSynced(b, a))));
});

test('copies settle: merging a merge with itself or with either copy again changes nothing', () => {
  fc.assert(fc.property(copies(2), ([a, b]) => {
    const merged = mergeSynced(a, b);

    for (const again of [mergeSynced(merged, merged), mergeSynced(merged, a), mergeSynced(b, merged)]) sameAs(again, merged);
  }));
});

test('three devices end with the same profile whichever order they sync in', () => {
  fc.assert(fc.property(copies(3), ([a, b, c]) => {
    const left = mergeSynced(mergeSynced(a, b), c);
    sameAs(mergeSynced(a, mergeSynced(b, c)), left);
    sameAs(mergeSynced(mergeSynced(c, a), b), left);
  }), { numRuns: 100 });
});

test('a clear reaches every copy, and its undo brings back everything it took', () => {
  fc.assert(fc.property(copies(2), ([a, b]) => {
    const before = mergeSynced(a, b);
    const cleared = clearProfile(before);
    const marker = cleared.historyClearedAt;

    // A copy saved before the clear never brings its records back, whichever side it merges from.
    for (const stale of [mergeSynced(cleared, a), mergeSynced(b, cleared), mergeSynced(mergeSynced(a, cleared), b)]) {
      for (const name of HISTORY_NAMES) assert.deepEqual(stale[name], [], name);
      assert.deepEqual(stale.bests, {});
      assert.deepEqual(stale.seenTextIds, []);
    }

    const restored = revokeClear(mergeSynced(cleared, a), before, marker);

    for (const name of HISTORY_NAMES) assert.deepEqual(ids(restored[name]), ids(before[name]), name);
    assert.deepEqual(restored.bests, before.bests);
    assert.ok(sameProfile(mergeSynced(restored, b), mergeSynced(b, restored)), 'the undo settles the same way from either side');
  }), { numRuns: 100 });
});
