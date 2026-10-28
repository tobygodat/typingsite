import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeInboxEntry, parseLegacyRaceResult, raceOutcome, raceResultOf, raceResultParts, raceResultText, rematchControls, tallyView } from '../src/race-result.js';
import { formatSpeed } from '../src/units.js';

// Exactly what the inbox saved for a race result before the speed unit setting:
// `${lead} ${opponent.name}: ${me.wpm || 0} wpm to ${opponent.wpm || 0}.`
const legacy = (text, extra = {}) => ({ id: 'result:room-1', kind: 'result', roomId: 'room-1', until: '2026-10-01T12:00:00.000Z',
  conditions: { mode: 'quote' }, text, at: '2026-09-30T12:00:00.000Z', read: true, ...extra });

test('a legacy result sentence reads back as its scores, for every lead', () => {
  assert.deepEqual(parseLegacyRaceResult('You beat Lin: 72 wpm to 65.'), { lead: 'You beat', opponent: 'Lin', wpm: [72, 65] });
  assert.deepEqual(parseLegacyRaceResult('You raced Lin: 58 wpm to 64.'), { lead: 'You raced', opponent: 'Lin', wpm: [58, 64] });
  assert.deepEqual(parseLegacyRaceResult('You tied with Lin: 70 wpm to 70.'), { lead: 'You tied with', opponent: 'Lin', wpm: [70, 70] });
  // Accuracy breaks a wpm tie, so a beat or a loss can share a score; a missing score was saved as 0.
  assert.deepEqual(parseLegacyRaceResult('You beat Lin: 70 wpm to 70.'), { lead: 'You beat', opponent: 'Lin', wpm: [70, 70] });
  assert.deepEqual(parseLegacyRaceResult('You raced Lin: 0 wpm to 0.'), { lead: 'You raced', opponent: 'Lin', wpm: [0, 0] });
  // Names are free text (1–40 characters); the scores are always the sentence's last ": N wpm to N.".
  assert.deepEqual(parseLegacyRaceResult('You beat Ada Lovelace-King: 104 wpm to 99.'), { lead: 'You beat', opponent: 'Ada Lovelace-King', wpm: [104, 99] });
  assert.deepEqual(parseLegacyRaceResult('You raced Sam: 5 wpm to 9.: 61 wpm to 64.'), { lead: 'You raced', opponent: 'Sam: 5 wpm to 9.', wpm: [61, 64] });
  assert.deepEqual(parseLegacyRaceResult('You beat You beat Lin: 80 wpm to 70.'), { lead: 'You beat', opponent: 'You beat Lin', wpm: [80, 70] });
});

test('a read-back sentence rewords to the saved text in wpm and converts in cpm', () => {
  for (const text of ['You beat Lin: 72 wpm to 65.', 'You raced Sam: 5 wpm to 9.: 61 wpm to 64.', 'You tied with 李: 0 wpm to 0.']) {
    const race = parseLegacyRaceResult(text);
    assert.ok(race, text);
    assert.equal(raceResultText(race), text);
  }

  const cpm = (wpm, options) => formatSpeed(wpm, options, 'cpm');
  assert.equal(raceResultParts(parseLegacyRaceResult('You beat Lin: 72 wpm to 65.'), cpm).join(''), 'You beat Lin: 360 cpm to 325.');
});

test('anything that is not exactly the legacy sentence is left as text', () => {
  for (const text of [
    'You beat Lin: 360 cpm to 325.', // already a cpm sentence: never read as wpm
    'You beat Lin: 72 wpm to 65', // no full stop
    'You beat Lin: 72 wpm to 65. ', // trailing space
    ' You beat Lin: 72 wpm to 65.',
    'You beat Lin: 72 WPM to 65.',
    'You beat Lin: 72 wpm to 65 wpm.',
    'You beat Lin: 72.5 wpm to 65.', // the service rounds to whole wpm
    'You beat Lin: 072 wpm to 65.', // never written with leading zeros
    'You beat Lin: -2 wpm to 65.',
    'You beat Lin:  72 wpm to 65.',
    'You beat Lin 72 wpm to 65.',
    'You beat : 72 wpm to 65.', // no name
    'You won against Lin: 72 wpm to 65.', // not a lead the app wrote
    'you beat Lin: 72 wpm to 65.',
    'You tied with Lin: 72 wpm to 65.', // a lead the scores contradict
    'You beat Lin: 60 wpm to 65.',
    'You raced Lin: 72 wpm to 65.',
    'You beat Lin: 99999999999999999999 wpm to 65.', // past exact numbers
    'Lin challenged you to a race.',
    'Lin joined your race.',
    '',
  ]) assert.equal(parseLegacyRaceResult(text), null, text);

  for (const value of [undefined, null, 72, {}, ['You beat Lin: 72 wpm to 65.']]) assert.equal(parseLegacyRaceResult(value), null);
});

test('loading a legacy result adds its scores and keeps its text', () => {
  const saved = legacy('You beat Lin: 72 wpm to 65.');
  const before = structuredClone(saved);
  const loaded = normalizeInboxEntry(saved);
  assert.deepEqual(loaded, { ...before, race: { lead: 'You beat', opponent: 'Lin', wpm: [72, 65] } });
  assert.equal(loaded.text, 'You beat Lin: 72 wpm to 65.');
  // The saved object itself is not touched.
  assert.deepEqual(saved, before);
  assert.deepEqual(raceResultOf(loaded), { lead: 'You beat', opponent: 'Lin', wpm: [72, 65] });
});

test('entries that are current, unreadable or not results come back unchanged', () => {
  const current = legacy('You beat Lin: 72 wpm to 65.', { race: { lead: 'You beat', opponent: 'Lin', wpm: [72, 65] } });
  const odd = legacy('You beat Lin: 72.5 wpm to 65.');
  const cpm = legacy('You beat Lin: 360 cpm to 325.');
  const invite = { id: 'invite:r', kind: 'invite', roomId: 'r', text: 'You beat Lin: 72 wpm to 65.' };
  const joined = { id: 'joined:r', kind: 'joined', roomId: 'r', text: 'Lin joined your race.' };

  for (const entry of [current, odd, cpm, invite, joined, null, undefined]) assert.equal(normalizeInboxEntry(entry), entry);

  // Unreadable entries have no scores, so they are shown as written.
  for (const entry of [odd, cpm, invite, joined]) assert.equal(raceResultOf(entry), null);
  assert.equal(raceResultOf(current), current.race);
});

test('a saved race shape is used only when it holds two scores', () => {
  for (const race of [null, {}, { lead: 'You beat', opponent: 'Lin', wpm: [72] }, { lead: 'You beat', opponent: 'Lin', wpm: [72, '65'] },
    { lead: 'You beat', opponent: 'Lin', wpm: [72, Number.NaN] }, { lead: 'You beat', opponent: 'Lin', wpm: [72, -1] }, { lead: 'You beat', wpm: [72, 65] }]) {
    const entry = legacy('You beat Lin: 72 wpm to 65.', { race });
    assert.equal(raceResultOf(entry), null, JSON.stringify(race));
    // A race field already there, however odd, is never overwritten.
    assert.equal(normalizeInboxEntry(entry), entry);
  }
});

test('normalising is idempotent', () => {
  for (const text of ['You beat Lin: 72 wpm to 65.', 'You tied with Lin: 70 wpm to 70.', 'You beat Lin: 72.5 wpm to 65.', 'Lin joined your race.']) {
    const once = normalizeInboxEntry(legacy(text));
    const twice = normalizeInboxEntry(once);
    assert.equal(twice, once, text);
    assert.deepEqual(normalizeInboxEntry(JSON.parse(JSON.stringify(once))), once, text);
    assert.equal(once.text, text);
  }
});

test('the faster racer wins; accuracy breaks a wpm tie; equal on both is a tie', () => {
  assert.equal(raceOutcome({ wpm: 92, accuracy: 90 }, { wpm: 88, accuracy: 100 }), 'won');
  assert.equal(raceOutcome({ wpm: 88, accuracy: 100 }, { wpm: 92, accuracy: 90 }), 'lost');
  assert.equal(raceOutcome({ wpm: 70, accuracy: 97 }, { wpm: 70, accuracy: 95 }), 'won');
  assert.equal(raceOutcome({ wpm: 70, accuracy: 95 }, { wpm: 70, accuracy: 97 }), 'lost');
  assert.equal(raceOutcome({ wpm: 70, accuracy: 96 }, { wpm: 70, accuracy: 96 }), 'tied');
  // A racer with no score yet reads as 0 wpm at 100%, as the service reports one.
  assert.equal(raceOutcome({}, { wpm: 0, accuracy: 100 }), 'tied');
  assert.equal(raceOutcome({ wpm: 1 }, {}), 'won');
});

test('the tally reads mine first and raises the winner\'s figure; without one there is nothing to show', () => {
  assert.deepEqual(tallyView([3, 1], 'won'), { mine: 3, theirs: 1, raised: 'mine' });
  assert.deepEqual(tallyView([1, 3], 'lost'), { mine: 1, theirs: 3, raised: 'theirs' });
  assert.deepEqual(tallyView([2, 2], 'tied'), { mine: 2, theirs: 2, raised: null });
  assert.deepEqual(tallyView([0, 0], 'tied'), { mine: 0, theirs: 0, raised: null });

  // A guest on either side, or a service from before tallies.
  for (const tally of [null, undefined, [], [1], [1, '2'], [1.5, 0], { mine: 1, theirs: 0 }]) assert.equal(tallyView(tally, 'won'), null);
});

test('each racer picks Rematch on their own; both picked starts it; a racer who left ends the choice', () => {
  const open = { rematch: false, left: false };
  const picked = { rematch: true, left: false };
  assert.deepEqual(rematchControls(open, open), { mine: 'open', theirs: 'open', starting: false });
  assert.deepEqual(rematchControls(picked, open), { mine: 'chosen', theirs: 'open', starting: false });
  assert.deepEqual(rematchControls(open, picked), { mine: 'open', theirs: 'chosen', starting: false });
  assert.deepEqual(rematchControls(picked, picked), { mine: 'chosen', theirs: 'chosen', starting: true });
  assert.deepEqual(rematchControls(picked, { rematch: false, left: true }), { mine: 'inactive', theirs: 'left', starting: false });
  assert.deepEqual(rematchControls(open, { left: true }), { mine: 'inactive', theirs: 'left', starting: false });
  // A service from before picks sends neither flag: both read as not picked.
  assert.deepEqual(rematchControls({}, {}), { mine: 'open', theirs: 'open', starting: false });
});
