import test from 'node:test';
import assert from 'node:assert/strict';
import { CHARS_PER_WORD, CORPUS_VERSION, METRIC_VERSION, conditionKey, metrics } from '../src/typing.js';
import { DEFAULT_SPEED_UNIT, RAW_SPEED_DEFINITION, SPEED_DEFINITION, formatSpeed, normalizeSpeedUnit, signedNumber, speedValue, unitText, wpmFromSpeed } from '../src/units.js';
import { describeSeries } from '../src/graph.js';
import { resultParts, resultText } from '../src/ghost-race.js';
import { raceResultParts } from '../src/race-result.js';

// A speed as the inbox shows it, in cpm; on screen the figure is speedFigure, the same text.
const cpm = (wpm, options) => formatSpeed(wpm, options, 'cpm');

test('speed unit defaults to wpm and rejects anything else', () => {
  assert.equal(DEFAULT_SPEED_UNIT, 'wpm');
  assert.equal(normalizeSpeedUnit('cpm'), 'cpm');
  assert.equal(normalizeSpeedUnit('wpm'), 'wpm');
  // Old profiles have no speed unit at all; a hand-edited one may hold junk.
  for (const value of [undefined, null, '', 'CPM', 'kph', 5]) assert.equal(normalizeSpeedUnit(value), 'wpm');
});

test('cpm is the engine’s five-character word counted per character', () => {
  assert.equal(CHARS_PER_WORD, 5);
  // 50 correct characters in one minute: 10 wpm by the metric contract, so 50 cpm.
  const { wpm } = metrics('a'.repeat(50), 'a'.repeat(50), 50, 0, 60000);
  assert.equal(wpm, 10);
  assert.equal(speedValue(wpm, 'cpm'), 50);
  assert.equal(speedValue(wpm, 'wpm'), 10);
});

test('scores, bests, medians and differences convert the same way', () => {
  assert.equal(formatSpeed(77, {}, 'wpm'), '77 wpm');
  assert.equal(formatSpeed(77, {}, 'cpm'), '385 cpm');
  assert.equal(formatSpeed(0, {}, 'cpm'), '0 cpm');
  // Nothing has chosen a unit yet, so wpm.
  assert.equal(formatSpeed(64), '64 wpm');
  // Beside its own unit label, a figure is the number alone.
  assert.equal(formatSpeed(77, { bare: true }, 'cpm'), '385');
  // Differences keep their sign, with a typographic minus; a median of two runs can sit on a half,
  // and a longer median is kept to one place.
  assert.equal(formatSpeed(-3, { signed: true }, 'cpm'), '−15 cpm');
  assert.equal(formatSpeed(3, { signed: true, bare: true }, 'wpm'), '+3');
  assert.equal(formatSpeed(0, { signed: true }, 'wpm'), '0 wpm');
  assert.equal(formatSpeed(72.5, { bare: true }, 'cpm'), '362.5');
  assert.equal(formatSpeed(64 + 1 / 3, {}, 'wpm'), '64.3 wpm');
  assert.equal(formatSpeed(64 + 1 / 3, {}, 'cpm'), '321.7 cpm');
});

test('a figure entered in the chosen unit goes back to wpm, the inverse of the display', () => {
  assert.equal(wpmFromSpeed(400, 'cpm'), 80);
  assert.equal(wpmFromSpeed('400', 'cpm'), 80);
  assert.equal(wpmFromSpeed(80, 'wpm'), 80);
  assert.equal(wpmFromSpeed(80, undefined), 80);
  // Unrounded: the caller keeps whole wpm, so 333 cpm becomes 67 wpm and reads back as 335 cpm.
  assert.equal(wpmFromSpeed(333, 'cpm'), 66.6);
  assert.equal(speedValue(Math.round(wpmFromSpeed(333, 'cpm')), 'cpm'), 335);
  for (const wpm of [10, 67, 300]) assert.equal(wpmFromSpeed(speedValue(wpm, 'cpm'), 'cpm'), wpm);
});

test('the metric note names the unit and how it is derived', () => {
  assert.equal(unitText(SPEED_DEFINITION, 'wpm'), 'wpm counts correct characters kept');
  assert.equal(unitText(SPEED_DEFINITION, 'cpm'), 'cpm counts correct characters kept (wpm × 5)');
});

test('the raw speed tooltip defines the unit it is shown in', () => {
  assert.equal(unitText(RAW_SPEED_DEFINITION, 'wpm'), 'Every character typed, mistakes included: characters ÷ 5 per minute');
  assert.equal(unitText(RAW_SPEED_DEFINITION, 'cpm'), 'Every character typed, mistakes included: characters per minute');
  assert.equal(unitText(RAW_SPEED_DEFINITION), unitText(RAW_SPEED_DEFINITION, 'wpm'));
});

test('a unit template names the unit and keeps text only its unit shows', () => {
  assert.equal(unitText('live {unit} and accuracy', 'cpm'), 'live cpm and accuracy');
  assert.equal(unitText('Corrected {unit}', 'wpm'), 'Corrected wpm');
  // In this UI % is the accuracy unit, so it is never a placeholder.
  assert.equal(unitText('{unit} · 98%', 'cpm'), 'cpm · 98%');
  assert.equal(unitText('text{wpm: ÷ 5}, per minute', 'wpm'), 'text ÷ 5, per minute');
  assert.equal(unitText('text{wpm: ÷ 5}, per minute', 'cpm'), 'text, per minute');
});

test('the speed unit is not a test condition, so bests and retests keep matching', () => {
  const conditions = { mode: 'time', duration: 30, count: null, punctuation: false, quoteLength: null, difficulty: null, wordList: '200',
    inputClass: 'physical-keyboard', correctionPolicy: 'relaxed', language: 'en', corpus: CORPUS_VERSION, metricVersion: METRIC_VERSION };
  const key = 'time:30::plain:::200:physical-keyboard:relaxed:original-en-v6:stilltype-metrics-v1';
  assert.equal(conditionKey(conditions), key);
  assert.equal(conditionKey({ ...conditions, speedUnit: 'cpm' }), key);
});

test('the graph summary reads its points in the chosen unit', () => {
  const series = { points: [{ t: 1, wpm: 40, misses: 0 }, { t: 2, wpm: 60, misses: 1 }], durationS: 2 };
  assert.equal(describeSeries(series, 50), 'Speed over time: average 50 wpm, peak 60 wpm, lowest 40 wpm. 1 mistake marked.');
  assert.equal(describeSeries(series, 50, 'cpm'), 'Speed over time: average 250 cpm, peak 300 cpm, lowest 200 cpm. 1 mistake marked.');
});

test('an online race result is worded in the unit chosen when it is shown', () => {
  const race = { lead: 'You beat', opponent: 'Lin', wpm: [70, 60] };
  assert.equal(raceResultParts(race).join(''), 'You beat Lin: 70 wpm to 60.');
  assert.equal(raceResultParts(race, cpm).join(''), 'You beat Lin: 350 cpm to 300.');
});

// The inbox keeps a ghost race result as resultText wrote it, in wpm, and reads its speeds back to show
// them in the chosen unit, so the two are checked against each other on real results.
test('a ghost race result reads back from the sentence resultText writes, whatever the name', () => {
  for (const name of ['Ada', '60 wpm', 'Lin · you 5 wpm, Mo', '李']) {
    for (const role of ['sent', 'received']) {
      const challenge = { role, name, duration: null, conditions: { mode: 'words', count: 25 },
        sender: { wpm: 72, elapsedMs: 44000, correct: 130 }, result: { wpm: 65, elapsedMs: 41200, correct: 125 } };
      const text = resultText(challenge);
      const [mine, theirs] = role === 'sent' ? [72, 65] : [65, 72];
      assert.equal(resultParts(text, (wpm) => `${wpm} wpm`).join(''), text);
      assert.equal(resultParts(text, cpm).join(''), text.replace(`you ${mine} wpm, ${name} ${theirs} wpm.`, `you ${mine * 5} cpm, ${name} ${theirs * 5} cpm.`));
    }
  }
  assert.equal(resultParts('Older result text', cpm), null);
  assert.equal(resultParts('Ada’s run: a tie · you 072 wpm, Ada 72 wpm.', cpm), null);
});

test('signed differences round to one decimal and drop a trailing zero', () => {
  // Two accuracy medians a float apart: the weekly line once read "+0.30000000000000004 pp accuracy".
  assert.equal(signedNumber(96.4 - 96.1), '+0.3');
  assert.equal(signedNumber(-2), '−2');
  assert.equal(signedNumber(1.04), '+1');
  assert.equal(signedNumber(0), '0');
  assert.equal(signedNumber(-0.04), '0', 'a difference that rounds to nothing carries no sign');
  assert.equal(formatSpeed(0.1 + 0.2, { signed: true }, 'wpm'), '+0.3 wpm');
});

test('a whole figure converts first and rounds once in the unit shown', () => {
  assert.equal(formatSpeed(65.5, { whole: true }, 'cpm'), '328 cpm', 'not 66 wpm × 5 = 330');
  assert.equal(formatSpeed(65.5, { whole: true, bare: true }, 'wpm'), '66');
  assert.equal(formatSpeed(65.4, { whole: true }, 'wpm'), '65 wpm');
});
