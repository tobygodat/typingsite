import test from 'node:test';
import assert from 'node:assert/strict';
import { learnerEvidence } from '../src/learner.js';
import { addAnomalies, emptyAnomalies, keptParticipants, parseRow, participantRuns, sentenceRun, shiftedMisses, splitOf, timestampFlags } from '../scripts/keystrokes-to-runs.mjs';

const KEYBOARD = 'physical-keyboard:qwerty';
const START = 1_473_275_372_000;
const STEP_MS = 120;
const CODES = { ' ': 32, ',': 188, '.': 190, "'": 222, BKSP: 8, SHIFT: 16 };
const codeOf = (key) => CODES[key] ?? key.toUpperCase().charCodeAt(0);

// The dataset's rows for one sentence: each key is its LETTER, or [LETTER, keyCode] to log one the way the
// dataset sometimes does.
function rows(sentence, input, keys, { participant = '100001', section = '1', at = START } = {}) {
  return keys.map((key, index) => {
    const [letter, code] = Array.isArray(key) ? key : [key, codeOf(key)];
    const press = at + index * STEP_MS;

    return parseRow([participant, section, sentence, input, index + 1, press, press + 80, letter, code].join('\t'));
  });
}

const unitsOf = (run) => new Map(learnerEvidence([run], KEYBOARD)[0].units.map((unit) => [unit.unit, unit]));

test('a header row and a short row are not keystrokes', () => {
  assert.equal(parseRow('PARTICIPANT_ID\tTEST_SECTION_ID\tSENTENCE\tUSER_INPUT\tKEYSTROKE_ID\tPRESS_TIME\tRELEASE_TIME\tLETTER\tKEYCODE'), null);
  assert.equal(parseRow('100001\t1\tthe'), null);
});

test('a cleanly typed sentence is evidence the learner reads, with each pair tried once and none missed', () => {
  const { run } = sentenceRun(rows('the then', 'the then', [...'the then']));
  const units = unitsOf(run);

  assert.equal(run.status, 'complete');
  assert.deepEqual([units.get('th').seen, units.get('th').errors], [2, 0]);
  assert.deepEqual([units.get('he').seen, units.get('he').errors], [2, 0]);
  assert.equal(units.get('th').timed, 2);
});

test('a letter typed wrong and corrected is a first-try miss of the pair it ends, and the sentence is kept', () => {
  const { run } = sentenceRun(rows('the then', 'the then', ['t', 'j', 'BKSP', 'h', 'e', ' ', 't', 'h', 'e', 'n']));
  const th = unitsOf(run).get('th');

  assert.deepEqual([th.seen, th.errors], [2, 1]);
});

test('a sentence whose log is missing a keystroke is left out', () => {
  assert.deepEqual(sentenceRun(rows('the then', 'the then', [...'the ten'])), { dropped: 'replay-differs' });
});

test('a sentence submitted with a slip left in is left out', () => {
  assert.deepEqual(sentenceRun(rows('the then', 'the ten', [...'the ten'])), { dropped: 'not-the-sentence' });
});

test('a sentence with no typing key is left out', () => {
  assert.deepEqual(sentenceRun(rows('the', '', ['SHIFT'])), { dropped: 'no-keys' });
});

test('a letter key is read from its key code when the dataset logged no letter or the wrong one', () => {
  const kept = sentenceRun(rows('the them', 'the them', ['t', ['', 72], 'e', ' ', 't', 'h', 'e', [',', 77]]));

  assert.equal(kept.run.status, 'complete');
});

test('a capital logged with no letter takes its case from the Shift held over it', () => {
  const sentence = 'The';
  const typed = rows(sentence, sentence, ['SHIFT', ['', 84], 'h', 'e']);
  typed[0].releaseMs = typed[1].pressMs + 10;

  assert.equal(sentenceRun(typed).run.status, 'complete');
});

test('backspace logged as its control character still deletes', () => {
  const kept = sentenceRun(rows('the', 'the', ['t', 'j', ['\b', 8], 'h', 'e']));

  assert.equal(kept.run.status, 'complete');
});

test('keys pressed out of file order are replayed in the order pressed', () => {
  const typed = rows('the', 'the', [...'the']);

  assert.equal(sentenceRun([typed[2], typed[0], typed[1]]).run.status, 'complete');
});

test("a participant's runs come out in the order typed, with the dropped sentences counted by reason", () => {
  const later = rows('the then', 'the then', [...'the then'], { section: '7', at: START + 60_000 });
  const first = rows('then the', 'then the', [...'then the'], { section: '9', at: START });
  const broken = rows('the then', 'the then', [...'the ten'], { section: '8', at: START + 120_000 });
  const { kept, dropped, sentences } = participantRuns([...later, ...first, ...broken]);

  assert.deepEqual(kept.map((item) => item.run.id), ['100001-9', '100001-7']);
  assert.deepEqual(dropped, { 'replay-differs': 1 });
  assert.equal(sentences, 3);
});

test('three wrong first tries in a row count as shifted, and a lone miss does not', () => {
  const tries = (wrong) => Array.from({ length: 12 }, (_, position) => ({ position, correct: !wrong.includes(position) }));

  assert.deepEqual(shiftedMisses(tries([2, 6, 7, 8])), { misses: 4, shifted: 3 });
  assert.deepEqual(shiftedMisses(tries([2, 5])), { misses: 2, shifted: 0 });
});

test('a participant always lands in the same split, and the splits are about 80, 10 and 10 in a hundred', () => {
  const counts = { train: 0, validation: 0, test: 0 };

  for (let id = 1; id <= 5000; id += 1) counts[splitOf(id)] += 1;

  assert.equal(splitOf('100001'), 'train');
  assert.equal(splitOf('100001'), splitOf(100001));
  assert.ok(Math.abs(counts.train - 4000) < 150 && Math.abs(counts.validation - 500) < 100 && Math.abs(counts.test - 500) < 100, JSON.stringify(counts));
});

test('only QWERTY participants on a full or laptop keyboard are kept', () => {
  const metadata = ['PARTICIPANT_ID\tAGE\tLAYOUT\tKEYBOARD_TYPE', '3\t30\tqwerty\tfull', '5\t27\tqwerty\tlaptop', '7\t13\tazerty\tfull', '9\t40\tqwerty\ton-screen'].join('\n');

  assert.deepEqual([...keptParticipants(metadata)], ['3', '5']);
});

test('a row released before it was pressed, and a sentence starting before the last ended, are timestamp anomalies', () => {
  const first = rows('the', 'the', [...'the'], { section: '1', at: START });
  const second = rows('then', 'then', [...'then'], { section: '2', at: START + 10_000 });
  const clean = timestampFlags([first, second]);

  assert.deepEqual(clean.map((flags) => [flags.releaseBeforePress, flags.outOfOrderRows, flags.startsBeforePreviousEnd]), [[0, 0, false], [0, 0, false]]);

  const reversed = rows('the', 'the', [...'the'], { section: '3', at: START + 5_000 });
  reversed[1] = { ...reversed[1], releaseMs: reversed[1].pressMs - 1 };
  const flagged = timestampFlags([first, second, reversed]);

  assert.deepEqual(flagged.map((flags) => [flags.releaseBeforePress, flags.startsBeforePreviousEnd]), [[0, false], [0, false], [1, true]]);
});

test('rows listed out of press order are benign file disorder, not a timestamp anomaly', () => {
  const typed = rows('the', 'the', [...'the']);
  const [disordered] = timestampFlags([[typed[1], typed[0], typed[2]]]);
  const tally = addAnomalies(emptyAnomalies(), [disordered]);

  assert.equal(disordered.outOfOrderRows, 1);
  assert.deepEqual(tally, { ...emptyAnomalies(), sentences: 1, rows: 3, outOfOrderRows: 1, sentencesOutOfOrder: 1, sentencesOnlyOutOfOrder: 1 });
});

test('anomalies are tallied before replay and among the runs kept, and nothing is dropped unless asked', () => {
  const good = rows('the then', 'the then', [...'the then'], { section: '1', at: START });
  const bad = rows('then the', 'then the', [...'then the'], { section: '2', at: START + 60_000 });
  bad[2] = { ...bad[2], releaseMs: bad[2].pressMs - 5 };
  const early = rows('the then', 'the then', [...'the then'], { section: '3', at: START - 30_000 });
  const unflagged = participantRuns([...good, ...bad, ...early]);

  assert.deepEqual(unflagged.kept.map((item) => item.run.id), ['100001-3', '100001-1', '100001-2']);
  assert.deepEqual(unflagged.dropped, {});
  const before = addAnomalies(emptyAnomalies(), unflagged.flags);
  const retained = addAnomalies(emptyAnomalies(), unflagged.kept.map((item) => item.flags));

  assert.deepEqual([before.sentences, before.sentencesReleaseBeforePress, before.sentencesStartingBeforePreviousEnd, before.sentencesWithTimestampAnomaly], [3, 1, 1, 2]);
  assert.deepEqual(retained, before);

  const audited = participantRuns([...good, ...bad, ...early], { dropBadTimestamps: true });

  assert.deepEqual(audited.kept.map((item) => item.run.id), ['100001-1']);
  assert.deepEqual(audited.dropped, { 'bad-timestamps': 2 });
  assert.deepEqual(addAnomalies(emptyAnomalies(), audited.flags), before);
  assert.equal(addAnomalies(emptyAnomalies(), audited.kept.map((item) => item.flags)).sentencesWithTimestampAnomaly, 0);
});

test('the default pipeline keeps exactly the runs it kept before the anomaly counters', () => {
  const good = rows('the then', 'the then', [...'the then'], { section: '1', at: START });
  const bad = rows('then the', 'then the', [...'then the'], { section: '2', at: START + 60_000 });
  bad[2] = { ...bad[2], releaseMs: bad[2].pressMs - 5 };

  assert.deepEqual(participantRuns([...good, ...bad]).kept.map((item) => item.run), [sentenceRun(good).run, sentenceRun(bad).run]);
});
