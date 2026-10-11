import test from 'node:test';
import assert from 'node:assert/strict';
import { CHARS_PER_WORD, CORPUS_VERSION, METRIC_VERSION, conditionKey, metrics } from '../src/typing.js';
import { DEFAULT_SPEED_UNIT, formatSpeed, normalizeSpeedUnit, speedDefinition, speedValue, wpmFromSpeed } from '../src/units.js';
import { describeSeries } from '../src/graph.js';
import { raceResultText } from '../src/race-result.js';

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
  assert.equal(formatSpeed(77, 'wpm'), '77 wpm');
  assert.equal(formatSpeed(77, 'cpm'), '385 cpm');
  assert.equal(formatSpeed(0, 'cpm'), '0 cpm');
  // Differences keep their sign; a median of two runs can sit on a half.
  assert.equal(speedValue(-3, 'cpm'), -15);
  assert.equal(speedValue(2.5, 'cpm'), 12.5);
  assert.equal(formatSpeed(64, undefined), '64 wpm');
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
  assert.equal(speedDefinition('wpm'), 'wpm counts correct characters kept');
  assert.equal(speedDefinition('cpm'), 'cpm counts correct characters kept (wpm × 5)');
});

test('the speed unit is not a test condition, so bests and retests keep matching', () => {
  const conditions = { mode: 'time', duration: 30, count: null, punctuation: false, quoteLength: null, difficulty: null, wordList: '200',
    inputClass: 'physical-keyboard', correctionPolicy: 'relaxed', language: 'en', corpus: CORPUS_VERSION, metricVersion: METRIC_VERSION };
  const key = 'time:30::plain:::200:physical-keyboard:relaxed:original-en-v5:stilltype-metrics-v1';
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
  assert.equal(raceResultText(race, 'wpm'), 'You beat Lin: 70 wpm to 60.');
  assert.equal(raceResultText(race, 'cpm'), 'You beat Lin: 350 cpm to 300.');
});
