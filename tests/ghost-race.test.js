import test from 'node:test';
import assert from 'node:assert/strict';
import { CORPUS_VERSION, METRIC_VERSION, compareAttempts, completeAttempt, conditionKey, createAttempt, replayAttempt, summarizePatterns } from '../src/typing.js';
import { recurringTargets, runRecord, trendRun } from '../src/insights.js';
import { GHOST_RACE, ghostPosition, ghostTrack, raceDetail, raceHeadline, raceOutcome, raceableBest } from '../src/ghost-race.js';

const words = { mode: 'words', duration: null, count: 10, punctuation: false, quoteLength: null, difficulty: null,
  wordList: '200', inputClass: 'physical-keyboard', correctionPolicy: 'relaxed', language: 'en',
  corpus: CORPUS_VERSION, metricVersion: METRIC_VERSION };
const timed = { ...words, mode: 'time', duration: 30, count: null };
const text = 'the cat sat on the mat';

// A finished trace typing `text` with one key every `step` ms, optionally with typos fixed later.
function trace(id, { step = 100, conditions = words, kind = 'test', typoAt = null, endedAt } = {}) {
  const attempt = createAttempt({ id, text, textId: 'generated-abc', kind, conditions });
  attempt.startedAt = 0;
  let t = 0;
  let position = 0;
  for (const char of text) {
    if (position === typoAt) {
      attempt.events.push({ type: 'insert', text: 'x', position, accepted: true, offsetMs: t });
      t += step;
      attempt.events.push({ type: 'delete', count: 1, offsetMs: t });
      t += step;
    }
    attempt.events.push({ type: 'insert', text: char, position, accepted: true, offsetMs: t });
    position += 1;
    t += step;
  }
  return completeAttempt(attempt, { endedAt: endedAt ?? t - step });
}

const profileWith = (best, attempts) => ({ bests: { [conditionKey(best.conditions)]: { wpm: best.summary.score.wpm, attemptId: best.id, at: '2026-10-01T12:00:00Z' } }, attempts });

test('a best is raceable only while its trace is kept, and says why not otherwise', () => {
  const best = trace('best');
  const key = conditionKey(words);
  assert.deepEqual(raceableBest({ bests: {}, attempts: [best] }, key), { available: false, reason: 'no-best', best: null, trace: null });
  const gone = raceableBest(profileWith(best, []), key);
  assert.equal(gone.available, false);
  assert.equal(gone.reason, 'no-trace');
  assert.equal(gone.best.attemptId, 'best');
  const kept = raceableBest(profileWith(best, [best]), key);
  assert.equal(kept.available, true);
  assert.equal(kept.trace, best);
  // A trace without keystrokes (or under other conditions) has no ghost to replay.
  assert.equal(raceableBest(profileWith(best, [{ ...best, events: [] }]), key).reason, 'no-trace');
  assert.equal(raceableBest(profileWith(best, [best]), conditionKey(timed)).reason, 'no-best');
});

test('the ghost replays the recorded caret position over time, including corrections', () => {
  const best = trace('best', { typoAt: 4 });
  const track = ghostTrack(best);
  assert.equal(track.points.at(-1).position, replayAttempt(best).typed.length);
  assert.equal(track.endMs, best.endedAt);
  assert.equal(ghostPosition(track, -5), 0);
  assert.equal(ghostPosition(track, 0), 1);
  assert.equal(ghostPosition(track, 399), 4);
  assert.equal(ghostPosition(track, 400), 5); // the typo
  assert.equal(ghostPosition(track, 500), 4); // deleted again
  assert.equal(ghostPosition(track, 600), 5);
  assert.equal(ghostPosition(track, 1e9), text.length);

  // Blocked keys under stop on error never move the caret; focus loss changes nothing either.
  const strict = createAttempt({ id: 's', text, textId: 't', conditions: { ...words, correctionPolicy: 'mandatory' } });
  strict.startedAt = 0;
  strict.events = [
    { type: 'insert', text: 't', position: 0, accepted: true, offsetMs: 0 },
    { type: 'insert', text: 'x', position: 1, accepted: true, offsetMs: 100 },
    { type: 'blocked-insert', text: 'q', position: 1, offsetMs: 200 },
    { type: 'focus-lost', offsetMs: 250 },
    { type: 'delete', count: 1, offsetMs: 300 },
  ];
  const strictTrack = ghostTrack(strict);
  assert.deepEqual(strictTrack.points.map((p) => p.position), [1, 2, 1]);
  assert.equal(strictTrack.points.at(-1).position, replayAttempt(strict).typed.length);
  assert.equal(ghostPosition(strictTrack, 250), 2);
});

test('a finished race reports the gap to the best honestly, in time or in distance', () => {
  const best = trace('best', { step: 100 });
  const faster = trace('race', { step: 90, kind: GHOST_RACE });
  const ahead = raceOutcome(best, { ...faster, fresh: false });
  assert.equal(ahead.measure, 'time');
  assert.equal(ahead.aheadMs, 200);
  assert.equal(raceHeadline(ahead), 'Finished 0.2 s ahead of your best');
  assert.equal(raceDetail(ahead), `${faster.summary.score.wpm} vs ${best.summary.score.wpm} wpm · 100% vs 100% accuracy, same passage and conditions.`);
  const behind = raceOutcome(best, trace('race', { step: 120, kind: GHOST_RACE }));
  assert.equal(raceHeadline(behind), 'Finished 0.4 s behind your best');
  assert.equal(raceHeadline(raceOutcome(best, trace('race', { kind: GHOST_RACE }))), 'Finished level with your best');

  // Timed: both stop on the same clock, so the gap is how far each caret got.
  const timedBest = trace('tb', { conditions: timed, endedAt: 30000 });
  const shorter = completeAttempt({ ...createAttempt({ id: 'tr', text, textId: 't', kind: GHOST_RACE, conditions: timed }), startedAt: 0,
    events: [...text.slice(0, 10)].map((char, position) => ({ type: 'insert', text: char, position, accepted: true, offsetMs: position * 100 })) }, { endedAt: 30000 });
  const distance = raceOutcome(timedBest, shorter);
  assert.equal(distance.measure, 'distance');
  assert.equal(distance.aheadChars, 10 - text.length);
  assert.equal(raceHeadline(distance), `${text.length - 10} characters behind your best at 30 s`);
});

test('interrupted races and races on other input are never compared with the best', () => {
  const best = trace('best');
  assert.equal(raceOutcome(best, { ...trace('race', { kind: GHOST_RACE }), status: 'interrupted', interrupted: true }), null);
  const touch = raceOutcome(best, trace('race', { kind: GHOST_RACE, conditions: { ...words, inputClass: 'touch' } }));
  assert.equal(touch.comparable, false);
  assert.equal(raceHeadline(touch), 'Race complete · not compared');
  assert.match(raceDetail(touch), /aren’t compared/);
});

test('races stay out of bests, trends, fresh comparisons and pattern evidence', () => {
  const best = trace('best');
  const race = { ...trace('race', { kind: GHOST_RACE, typoAt: 2 }), fresh: false };
  assert.equal(summarizePatterns([race]).attemptCount, 0);
  assert.equal(summarizePatterns([best, race]).attemptCount, 1);
  assert.deepEqual(runRecord(race).patterns, []);
  assert.equal(trendRun(runRecord(race)), false);
  assert.equal(compareAttempts(best, { ...race, textId: 'other', fresh: true }).comparable, false);
  assert.equal(compareAttempts({ ...race, textId: 'other' }, best).comparable, false);
  const records = [runRecord({ ...race, id: 'r1' }), runRecord({ ...race, id: 'r2' })].map((r) => ({ ...r, at: '2026-10-01T12:00:00Z' }));
  assert.deepEqual(recurringTargets(records, [], words), []);
});
