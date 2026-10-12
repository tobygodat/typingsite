import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HISTORY, MAX_STORED_ATTEMPTS, capHistory, clearProfile, insertCloudProfile, joinHolds, mergeAndHold, mergeSynced, revokeClear,
  sameProfile, stampAfter, undoClearHere, updateCloudProfile,
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
});

test('equal setting stamps settle on the same value on every copy', () => {
  // A clock running ahead stamped the theme; two devices behind it each step just past that stamp, so
  // their different picks carry the same stamp.
  const ahead = new Date(Date.now() + 3600000).toISOString();
  const phone = profile({ preferences: { theme: 'dark', fontSize: '28' }, preferencesAt: { theme: stampAfter(ahead) } });
  const laptop = profile({ preferences: { theme: 'light', fontSize: '28' }, preferencesAt: { theme: stampAfter(ahead) } });
  assert.equal(phone.preferencesAt.theme, laptop.preferencesAt.theme);
  const onPhone = mergeSynced(phone, laptop);
  const onLaptop = mergeSynced(laptop, phone);
  assert.equal(onPhone.preferences.theme, onLaptop.preferences.theme);
  assert.deepEqual(onPhone.preferencesAt, onLaptop.preferencesAt);
  // Merging again changes nothing, so neither copy rewrites the row.
  assert.ok(sameProfile(mergeSynced(onPhone, laptop), onPhone));
  assert.ok(sameProfile(mergeSynced(onLaptop, phone), onLaptop));
  // A side an older build wrote, lacking the setting, still gets the other side's value.
  const older = profile({ preferences: { fontSize: '28' }, preferencesAt: { theme: phone.preferencesAt.theme } });
  assert.equal(mergeSynced(older, phone).preferences.theme, 'dark');
  assert.equal(mergeSynced(phone, older).preferences.theme, 'dark');
});

test('two devices that each tried the same daily before merging keep one first attempt', () => {
  const daily = (id, n, extra = {}) => item(id, n, { kind: 'daily', challengeDate: '2026-10-01', firstDailyAttempt: true, ...extra });
  // The laptop tried first; the phone, not yet holding the laptop's copy, labelled its own try first too.
  const laptop = profile({ attempts: [daily('laptop', 2)], runs: [daily('laptop', 2)] });
  const phone = profile({ attempts: [daily('phone', 5)], runs: [daily('phone', 5), daily('other-day', 6, { challengeDate: '2026-10-02' })] });
  for (const merged of [mergeSynced(laptop, phone), mergeSynced(phone, laptop)]) {
    for (const name of ['attempts', 'runs']) {
      const first = merged[name].filter((record) => record.challengeDate === '2026-10-01' && record.firstDailyAttempt).map((record) => record.id);
      assert.deepEqual(first, ['laptop'], name);
    }
    assert.equal(merged.runs.find((record) => record.id === 'other-day').firstDailyAttempt, true);
  }
  // A repeat stays a repeat, and the inputs are not changed.
  const repeat = profile({ runs: [daily('early', 1, { firstDailyAttempt: false })] });
  assert.deepEqual(mergeSynced(repeat, phone).runs.filter((record) => record.firstDailyAttempt).map((record) => record.id), ['other-day']);
  assert.equal(phone.runs[0].firstDailyAttempt, true);
});

test('a daily attempt either copy knows is a repeat stays one, after its earlier try is gone', () => {
  const daily = (id, n, extra = {}) => item(id, n, { kind: 'daily', challengeDate: '2026-10-01', firstDailyAttempt: true, ...extra });
  // The phone made the later try before it held the earlier one, so there it is labelled first. The
  // laptop holds both, so there it is a repeat.
  const phone = profile({ attempts: [daily('later', 5)], runs: [daily('later', 5)] });
  const laptop = mergeSynced(profile({ attempts: [daily('early', 2)], runs: [daily('early', 2)] }), phone);
  assert.equal(laptop.runs.find((record) => record.id === 'later').firstDailyAttempt, false);
  // A clear from a device whose clock runs behind, stamped between the two tries, takes the earlier one.
  const cleared = mergeSynced(laptop, profile({ historyClearedAt: minute(3) }));
  assert.deepEqual(ids(cleared.runs), ['later']);
  for (const merged of [mergeSynced(cleared, phone), mergeSynced(phone, cleared)]) {
    for (const name of ['attempts', 'runs']) assert.equal(merged[name][0].firstDailyAttempt, false, name);
  }
  // Copies that differ only in that label are not the same, so the one that says repeat is sent.
  const repeat = (copy) => ({ ...copy, runs: copy.runs.map((record) => ({ ...record, firstDailyAttempt: false })) });
  assert.equal(sameProfile(phone, repeat(phone)), false);
  assert.ok(sameProfile(mergeSynced(cleared, phone), mergeSynced(phone, cleared)));
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

// An older clear's names can take a record from a copy that already shares a newer clear's marker. The
// best that record set goes with it, and so does its passage's seen mark, as for a copy that missed a clear.
for (const retyped of [false, true]) {
  test(`an older clear’s names that take a best and a passage under a newer marker leave what the rest supports${retyped ? ' (passage typed again)' : ''}`, () => {
    const conditions = { mode: 'words', count: 10, punctuation: false, wordList: '200', inputClass: 'physical-keyboard', correctionPolicy: 'relaxed' };
    const key = conditionKey(conditions);
    const realNow = Date.now;
    const T0 = Date.UTC(2026, 9, 12, 9, 0);
    let now = T0;
    Date.now = () => now;
    try {
      const run = (id, ms, wpm, extra = {}) => ({ id, at: new Date(ms).toISOString(), kind: 'test', status: 'complete', interrupted: false, conditions, score: { wpm, accuracy: 100 }, textId: `q-${id}`, ...extra });
      const best = (record) => ({ wpm: record.score.wpm, attemptId: record.id, at: record.at });
      // A tablet whose clock runs a day ahead made "far" at 90 wpm. 09:00: the laptop, holding it, clears,
      // naming it.
      const far = run('far', T0 + 86400e3, 90);
      const tablet = profile({ runs: [far], seenTextIds: ['q-far'], bests: { [key]: best(far) } });
      const laptop = clearProfile(tablet);
      // 09:01: the phone, not yet aware, clears its own history. It runs at 60 wpm, then takes in the
      // tablet's copy: "far" is stamped after its clear, so it stays, and sets the best.
      now = T0 + 60e3;
      const phoneCleared = clearProfile(profile({ runs: [run('old', T0 - 3600e3, 50)] }));
      now = T0 + 120e3;
      const slow = run('slow', now, 60);
      const again = run('again', now + 60e3, 40, { kind: 'drill', textId: 'q-far' });
      const phone = mergeSynced({ ...phoneCleared, runs: [slow, ...(retyped ? [again] : [])], seenTextIds: ['q-slow'], bests: { [key]: best(slow) } }, tablet);
      assert.equal(phone.bests[key].attemptId, 'far');
      assert.deepEqual([...phone.seenTextIds].sort(), ['q-far', 'q-slow']);
      // The laptop's clear reaches the phone: its name takes "far" under the phone's newer marker.
      for (const merged of [mergeSynced(phone, laptop), mergeSynced(laptop, phone)]) {
        assert.equal(merged.historyClearedAt, phoneCleared.historyClearedAt);
        assert.deepEqual(ids(merged.runs), retyped ? ['slow', 'again'] : ['slow']);
        assert.deepEqual(merged.bests, { [key]: best(slow) });
        assert.deepEqual([...merged.seenTextIds].sort(), retyped ? ['q-far', 'q-slow'] : ['q-slow']);
      }
    } finally {
      Date.now = realNow;
    }
  });
}

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
  let laptopHeld = { [laptop.historyClearedAt]: [laptopBefore] };
  ({ merged: laptop, holds: laptopHeld } = mergeAndHold(laptopHeld, laptop, row));
  row = laptop;
  assert.deepEqual(ids(row.runs), []);
  assert.deepEqual(laptopHeld[laptop.historyClearedAt].map((copy) => ids(copy.runs)), [['l1'], ['l1', 'd1']]);

  // The phone comes back online before the undo: it hears of the clear and drops its copies.
  let phoneHeld = {};
  ({ merged: phone, holds: phoneHeld } = mergeAndHold(phoneHeld, phone, row));
  row = phone;
  assert.deepEqual(ids(phone.runs), []);

  // Undo on the laptop, from what it held, reaches the row; the phone then gives back what it held.
  laptop = undoClearHere(laptopHeld, laptop, laptop.historyClearedAt, laptopBefore).merged;
  ({ merged: row } = mergeAndHold({}, laptop, row));
  assert.deepEqual(ids(row.runs), ['l1', 'd1']);
  ({ merged: phone, holds: phoneHeld } = mergeAndHold(phoneHeld, phone, row));
  assert.deepEqual(phoneHeld, {});
  assert.deepEqual(ids(phone.runs), ['l1', 'd1', 'd2']);
  assert.deepEqual([...phone.seenTextIds].sort(), ['q2', 'qd', 'ql']);
  assert.equal(phone.historyClearedAt, undefined);
  // And the laptop's next merge with the phone's copy brings d2 there too.
  assert.deepEqual(ids(mergeAndHold({}, laptop, phone).merged.runs), ['l1', 'd1', 'd2']);

  // A clear that is never undone keeps everything it removed out, held or not.
  const kept = mergeAndHold({}, profile({ runs: [item('old', 1)] }), clearProfile(profile()));
  assert.deepEqual(ids(kept.merged.runs), []);
  assert.deepEqual(kept.holds[kept.merged.historyClearedAt].map((copy) => ids(copy.runs)), [['old']]);
  assert.deepEqual(ids(mergeAndHold(kept.holds, kept.merged, profile({ historyClearedAt: kept.merged.historyClearedAt })).merged.runs), []);
});

test('a clock running ahead elsewhere can’t move a clear into the future', () => {
  const hours = (n) => new Date(Date.now() + n * 3600000).toISOString();
  // The laptop holds a run (and best) from a tablet whose clock runs 6 h fast.
  const tablet = { id: 'tablet', at: hours(5), textId: 'q-tablet' };
  const laptop = profile({ runs: [item('mine', 1), tablet], seenTextIds: ['q-tablet'], bests: { k: { wpm: 90, attemptId: 'tablet', at: hours(5) } } });
  const cleared = clearProfile(laptop);
  assert.ok(Date.parse(cleared.historyClearedAt.split('~')[0]) <= Date.now() + 1000);
  assert.deepEqual(cleared.historyClearedIds, [[cleared.historyClearedAt, 'tablet']]);

  // A phone with a right clock hadn't heard of the clear: it still holds both, and ran again 2 h later.
  const later = { id: 'later', at: hours(2), textId: 'q-later' };
  const phone = profile({ runs: [item('mine', 1), tablet, later], seenTextIds: ['q-tablet', 'q-later'], bests: { k: { wpm: 90, attemptId: 'tablet', at: hours(5) } } });
  for (const merged of [mergeSynced(cleared, phone), mergeSynced(phone, cleared)]) {
    assert.deepEqual(ids(merged.runs), ['later']);
    assert.deepEqual(merged.seenTextIds, ['q-later']);
    assert.deepEqual(merged.bests, {});
    assert.deepEqual(merged.historyClearedIds, [[cleared.historyClearedAt, 'tablet']]);
  }
  // Undone, the named records come back like any other.
  const restored = mergeSynced(revokeClear(cleared, laptop, cleared.historyClearedAt), phone);
  assert.deepEqual(ids(restored.runs), ['mine', 'later', 'tablet']);
  assert.equal(restored.historyClearedIds, undefined);
});

test('every clear not undone keeps out the records it named, after a newer clear and an undo', () => {
  const hours = (n) => new Date(Date.now() + n * 3600000).toISOString();
  // The laptop cleared an hour ago, naming a run its tablet's fast clock stamped two days ahead (in the
  // shape earlier builds stored: ids alone, tied to historyClearedAt).
  const far = { id: 'far', at: hours(47), textId: 'q-far' };
  const laptop = profile({ historyClearedAt: hours(-1), historyClearedIds: ['far'] });
  // The phone never held that run. It clears now, naming one stamped a day ahead of its own clock.
  const fast = { id: 'fast', at: hours(24), textId: 'q-fast' };
  const phoneBefore = profile({ runs: [fast], seenTextIds: ['q-fast'] });
  const phone = clearProfile(phoneBefore);
  assert.ok(laptop.historyClearedAt < phone.historyClearedAt && phone.historyClearedAt < far.at);
  // A copy that heard of neither clear: older history, both named runs, and a run made after both clears.
  const later = { id: 'later', at: hours(1), textId: 'q-later' };
  const stale = profile({
    runs: [item('old', 3), far, fast, later],
    seenTextIds: ['q-far', 'q-fast', 'q-later'],
    bests: { k: { wpm: 90, attemptId: 'far', at: far.at } },
  });

  const both = mergeSynced(laptop, phone);
  assert.ok(sameProfile(mergeSynced(phone, laptop), both));
  const settled = mergeSynced(both, stale);
  for (const merged of [settled, mergeSynced(stale, both), mergeSynced(stale, mergeSynced(phone, laptop))]) {
    assert.deepEqual(ids(merged.runs), ['later']);
    assert.deepEqual(merged.bests, {});
    assert.deepEqual(merged.seenTextIds, ['q-later']);
    assert.ok(sameProfile(merged, settled));
  }
  assert.equal(settled.historyClearedAt, phone.historyClearedAt);
  assert.deepEqual(settled.historyClearedIds, [[laptop.historyClearedAt, 'far'], [phone.historyClearedAt, 'fast']]);
  // Copies settle: merging any of them in again changes nothing.
  for (const copy of [settled, both, laptop, phone, stale]) assert.ok(sameProfile(mergeSynced(settled, copy), settled));
  // The phone may hear from the stale copy first. The far run is after its own clear, so it stays until
  // the laptop's clear arrives, and then goes.
  const phoneFirst = mergeSynced(phone, stale);
  assert.deepEqual(ids(phoneFirst.runs), ['later', 'far']);
  for (const merged of [mergeSynced(phoneFirst, laptop), mergeSynced(laptop, phoneFirst)]) {
    assert.deepEqual(ids(merged.runs), ['later']);
    assert.deepEqual(merged.bests, {});
  }

  // Undoing the phone's clear brings back what it named, but the laptop's clear, still in force, keeps
  // the far run out of every copy.
  const undone = revokeClear(settled, phoneBefore, phone.historyClearedAt);
  assert.deepEqual(undone.historyClearedIds, [[laptop.historyClearedAt, 'far']]);
  for (const merged of [undone, mergeSynced(undone, stale), mergeSynced(stale, undone), mergeSynced(undone, phoneFirst)]) {
    assert.ok(ids(merged.runs).includes('fast'));
    assert.ok(!ids(merged.runs).includes('far'));
    assert.ok(sameProfile(mergeSynced(merged, merged), merged));
  }

  // Every clear not undone keeps all of its pairs, an older one under a newer one included.
  const older = profile({ historyClearedAt: minute(1), historyClearedIds: Array.from({ length: MAX_RUN_SUMMARIES + 2 }, (_, n) => `o${String(n).padStart(4, '0')}`) });
  const newer = profile({ historyClearedAt: minute(2), historyClearedIds: [[minute(2), 'n1'], [minute(2), 'n2']] });
  assert.equal(mergeSynced(older, older).historyClearedIds.length, MAX_RUN_SUMMARIES + 2);
  const both2 = mergeSynced(older, newer);
  assert.ok(sameProfile(mergeSynced(newer, older), both2));
  assert.equal(both2.historyClearedIds.length, MAX_RUN_SUMMARIES + 4);
  assert.deepEqual(both2.historyClearedIds[0], [minute(1), 'o0000']);
  assert.deepEqual(both2.historyClearedIds.slice(-2), [[minute(2), 'n1'], [minute(2), 'n2']]);
});

test('a clear keeps out every record it named, more than the cap included', () => {
  // A clock that ran a year ahead was corrected back before the clear: every run summary kept, and
  // more loops, are stamped after it.
  const ahead = (n) => new Date(Date.now() + 365 * 86400000 + n * 60000).toISOString();
  const runs = Array.from({ length: MAX_RUN_SUMMARIES }, (_, n) => ({ id: `r${String(n).padStart(4, '0')}`, at: ahead(n) }));
  const loops = Array.from({ length: 30 }, (_, n) => ({ id: `l${String(n).padStart(2, '0')}`, at: ahead(n) }));
  const cleared = clearProfile(profile({ runs, loops }));
  // A copy that hadn't heard of the clear still holds all of them.
  const stale = profile({ runs, loops });
  for (const merged of [mergeSynced(cleared, stale), mergeSynced(stale, cleared)]) {
    assert.deepEqual([merged.runs.length, merged.loops.length], [0, 0]);
    assert.ok(sameProfile(mergeSynced(merged, stale), merged));
  }
  assert.equal(cleared.historyClearedIds.length, MAX_RUN_SUMMARIES + 30);
});

test('a newer clear keeps out every record an older one named, more than 1,000 included', () => {
  // As above, then the person clears again: the newer clear finds nothing left to name, so the older
  // clear's pairs are all that keep those records out of a copy that heard of neither.
  const ahead = (n) => new Date(Date.now() + 365 * 86400000 + n * 60000).toISOString();
  const runs = Array.from({ length: MAX_RUN_SUMMARIES }, (_, n) => ({ id: `r${String(n).padStart(4, '0')}`, at: ahead(n) }));
  const loops = Array.from({ length: 30 }, (_, n) => ({ id: `l${String(n).padStart(2, '0')}`, at: ahead(n) }));
  const first = clearProfile(profile({ runs, loops }));
  const again = clearProfile(first);
  assert.ok(again.historyClearedAt > first.historyClearedAt);
  const stale = profile({ runs, loops });
  // Undoing the newer clear leaves the older one in force, with all of its pairs. The newer clear names
  // them too, as it knew of them, so undoing the older one instead keeps them out as well.
  const undone = revokeClear(again, first, again.historyClearedAt);
  const olderUndone = mergeSynced({ ...again, undoneClears: [first.historyClearedAt] }, again);
  const all = MAX_RUN_SUMMARIES + 30;
  for (const [copy, pairs] of [[again, 2 * all], [mergeSynced(again, first), 2 * all], [mergeSynced(first, again), 2 * all], [undone, all], [olderUndone, all]]) {
    for (const merged of [mergeSynced(copy, stale), mergeSynced(stale, copy)]) {
      assert.deepEqual([merged.runs.length, merged.loops.length], [0, 0]);
      assert.ok(sameProfile(mergeSynced(merged, stale), merged));
    }
    assert.equal(copy.historyClearedIds.length, pairs);
  }
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

test('a copy that applied a clear undone since answers to an older clear still in force', () => {
  // The laptop's clock runs ahead: its clear is stamped minute 20. The tablet applied it, then ran at
  // minute 5 by its own clock. The phone cleared on its own at minute 10, after that run. The laptop
  // undoes its clear before hearing of the phone's, and the row takes in both.
  const laptopCleared = profile({ historyClearedAt: minute(20) });
  const tablet = profile({ historyClearedAt: minute(20), runs: [item('tablet-run', 5, { textId: 'q-tablet' })], seenTextIds: ['q-tablet'] });
  const laptop = revokeClear(laptopCleared, profile(), minute(20));
  const row = mergeSynced(profile({ historyClearedAt: minute(10), runs: [item('phone-after', 12)] }), laptop);
  assert.equal(row.historyClearedAt, minute(10));
  // The tablet's run came before the phone's clear, which the tablet never applied: it stays out.
  for (const merged of [mergeSynced(tablet, row), mergeSynced(row, tablet)]) {
    assert.deepEqual(ids(merged.runs), ['phone-after']);
    assert.deepEqual(merged.seenTextIds, []);
    assert.equal(merged.historyClearedAt, minute(10));
    assert.deepEqual(merged.undoneClears, [minute(20)]);
  }
});

test('an undo that arrives with an older clear still in force gives back what the undone clear held', () => {
  // The phone cleared on its own at minute 10. The laptop clears later; the tablet, sharing its history
  // and holding a run of its own (minute 16) never sent, applies that clear and holds what it removed.
  const phoneBefore = profile({ runs: [item('phone-old', 3)] });
  const phone = profile({ historyClearedAt: minute(10), runs: [item('phone-after', 12)] });
  const laptopBefore = profile({ runs: [item('old', 5), item('mid', 15)] });
  const laptopCleared = clearProfile(laptopBefore);
  let { merged: tablet, holds: held } = mergeAndHold({}, profile({ runs: [...laptopBefore.runs, item('tablet-own', 16)] }), laptopCleared);
  assert.deepEqual(ids(tablet.runs), []);
  assert.deepEqual(Object.keys(held), [laptopCleared.historyClearedAt]);

  // The laptop undoes before hearing of the phone's clear; the row takes in both, and the tablet then
  // pulls the row. Its own run, after the phone's clear, comes back; the run from before it stays out.
  const laptop = revokeClear(laptopCleared, laptopBefore, laptopCleared.historyClearedAt);
  const row = mergeSynced(phone, laptop);
  ({ merged: tablet, holds: held } = mergeAndHold(held, tablet, row));
  assert.deepEqual(ids(tablet.runs), ['phone-after', 'mid', 'tablet-own']);
  assert.equal(tablet.historyClearedAt, minute(10));
  // What the phone's clear removed is held in turn, so its own undo gives that back too.
  assert.deepEqual(Object.keys(held), [minute(10)]);
  ({ merged: tablet, holds: held } = mergeAndHold(held, tablet, revokeClear(row, phoneBefore, minute(10))));
  assert.deepEqual(ids(tablet.runs), ['phone-old', 'old', 'phone-after', 'mid', 'tablet-own']);
  assert.equal(tablet.historyClearedAt, undefined);
  assert.deepEqual(held, {});
});

// A device: its copy and what it holds for Undo. mergeInto() is a pull, or a push that writes the row.
const device = (copy) => ({ copy, holds: {}, clears: [] });
const mergeInto = (d, other) => {
  ({ merged: d.copy, holds: d.holds } = mergeAndHold(d.holds, d.copy, other));
  return d.copy;
};
const clearOn = (d) => {
  const before = d.copy;
  d.copy = clearProfile(before);
  d.holds = joinHolds(d.holds, { [d.copy.historyClearedAt]: [before] });
  const clear = { marker: d.copy.historyClearedAt, before };
  d.clears.push(clear);
  return clear;
};
const undoOn = (d, { marker, before }) => {
  ({ merged: d.copy, holds: d.holds } = undoClearHere(d.holds, d.copy, marker, before));
  d.clears = d.clears.filter((clear) => clear.marker !== marker);
  return d.copy;
};
const runIds = (copy) => [...ids(copy.runs)].sort();

for (const order of ['older undo first', 'newer undo first']) {
  test(`a newer clear keeps what an older clear held here, and both undos give it back (${order})`, () => {
    const phone = device(profile({ runs: [item('phone-old', 2)] }));
    const laptop = device(profile({ runs: [item('laptop-old', 3)] }));
    const tablet = device(profile({ runs: [item('tablet-unsent', 5)] }));
    let row = profile();
    const phoneClear = clearOn(phone);
    row = mergeInto(phone, row);
    mergeInto(tablet, row); // the tablet applies the phone's clear and holds its unsent run
    assert.deepEqual(runIds(tablet.copy), []);
    row = mergeInto(laptop, row);
    const afterPhone = new Date(Date.parse(phoneClear.marker.split('~')[0]) + 60000).toISOString();
    laptop.copy = { ...laptop.copy, runs: [...laptop.copy.runs, { id: 'laptop-mid', at: afterPhone }] };
    const laptopClear = clearOn(laptop); // a newer clear
    assert.ok(laptopClear.marker > phoneClear.marker);
    row = mergeInto(laptop, row);
    mergeInto(tablet, row); // the tablet applies it too: what the older clear held must stay
    assert.deepEqual(runIds(tablet.copy), []);
    assert.deepEqual(Object.keys(tablet.holds).sort(), [phoneClear.marker, laptopClear.marker].sort());
    const undos = [
      () => { undoOn(phone, phoneClear); row = mergeInto(phone, row); },
      () => { undoOn(laptop, laptopClear); row = mergeInto(laptop, row); },
    ];
    for (const step of order === 'older undo first' ? undos : undos.reverse()) {
      step();
      mergeInto(tablet, row);
      row = mergeInto(tablet, row); // the tablet pushes
    }
    // Every device settles on everything, once each has pulled.
    for (const d of [phone, laptop, tablet]) row = mergeInto(d, row);
    for (const d of [phone, laptop, tablet]) mergeInto(d, row);
    for (const d of [phone, laptop, tablet]) {
      assert.deepEqual(runIds(d.copy), ['laptop-mid', 'laptop-old', 'phone-old', 'tablet-unsent']);
      assert.equal(d.copy.historyClearedAt, undefined);
      assert.deepEqual(d.holds, {});
    }
  });
}

test('held copies with different clears never drop each other’s records', () => {
  // The tablet holds a run the phone's clear (minute 10) would take, and hears of the laptop's newer
  // clear first; then a copy that applied the phone's clear only arrives. Both are held for the newer
  // clear: merged into one, the phone's clear would take the tablet's run from the hold.
  const phoneClear = minute(10);
  const tablet = device(profile({ runs: [item('tablet-old', 5)] }));
  const laptopClear = clearProfile(profile({ runs: [item('laptop-old', 4)] }));
  mergeInto(tablet, laptopClear);
  mergeInto(tablet, profile({ historyClearedAt: phoneClear, runs: [item('phone-after', 12)] }));
  assert.deepEqual(runIds(tablet.copy), []);
  assert.deepEqual(tablet.holds[laptopClear.historyClearedAt].map(runIds), [['tablet-old'], ['phone-after']]);

  // The laptop's undo arrives: the phone's clear still stands, so the tablet's run is held again for it,
  // and comes back with that clear's own undo.
  mergeInto(tablet, { ...laptopClear, undoneClears: [laptopClear.historyClearedAt] });
  assert.deepEqual(runIds(tablet.copy), ['phone-after']);
  assert.equal(tablet.copy.historyClearedAt, phoneClear);
  assert.deepEqual(Object.keys(tablet.holds), [phoneClear]);
  mergeInto(tablet, profile({ undoneClears: [phoneClear] }));
  assert.deepEqual(runIds(tablet.copy), ['phone-after', 'tablet-old']);
  assert.deepEqual(tablet.holds, {});
});

test('joinHolds keeps both derivations’ holds (a clear made while a push was out)', () => {
  // This tab clears; its push merges the row, which holds a run from another device that never heard
  // of the clear: that merge holds it.
  const tab = device(profile({ runs: [item('mine', 1)] }));
  const first = clearOn(tab);
  const row = profile({ runs: [item('row-only', 2)] });
  const atPush = mergeAndHold(tab.holds, tab.copy, row);
  assert.deepEqual(atPush.holds[first.marker].map(runIds), [['mine'], ['row-only']]);

  // While the write is out, this tab runs again and clears again.
  tab.copy = { ...tab.copy, runs: [{ id: 'mid', at: stampAfter(first.marker) }] };
  const second = clearOn(tab);
  assert.ok(second.marker > first.marker);

  // The write lands: what the push held joins what this tab holds now, and nothing is lost.
  tab.holds = joinHolds(tab.holds, atPush.holds);
  assert.deepEqual(Object.keys(tab.holds).sort(), [first.marker, second.marker]);
  assert.deepEqual(tab.holds[first.marker].map(runIds), [['mine'], ['row-only']]);
  mergeInto(tab, atPush.merged);
  undoOn(tab, second);
  assert.deepEqual(runIds(tab.copy), ['mid']);
  undoOn(tab, first);
  assert.deepEqual(runIds(tab.copy), ['mid', 'mine', 'row-only']);
  assert.deepEqual(tab.holds, {});

  // Joining is idempotent, and a hold joined again after its undo is released by the next merge.
  assert.deepEqual(joinHolds(atPush.holds, atPush.holds), atPush.holds);
  tab.holds = joinHolds(tab.holds, atPush.holds);
  mergeInto(tab, tab.copy);
  assert.deepEqual(runIds(tab.copy), ['mid', 'mine', 'row-only']);
  assert.deepEqual(tab.holds, {});
});

// A seeded generator, so a failure names a sequence that can be replayed.
const seeded = (seed) => () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};

test('randomised: once every clear is undone, every run made anywhere is everywhere', () => {
  const realNow = Date.now;
  const failed = [];
  try {
    for (let seed = 1; seed <= 400; seed += 1) {
      const random = seeded(seed);
      let now = Date.UTC(2026, 9, 1);
      Date.now = () => now;
      const devices = [0, 1, 2].map(() => device(profile({ preferences: {} })));
      let row = profile({ preferences: {} });
      const made = [];
      for (let step = 0; step < 40; step += 1) {
        now += 60000;
        const d = devices[Math.floor(random() * 3)];
        const roll = random();
        if (roll < 0.35) {
          const id = `r${made.length}`;
          made.push(id);
          d.copy = { ...d.copy, runs: [...d.copy.runs, { id, at: new Date(now).toISOString() }] };
        } else if (roll < 0.5) clearOn(d);
        else if (roll < 0.6 && d.clears.length) undoOn(d, d.clears[Math.floor(random() * d.clears.length)]);
        else if (roll < 0.8) row = mergeInto(d, row);
        else mergeInto(d, row);
      }
      for (const d of devices) for (const clear of [...d.clears]) undoOn(d, clear);
      for (let round = 0; round < 3; round += 1) for (const d of devices) row = mergeInto(d, row);
      for (const d of devices) {
        const have = new Set(ids(d.copy.runs));
        if (made.some((id) => !have.has(id)) || d.copy.historyClearedAt) {
          failed.push(seed);
          break;
        }
      }
    }
  } finally {
    Date.now = realNow;
  }
  assert.deepEqual(failed, []);
});

test('an undo undoes only its own clear, even when two clears are stamped the same millisecond', () => {
  const realNow = Date.now;
  const T0 = Date.UTC(2026, 9, 12, 9, 0);
  let now = T0;
  Date.now = () => now;
  try {
    const run = (id) => ({ id, at: new Date(now).toISOString() });
    // A phone whose clock ran a fortnight ahead cleared and undid at once. Its undone marker stays, and
    // until real time passes it every clear on a device that knows of it is stamped a millisecond after.
    now = T0 + 14 * 86400e3;
    const phone = device(profile({ runs: [{ id: 'old', at: minute(0) }] }));
    undoOn(phone, clearOn(phone));
    now = T0;
    const a = device(profile());
    let row = mergeInto(a, mergeInto(phone, profile()));
    a.copy = { ...a.copy, runs: [...a.copy.runs, run('a-private')] };
    row = mergeInto(a, row);
    const b = device(profile());
    mergeInto(b, row); // B loads, then pulls nothing more

    // 10:00: A clears on purpose and sends it. 11:00: B clears, and undoes within the toast's seconds.
    now = T0 + 3600e3;
    const aClear = clearOn(a);
    row = mergeInto(a, row);
    now = T0 + 2 * 3600e3;
    const bClear = clearOn(b);
    assert.equal(bClear.marker.split('~')[0], aClear.marker.split('~')[0]);
    assert.notEqual(bClear.marker, aClear.marker);
    now += 3000;
    undoOn(b, bClear);
    row = mergeInto(b, row);
    // A's clear still stands: its runs stay out of the row, and A's next pull keeps them out.
    assert.equal(row.historyClearedAt, aClear.marker);
    assert.deepEqual(runIds(row), []);
    assert.deepEqual(runIds(mergeInto(a, row)), []);
  } finally {
    Date.now = realNow;
  }
});

test('an undo elsewhere never gives back what a different clear holds here', () => {
  const realNow = Date.now;
  const T0 = Date.UTC(2026, 9, 12, 9, 0);
  let now = T0;
  Date.now = () => now;
  try {
    const run = (id) => ({ id, at: new Date(now).toISOString() });
    // A tablet whose clock runs a day ahead clears; the row and both devices take it in.
    now = T0 + 86400e3;
    const tablet = device(profile());
    clearOn(tablet);
    now = T0;
    const a = device(profile());
    const b = device(profile());
    let row = mergeInto(a, tablet.copy);
    mergeInto(b, row);
    // B runs and sends; A runs and keeps its run unsent.
    now = T0 + 3600e3;
    b.copy = { ...b.copy, runs: [run('b-secret')] };
    row = mergeInto(b, row);
    now = T0 + 2 * 3600e3;
    a.copy = { ...a.copy, runs: [run('a-1')] };
    // B clears on purpose and sends it; A, which hasn't pulled since, clears minutes later and undoes.
    now = T0 + 3 * 3600e3;
    const bClear = clearOn(b);
    row = mergeInto(b, row);
    now += 120e3;
    const aClear = clearOn(a);
    assert.equal(aClear.marker.split('~')[0], bClear.marker.split('~')[0]);
    undoOn(a, aClear);
    row = mergeInto(a, row);
    assert.equal(row.historyClearedAt, bClear.marker);
    // B's tab, still open, pulls: its clear stands, and what it holds for it stays held.
    mergeInto(b, row);
    assert.deepEqual(runIds(b.copy), []);
    assert.deepEqual(b.holds[bClear.marker].map(runIds), [['b-secret']]);
    // Only B's own undo gives it back. A's run, which A held for B's clear as its push merged, follows.
    undoOn(b, bClear);
    assert.deepEqual(runIds(b.copy), ['b-secret']);
    row = mergeInto(b, row);
    assert.deepEqual(runIds(mergeInto(a, row)), ['a-1', 'b-secret']);
  } finally {
    Date.now = realNow;
  }
});

// An older clear's names can reach a copy that already shares a newer marker and take a record from it
// there. That copy is held for the older clear too, so its undo gives the record back as the copy held it:
// the clearing device may hold less of it.
for (const via of ['a copy that shares the newer marker', 'the older clear’s own copy']) {
  test(`a record an older clear’s names take under a newer marker comes back whole with that clear’s undo (via ${via})`, () => {
    const realNow = Date.now;
    const T0 = Date.UTC(2026, 9, 12, 9, 0);
    let now = T0;
    Date.now = () => now;
    try {
      const stamp = (ms) => new Date(ms).toISOString();
      const trace = (id, ms) => ({ id, at: stamp(ms), kind: 'test', text: `passage ${id}` });
      const summary = (id, ms) => ({ id, at: stamp(ms), kind: 'test', status: 'complete' });
      // A tablet whose clock runs a day ahead made the run "far"; the phone holds its trace and summary.
      const farAt = T0 + 86400e3;
      const phone = device(profile({ runs: [summary('far', farAt)], attempts: [trace('far', farAt)] }));
      // A desktop whose clock ran two days ahead made 24 runs, all later than "far" by their stamps. The
      // laptop holds them and the far run's summary: the 24-trace cap left no room for the far run's trace.
      const later = Array.from({ length: MAX_STORED_ATTEMPTS }, (_, n) => [`later${n}`, T0 + 2 * 86400e3 + n * 60e3]);
      const laptop = device(capHistory(profile({
        runs: [summary('far', farAt), ...later.map(([id, ms]) => summary(id, ms))],
        attempts: [trace('far', farAt), ...later.map(([id, ms]) => trace(id, ms))],
      })));
      assert.ok(!ids(laptop.copy.attempts).includes('far'));

      // 09:00: the laptop clears, naming all of them (each is stamped ahead of its clock).
      const older = clearOn(laptop);
      const laptopCleared = laptop.copy;
      // 09:01: the desktop, its clock put right and not yet aware of that clear, clears its 24 runs.
      now = T0 + 60e3;
      const desktop = device(profile({ runs: later.map(([id, ms]) => summary(id, ms)), attempts: later.map(([id, ms]) => trace(id, ms)) }));
      const newer = clearOn(desktop);
      assert.ok(newer.marker > older.marker);
      // The phone applies the newer clear; the far run is stamped after it and stays.
      mergeInto(phone, desktop.copy);
      assert.equal(phone.copy.historyClearedAt, newer.marker);
      assert.deepEqual(ids(phone.copy.attempts), ['far']);

      // The older clear's names reach the phone and take the far run, its marker staying the newer one.
      if (via === 'the older clear’s own copy') {
        mergeInto(phone, laptopCleared);
        mergeInto(laptop, desktop.copy);
      } else {
        mergeInto(laptop, desktop.copy);
        mergeInto(phone, laptop.copy);
      }
      assert.equal(phone.copy.historyClearedAt, newer.marker);
      assert.deepEqual([ids(phone.copy.runs), ids(phone.copy.attempts)], [[], []]);

      // The laptop undoes its clear and gives back what it held: the far run's summary alone. The newer
      // clear still keeps the desktop's runs out.
      now += 3000;
      undoOn(laptop, older);
      assert.deepEqual([ids(laptop.copy.runs), ids(laptop.copy.attempts)], [['far'], []]);
      // The phone hears of the undo and gives the far run back as it held it, trace included.
      mergeInto(phone, laptop.copy);
      assert.deepEqual([ids(phone.copy.runs), ids(phone.copy.attempts)], [['far'], ['far']]);
      assert.equal(phone.copy.historyClearedAt, newer.marker);
      assert.ok(!(older.marker in phone.holds));
      assert.deepEqual(ids(mergeInto(laptop, phone.copy).attempts), ['far']);
    } finally {
      Date.now = realNow;
    }
  });
}

// A copy remembers every clear still in force that it has applied, not only its newest marker: once that
// marker is undone, a run it made after an older clear it had applied is not taken for one from before it.
test('undoing a newer clear keeps the runs a copy made after an older clear it had applied', () => {
  const realNow = Date.now;
  const T0 = Date.UTC(2026, 9, 12, 9, 0);
  let now = T0;
  let skew = 0;
  Date.now = () => now + skew;
  try {
    const run = (id) => ({ id, at: new Date(Date.now()).toISOString(), kind: 'test' });
    // 09:00: a laptop whose clock runs an hour ahead clears (stamped 10:00); the phone and desktop take it in.
    const laptop = device(profile({ runs: [{ id: 'old', at: new Date(T0 - 3600e3).toISOString(), kind: 'test' }] }));
    skew = 3600e3;
    clearOn(laptop);
    skew = 0;
    let row = mergeInto(laptop, profile());
    const phone = device(profile());
    const desktop = device(profile());
    mergeInto(phone, row);
    mergeInto(desktop, row);
    // 09:10: the desktop clears (stamped just past 10:00) and sends it. Seconds later the phone runs and
    // sends, taking in that clear; the desktop then undoes within the toast's seconds.
    now = T0 + 10 * 60e3;
    const desktopClear = clearOn(desktop);
    row = mergeInto(desktop, row);
    now += 2000;
    phone.copy = { ...phone.copy, runs: [...phone.copy.runs, run('phone-1')] };
    row = mergeInto(phone, row);
    now += 2000;
    undoOn(desktop, desktopClear);
    row = mergeInto(desktop, row);
    // 09:12: the phone runs again and sends. Its clock stamps the run before the laptop's marker, but the
    // phone had applied that clear before making it.
    now = T0 + 12 * 60e3;
    phone.copy = { ...phone.copy, runs: [...phone.copy.runs, run('phone-2')] };
    row = mergeInto(phone, row);
    // As if the desktop had never cleared: both runs stay, in the row and on every copy.
    assert.deepEqual(runIds(row), ['phone-1', 'phone-2']);
    assert.deepEqual(runIds(phone.copy), ['phone-1', 'phone-2']);
    assert.deepEqual(runIds(mergeInto(desktop, row)), ['phone-1', 'phone-2']);
    assert.deepEqual(runIds(mergeInto(laptop, row)), ['phone-1', 'phone-2']);
    assert.ok(sameProfile(mergeInto(phone, row), row));
  } finally {
    Date.now = realNow;
  }
});

// Two devices clear without hearing of each other's clear. Once the newer clear is undone, the older one
// stands, on the copies that merged the two before the undo arrived as well, from the copy alone: a tab
// that reloads holds nothing for Undo.
test('a clear made on its own still stands after a newer clear made elsewhere is undone', () => {
  const realNow = Date.now;
  const T0 = Date.UTC(2026, 9, 12, 9, 0);
  let now = T0;
  Date.now = () => now;
  try {
    const old = { id: 'old', at: new Date(T0 - 3600e3).toISOString(), kind: 'test' };
    const laptop = device(profile({ runs: [old] }));
    const phone = device(profile({ runs: [old] }));
    const tablet = device(profile({ runs: [old] }));
    // 09:00: the laptop clears, offline. 09:05: the phone, not having heard of it, clears and sends it.
    clearOn(laptop);
    now = T0 + 5 * 60e3;
    const phoneClear = clearOn(phone);
    let row = mergeInto(phone, profile());
    // Seconds later the laptop comes online and sends its clear, and its tab reloads; then the phone
    // undoes its own.
    now += 2000;
    row = mergeInto(laptop, row);
    laptop.holds = {};
    now += 2000;
    undoOn(phone, phoneClear);
    row = mergeInto(phone, row);
    row = mergeInto(laptop, row);
    // The laptop's clear still stands: no copy brings back what it removed.
    assert.deepEqual(runIds(row), []);
    assert.equal(row.historyClearedAt, laptop.copy.historyClearedAt);
    for (const d of [phone, tablet, laptop]) assert.deepEqual(runIds(mergeInto(d, row)), []);
  } finally {
    Date.now = realNow;
  }
});

// A clear is of everything made before it, and a record an older clear named was made before that clear.
// So a clear made on a copy that knows those names keeps them too, in case the older clear is undone.
test('a clear made before an older clear’s undo arrives keeps out the records that clear named', () => {
  const realNow = Date.now;
  const T0 = Date.UTC(2026, 9, 12, 9, 0);
  let now = T0;
  Date.now = () => now;
  try {
    // A tablet whose clock runs a day ahead made "far"; the laptop holds it and sends it.
    const far = { id: 'far', at: new Date(T0 + 86400e3).toISOString(), kind: 'test' };
    const laptop = device(profile({ runs: [far] }));
    let row = mergeInto(laptop, profile());
    // 09:00: the laptop clears, naming "far" (stamped ahead of its clock), and sends it. Seconds later the
    // phone loads: it applies the clear and never holds "far". The laptop then undoes and sends that.
    const laptopClear = clearOn(laptop);
    row = mergeInto(laptop, row);
    now += 2000;
    const phone = device(profile());
    mergeInto(phone, row);
    now += 2000;
    undoOn(laptop, laptopClear);
    row = mergeInto(laptop, row);
    assert.deepEqual(runIds(row), ['far']);
    // 09:30: the phone, not having pulled since, clears and sends it.
    now = T0 + 30 * 60e3;
    const phoneClear = clearOn(phone);
    row = mergeInto(phone, row);
    assert.deepEqual(runIds(phone.copy), []);
    assert.deepEqual(runIds(row), []);
    assert.deepEqual(runIds(mergeInto(laptop, row)), []);
    // The phone's undo gives "far" back: it holds the copy it took "far" from.
    undoOn(phone, phoneClear);
    assert.deepEqual(runIds(phone.copy), ['far']);
  } finally {
    Date.now = realNow;
  }
});

test('randomised, clocks minutes apart: every clear not undone stands everywhere', () => {
  // Clocks a whole number of minutes apart, so independent clears often share a millisecond.
  const realNow = Date.now;
  const failed = [];
  try {
    for (let seed = 1; seed <= 400; seed += 1) {
      const random = seeded(seed);
      let now = Date.UTC(2026, 9, 1);
      let current = null;
      Date.now = () => now + (current?.offset || 0);
      const devices = [0, 1, 2].map(() => ({ ...device(profile({ preferences: {} })), offset: Math.floor(random() * 5 - 2) * 60000 }));
      let row = profile({ preferences: {} });
      let made = 0;
      for (let step = 0; step < 40; step += 1) {
        now += 60000;
        const d = devices[Math.floor(random() * 3)];
        current = d;
        const roll = random();
        if (roll < 0.35) d.copy = { ...d.copy, runs: [...d.copy.runs, { id: `r${made++}`, at: new Date(Date.now()).toISOString() }] };
        else if (roll < 0.5) clearOn(d);
        else if (roll < 0.6 && d.clears.length) undoOn(d, d.clears[Math.floor(random() * d.clears.length)]);
        else if (roll < 0.8) row = mergeInto(d, row);
        else mergeInto(d, row);
      }
      for (let round = 0; round < 3; round += 1) for (const d of devices) { current = d; row = mergeInto(d, row); }
      const standing = devices.flatMap((d) => d.clears.map((clear) => clear.marker));
      const newest = standing.sort().at(-1);
      if (standing.some((marker) => (row.undoneClears || []).includes(marker)) || devices.some((d) => d.copy.historyClearedAt !== newest)) failed.push(seed);
    }
  } finally {
    Date.now = realNow;
  }
  assert.deepEqual(failed, []);
});

// Differential: a clear undone before any other clear or undo leaves every copy as if it had never been
// made. The clearing device's clock runs no faster than any other: a later clear is stamped past an undone
// marker (see clearProfile), so an undone clear from a clock running ahead can move later ones. Each
// clear's id comes from the step that makes it, so both runs draw the same ids.
test('randomised: a clear undone leaves every copy as a clear never made would', () => {
  const realNow = Date.now;
  let step = 0;
  crypto.getRandomValues = (bytes) => {
    for (let n = 0; n < bytes.length; n += 1) bytes[n] = ((step * 2654435761) >>> (n * 3)) & 255;
    return bytes;
  };
  const OFFSETS = [0, -180000, 120000, 3600000, 86400000, 172800000];
  const play = (plan, clocks, skip = new Set()) => {
    let now = Date.UTC(2026, 9, 1);
    let clock = 0;
    Date.now = () => now + clock;
    const devices = clocks.map(() => ({ ...device(profile({ preferences: {} })), labelled: new Map() }));
    let row = profile({ preferences: {} });
    plan.forEach((op, n) => {
      now += 60000;
      step = n + 1;
      clock = clocks[op.dev];
      const d = devices[op.dev];
      if (op.type === 'run') {
        const at = new Date(Date.now()).toISOString();
        d.copy = capHistory({ ...d.copy, runs: [...d.copy.runs, { id: `r${n}`, at }], attempts: [...d.copy.attempts, { id: `r${n}`, at }] });
      } else if (skip.has(n)) {
        // left out of this run
      } else if (op.type === 'clear') d.labelled.set(op.label, clearOn(d));
      else if (op.type === 'undo') {
        if (d.labelled.has(op.label)) undoOn(d, d.labelled.get(op.label));
        d.labelled.delete(op.label);
      } else if (op.type === 'push') row = mergeInto(d, row);
      else if (op.type === 'pull') mergeInto(d, row);
      else mergeInto(d, devices[(op.dev + 1) % devices.length].copy);
    });
    for (let round = 0; round < 3; round += 1) devices.forEach((d, k) => { clock = clocks[k]; row = mergeInto(d, row); });
    return JSON.stringify(devices.map((d) => [runIds(d.copy), [...ids(d.copy.attempts)].sort()]));
  };
  const differ = [];
  let checked = 0;
  try {
    for (let seed = 1; seed <= 1500; seed += 1) {
      const random = seeded(seed);
      const clocks = [0, 1, 2].map(() => OFFSETS[Math.floor(random() * OFFSETS.length)]);
      const plan = [];
      let clears = 0;
      for (let n = 0; n < 60; n += 1) {
        const dev = Math.floor(random() * 3);
        const roll = random();
        if (roll < 0.5) plan.push({ dev, type: 'run' });
        else if (roll < 0.58) plan.push({ dev, type: 'clear', label: clears++ });
        else if (roll < 0.64) plan.push({ dev, type: 'undo', label: Math.floor(random() * Math.max(1, clears)) });
        else if (roll < 0.8) plan.push({ dev, type: 'push' });
        else if (roll < 0.92) plan.push({ dev, type: 'pull' });
        else plan.push({ dev, type: 'take' });
      }
      const slowest = Math.min(...clocks);
      for (const [i, op] of plan.entries()) {
        if (op.type !== 'clear' || clocks[op.dev] !== slowest) continue;
        const j = plan.findIndex((other, n) => n > i && other.type === 'undo' && other.label === op.label && other.dev === op.dev);
        if (j < 0 || plan.slice(i + 1, j).some((other) => other.type === 'clear' || other.type === 'undo')) continue;
        checked += 1;
        if (play(plan, clocks) !== play(plan, clocks, new Set([i, j]))) differ.push(seed);
        break;
      }
    }
  } finally {
    Date.now = realNow;
    delete crypto.getRandomValues;
  }
  assert.ok(checked > 200, `${checked} sequences checked`);
  assert.deepEqual(differ, []);
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
