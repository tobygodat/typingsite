import test from 'node:test';
import assert from 'node:assert/strict';
import { csvCell, runRow, runsToCsv, exportFilename, CSV_COLUMNS } from '../src/export.js';
import { CORPUS_VERSION, METRIC_VERSION } from '../src/typing.js';

test('csvCell quotes commas, quotes and newlines', () => {
  assert.equal(csvCell('plain'), 'plain');
  assert.equal(csvCell('a,b'), '"a,b"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell('line\nbreak'), '"line\nbreak"');
  assert.equal(csvCell('cr\rhere'), '"cr\rhere"');
  assert.equal(csvCell(null), '');
  assert.equal(csvCell(0), '0');
});

test('runsToCsv writes a header and one row per run summary', () => {
  const csv = runsToCsv([
    { at: '2026-10-08T10:00:00.000Z', kind: 'test', interrupted: false, errors: 2, elapsedMs: 30000, score: { wpm: 61, accuracy: 97 },
      conditions: { mode: 'time', duration: 30, punctuation: true, wordList: '200', correctionPolicy: 'relaxed', inputClass: 'touch', corpus: 'original-en-v4', metricVersion: 'stilltype-metrics-v1' } },
    { at: '2026-10-08T11:00:00.000Z', kind: 'retest, "focused"', interrupted: true, errors: 0, elapsedMs: 1234, score: { wpm: 40, accuracy: 100 },
      conditions: { mode: 'words', count: 25, punctuation: false, wordList: '1k' } },
    { at: '2026-10-08T12:00:00.000Z', kind: 'test', errors: 1, elapsedMs: 20000, score: { wpm: 55, accuracy: 99 },
      conditions: { mode: 'quote', quoteLength: 'short', difficulty: 'hard', inputClass: 'physical-keyboard' } },
  ]);
  const lines = csv.split('\r\n');
  assert.equal(lines[0], CSV_COLUMNS.join(','));
  assert.equal(lines[1], '2026-10-08T10:00:00.000Z,time,30s,200,yes,,touch input,continue on error,original-en-v4,stilltype-metrics-v1,61,97,2,30.0,test,no');
  assert.equal(lines[2], `2026-10-08T11:00:00.000Z,words,25 words,1k,no,,physical keyboard,stop on error,${CORPUS_VERSION},${METRIC_VERSION},40,100,0,1.2,"retest, ""focused""",yes`);
  assert.equal(lines[3], `2026-10-08T12:00:00.000Z,quote,short,,no,hard,physical keyboard,stop on error,${CORPUS_VERSION},${METRIC_VERSION},55,99,1,20.0,test,no`);
  assert.equal(lines[4], '');
});

test('a drill row is the one-minute timed run it was, not its baseline', () => {
  const row = runRow({ kind: 'drill', elapsedMs: 60000, score: { wpm: 50, accuracy: 98 }, errors: 3,
    conditions: { mode: 'words', count: 25, punctuation: true, wordList: '200', inputClass: 'touch' } });
  assert.deepEqual(row.slice(1, 7), ['time', '60s', '200', 'no', '', 'touch input']);
  const fromQuote = runRow({ kind: 'drill', conditions: { mode: 'quote', quoteLength: 'long', difficulty: 'hard' } });
  assert.deepEqual(fromQuote.slice(1, 6), ['time', '60s', '', 'no', '']);
});

test('runsToCsv with no runs is just the header', () => {
  assert.equal(runsToCsv([]), `${CSV_COLUMNS.join(',')}\r\n`);
});

test('exportFilename uses the local date', () => {
  assert.equal(exportFilename('runs', 'csv', new Date(2026, 0, 5)), 'stilltype-runs-2026-01-05.csv');
  assert.equal(exportFilename('data', 'json', new Date(2026, 10, 25)), 'stilltype-data-2026-11-25.json');
});
