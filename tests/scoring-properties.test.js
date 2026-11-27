// Properties of scoring (ADR 0003, the metrics in PRODUCT.md) over generated keystroke timelines: right
// and wrong keys, backspaces, pauses, focus lost, keys held back by stop on error, and the watch-replay
// view going back to the start. tests/typing.test.js covers the cases one by one.
//
// Each timeline is typed by a model of the person at the keyboard: a key goes in at the caret until the
// passage is full, and a backspace takes characters back off the end. The model's own count of keys and
// wrong keys is what the score must agree with.
import test from 'node:test';
import assert from 'node:assert/strict';
import fc from './fast-check.js';
import { CHARS_PER_WORD, completeAttempt, createAttempt, replayAttempt, replayCursor, replayScoreAt, replaySpan } from '../src/typing.js';

const KEYS = ['a', 's', 'd', 'f', 'j', 'k', 'l', ' '];
const passage = fc.array(fc.constantFrom(...KEYS), { minLength: 1, maxLength: 80 }).map((chars) => chars.join(''));
const gap = fc.integer({ min: 0, max: 400 });
const otherKey = fc.integer({ min: 1, max: KEYS.length - 1 });

const step = fc.oneof(
  { weight: 8, arbitrary: fc.record({ kind: fc.constant('right'), gap }) },
  { weight: 2, arbitrary: fc.record({ kind: fc.constant('wrong'), gap, shift: otherKey }) },
  { weight: 2, arbitrary: fc.record({ kind: fc.constant('backspace'), gap, count: fc.integer({ min: 1, max: 3 }) }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('pause'), gap: fc.integer({ min: 2000, max: 20000 }) }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('focus-lost'), gap }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('held-back'), gap, shift: otherKey }) },
);

const wrongFor = (expected, shift) => KEYS[(KEYS.indexOf(expected) + shift) % KEYS.length];

function type(text, steps) {
  const attempt = createAttempt({ id: 'p', text, textId: 't', conditions: {} });
  const run = { attempt, typed: '', keys: 0, wrongKeys: 0, firstKeyAt: null, lastKeyAt: null, clock: 0 };

  for (const { kind, gap: wait, shift, count } of steps) {
    run.clock += wait;
    const expected = text[run.typed.length];

    if ((kind === 'right' || kind === 'wrong') && expected !== undefined) {
      const char = kind === 'right' ? expected : wrongFor(expected, shift);
      attempt.events.push({ type: 'insert', text: char, offsetMs: run.clock });
      run.typed += char;
      run.keys += 1;
      run.wrongKeys += kind === 'wrong' ? 1 : 0;
      run.firstKeyAt ??= run.clock;
      run.lastKeyAt = run.clock;
    } else if (kind === 'backspace') {
      attempt.events.push({ type: 'delete', count, offsetMs: run.clock });
      run.typed = run.typed.slice(0, Math.max(0, run.typed.length - count));
    } else if (kind === 'focus-lost') {
      attempt.events.push({ type: 'focus-lost', offsetMs: run.clock });
    } else if (kind === 'held-back' && expected !== undefined) {
      // Stop on error refuses the key: it is recorded, but never reaches the passage.
      attempt.events.push({ type: 'blocked-insert', text: wrongFor(expected, shift), position: run.typed.length, offsetMs: run.clock });
    }
  }

  return run;
}

const timeline = (steps = step) => fc.tuple(passage, fc.array(steps, { maxLength: 160 })).map(([text, chosen]) => type(text, chosen));
const correctChars = (text, typed) => [...typed].filter((char, i) => char === text[i]).length;

test('wpm and accuracy are whole numbers in range, whatever was typed', () => {
  fc.assert(fc.property(timeline(), ({ attempt }) => {
    const replay = replayAttempt(attempt);
    const { wpm, accuracy } = replay.score;
    assert.ok(Number.isInteger(wpm) && wpm >= 0, `wpm ${wpm}`);
    assert.ok(Number.isInteger(accuracy) && accuracy >= 0 && accuracy <= 100, `accuracy ${accuracy}`);
    assert.ok(Number.isFinite(replay.elapsedMs) && replay.elapsedMs >= 0, `elapsed ${replay.elapsedMs}`);
    assert.ok(replay.mistakes >= 0 && replay.mistakes <= replay.insertions);
    assert.ok(replay.typed.length <= attempt.text.length);
  }));
});

test('the replay holds the text the person saw, every key they pressed and every wrong one', () => {
  fc.assert(fc.property(timeline(), (run) => {
    const replay = replayAttempt(run.attempt);
    assert.equal(replay.typed, run.typed);
    assert.equal(replay.insertions, run.keys, 'held-back keys and backspaces are not insertions');
    assert.equal(replay.mistakes, run.wrongKeys, 'a wrong key counts even once it is fixed');
    assert.equal(replay.elapsedMs, run.firstKeyAt === null ? 0 : run.lastKeyAt - run.firstKeyAt, 'time runs from the first key to the last');
  }));
});

test('scores follow the metric contract: correct characters kept per minute, and right keys over all keys', () => {
  fc.assert(fc.property(timeline(), (run) => {
    const { score, elapsedMs } = replayAttempt(run.attempt);
    const minutes = elapsedMs / 60000;
    assert.equal(score.wpm, minutes > 0 ? Math.round(correctChars(run.attempt.text, run.typed) / CHARS_PER_WORD / minutes) : 0);
    assert.equal(score.accuracy, run.keys ? Math.round(((run.keys - run.wrongKeys) / run.keys) * 100) : 100);
  }));
});

test('a run with no wrong key scores 100% accuracy and no first-try errors', () => {
  const clean = fc.oneof(
    fc.record({ kind: fc.constant('right'), gap }),
    fc.record({ kind: fc.constant('backspace'), gap, count: fc.integer({ min: 1, max: 3 }) }),
    fc.record({ kind: fc.constant('pause'), gap: fc.integer({ min: 2000, max: 20000 }) }),
  );

  fc.assert(fc.property(timeline(clean), ({ attempt }) => {
    const replay = replayAttempt(attempt);
    assert.equal(replay.score.accuracy, 100);
    assert.deepEqual(replay.firstAttempts.filter((first) => !first.correct), []);
  }));
});

test('letter-pair timings are pairs of the passage, typed at most two seconds apart', () => {
  fc.assert(fc.property(timeline(), ({ attempt }) => {
    for (const { pair, durationMs, position } of replayAttempt(attempt).pairTimings) {
      assert.equal(pair, attempt.text.slice(position - 1, position + 1));
      assert.ok(durationMs >= 0 && durationMs <= 2000, `pair ${pair} took ${durationMs} ms`);
    }
  }));
});

test('the live numbers at the end of the replay are the finished run\'s score', () => {
  fc.assert(fc.property(timeline(), (run) => {
    const finished = completeAttempt(run.attempt, { endedAt: run.clock });
    const live = replayScoreAt(finished, replaySpan(finished).end);
    assert.equal(live.wpm, finished.summary.score.wpm);
    assert.equal(live.accuracy, finished.summary.score.accuracy);
    assert.equal(live.errors, finished.summary.firstAttempts.filter((first) => !first.correct).length);
  }));
});

test('watching the replay, with restarts, shows the text as it stood at every moment', () => {
  const watched = timeline().chain((run) => fc.tuple(fc.constant(run), fc.array(fc.integer({ min: 0, max: run.clock + 1000 }), { maxLength: 30 })));

  fc.assert(fc.property(watched, ([{ attempt }, moments]) => {
    const cursor = replayCursor(attempt);

    // A moment earlier than the one before is Restart: the view starts over from the beginning.
    for (const t of moments) {
      const typedBy = replayAttempt({ ...attempt, events: attempt.events.filter((event) => event.offsetMs <= t) }).typed;
      assert.equal(cursor(t), typedBy, `at ${t} ms`);
    }
  }));
});
