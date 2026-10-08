import test from 'node:test';
import assert from 'node:assert/strict';
import {
  compareAttempts,
  completeAttempt,
  conditionKey,
  createAttempt,
  editStats,
  makeDrill,
  makePassage,
  metrics,
  passageComplete,
  replayCursor,
  replaySpan,
  recommendTarget,
  replayAttempt,
} from '../src/typing.js';
test('speed counts correct characters at five characters per word', () => {
  assert.deepEqual(metrics('hello world', 'hello worxd', 11, 1, 30000), {wpm:4, accuracy:91});
});
test('correcting a mistake does not erase historical errors', () => {
  assert.deepEqual(editStats('he', 'hex', 'hello'), {attempts:1, mistakes:1});
  assert.deepEqual(editStats('hex', 'he', 'hello'), {attempts:0, mistakes:0});
  assert.deepEqual(editStats('he', 'hel', 'hello'), {attempts:1, mistakes:0});
  assert.deepEqual(metrics('hello', 'hello', 6, 1, 6000), {wpm:10, accuracy:83});
});
test('empty run has a finite score', () => assert.deepEqual(metrics('', '', 0, 0, 0), {wpm:0, accuracy:100}));
test('word sessions contain requested number of words and punctuation is optional', () => {
  assert.equal(makePassage('words', 25, false).split(' ').length, 25);
  assert.match(makePassage('words', 10, true, () => 0), /^The the the the the, the the the the\. The$/);
});

test('event replay retains a corrected first-attempt error and insertion accuracy', () => {
  const attempt = createAttempt({ id: 'a', text: 'the', textId: 'one', conditions: {} });
  attempt.events = [
    { type: 'insert', text: 't', offsetMs: 0 },
    { type: 'insert', text: 'x', offsetMs: 100 },
    { type: 'delete', count: 1, offsetMs: 200 },
    { type: 'insert', text: 'h', offsetMs: 300 },
    { type: 'insert', text: 'e', offsetMs: 400 },
  ];
  attempt.startedAt = 0;
  attempt.endedAt = 6000;
  const replay = replayAttempt(attempt);
  assert.equal(replay.typed, 'the');
  assert.equal(replay.firstAttempts.find((entry) => entry.position === 1).correct, false);
  assert.deepEqual(replay.score, { wpm: 6, accuracy: 75 });
  assert.deepEqual(replay.pairTimings.map((entry) => entry.pair), []);
});

test('relaxed correction completes with retained errors and a distinct comparison key', () => {
  const relaxed = createAttempt({ id: 'relaxed', text: 'the', textId: 'one', conditions: { correctionPolicy: 'relaxed' } });
  relaxed.events = [
    { type: 'insert', text: 't', offsetMs: 0 },
    { type: 'insert', text: 'x', offsetMs: 100 },
    { type: 'insert', text: 'e', offsetMs: 200 },
  ];
  relaxed.startedAt = 0;
  relaxed.endedAt = 1000;
  const replay = replayAttempt(relaxed);
  assert.equal(replay.typed, 'txe');
  assert.equal(replay.firstAttempts.find((entry) => entry.position === 1).correct, false);
  assert.deepEqual(replay.score, { wpm: 24, accuracy: 67 });
  assert.equal(passageComplete(relaxed, replay.typed), true);
  assert.equal(passageComplete({ ...relaxed, conditions: { correctionPolicy: 'mandatory' } }, replay.typed), false);
  assert.notEqual(conditionKey(relaxed.conditions), conditionKey({ correctionPolicy: 'mandatory' }));
});

test('recommendations stay general below the evidence threshold', () => {
  const attempt = createAttempt({ id: 'a', text: 'the', textId: 'one', conditions: {} });
  attempt.events = [
    { type: 'insert', text: 't', offsetMs: 0 },
    { type: 'insert', text: 'x', offsetMs: 100 },
  ];
  attempt.startedAt = 0;
  attempt.endedAt = 1000;
  const complete = completeAttempt(attempt, { endedAt: 1000 });
  assert.equal(recommendTarget([complete]).kind, 'general');
});

test('fresh comparable attempts report mixed movement honestly', () => {
  const before = { status: 'complete', kind: 'test', textId: 'one', metricVersion: 'stilltype-metrics-v1', interrupted: false, conditions: { mode: 'time', duration: 30 }, summary: { score: { wpm: 50, accuracy: 98 } } };
  const after = { status: 'complete', kind: 'retest', textId: 'two', metricVersion: 'stilltype-metrics-v1', interrupted: false, fresh: true, conditions: { mode: 'time', duration: 30 }, summary: { score: { wpm: 55, accuracy: 96 } } };
  assert.equal(compareAttempts(before, after).state, 'mixed');
});

test('target drills use real corpus words and repeat the requested pair', () => {
  const drill = makeDrill('br');
  assert.ok((drill.text.match(/br/g) || []).length >= 10);
  assert.equal(drill.text.split(' ').every((word) => word.includes('br')), true);
});

test('generated passages draw from the selected common-word list', async () => {
  const { DEFAULT_WORD_LIST, wordList, wordListIds } = await import('../src/words.js');
  assert.deepEqual(wordListIds, ['200', '1k', '5k', '10k']);
  assert.equal(DEFAULT_WORD_LIST, '200');
  assert.equal(wordList('200').length, 200);
  assert.deepEqual(wordList('200').slice(0, 6), ['the', 'be', 'of', 'and', 'a', 'to']);
  assert.equal(wordList('1k').length, 1000);
  assert.ok(wordList('5k').length > 4500 && wordList('10k').length > 9000);
  assert.equal(wordList('unknown'), wordList('200'));
  for (const id of wordListIds) {
    const words = new Set(wordList(id));
    assert.equal(words.size, wordList(id).length);
    assert.ok(wordList(id).every((word) => /^[a-z]+$/.test(word)), `${id} has only lowercase letters`);
    let seed = 1;
    const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const passage = makePassage('time', 0, false, random, id).split(' ');
    assert.ok(passage.every((word) => words.has(word)));
  }
  const bank = wordList(DEFAULT_WORD_LIST);
  assert.match(makePassage('words', 10, true, () => (bank.indexOf('i') + 0.5) / bank.length), /\bI\b/);
  assert.notEqual(conditionKey({ mode: 'time', wordList: '1k' }), conditionKey({ mode: 'time', wordList: '5k' }));
});

test('replayCursor replays the typed text as it was and ends on the scored result', () => {
  const attempt = createAttempt({ id: 'r', text: 'the cat' });
  attempt.events.push(
    { type: 'insert', text: 't', offsetMs: 0 },
    { type: 'insert', text: 'x', offsetMs: 100 },
    { type: 'delete', count: 1, offsetMs: 200 },
    { type: 'insert', text: 'h', offsetMs: 300 },
    { type: 'insert', text: 'e', offsetMs: 400 },
    { type: 'insert', text: ' ', offsetMs: 500 },
    { type: 'insert', text: 'c', offsetMs: 600 },
    { type: 'insert', text: 'q', offsetMs: 700 },
    { type: 'insert', text: 't', offsetMs: 800 },
  );
  const completed = completeAttempt(attempt, { endedAt: 800 });
  const typedAt = replayCursor(completed);
  assert.equal(typedAt(150), 'tx');
  assert.equal(typedAt(250), 't');
  assert.equal(typedAt(replaySpan(completed).end), completed.summary.typed);
  // Going back (Restart) starts over.
  assert.equal(typedAt(0), 't');
  assert.equal(typedAt(450), 'the');
  assert.deepEqual(replaySpan(completed), { start: 0, end: 800 });
  // A timed run that idles before the timer ends replays to the scored end, not the last key.
  const timed = completeAttempt({ ...attempt, startedAt: 0 }, { endedAt: 15000 });
  assert.deepEqual(replaySpan(timed), { start: 0, end: timed.endedAt });
  assert.equal(replaySpan(timed).end - replaySpan(timed).start, timed.summary.elapsedMs);
});

test('replayCursor matches replayAttempt at every prefix of the events', () => {
  let seed = 11;
  const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const pick = (items) => items[Math.floor(random() * items.length)];
  for (let run = 0; run < 40; run += 1) {
    const text = makePassage('words', 12, run % 2 === 0, random);
    const attempt = createAttempt({ id: `p${run}`, text });
    let offsetMs = 0;
    let length = 0;
    for (let i = 0; i < 120; i += 1) {
      offsetMs += pick([0, 1, 37, 120]);
      const roll = random();
      // Every event shape the recorder writes, plus the ones replayAttempt skips or truncates.
      const event = roll < 0.55 ? { type: 'insert', text: random() < 0.8 ? text[length] || 'z' : 'x', position: length, accepted: true }
        : roll < 0.62 ? { type: 'insert', text: pick(['ab', 'q', '\n', '', 'é']) }
        : roll < 0.67 ? { type: 'insert', text: 'k', position: pick([length, text.length, text.length + 3]), accepted: random() < 0.5 }
        : roll < 0.72 ? { type: 'blocked-insert', text: 'y', position: Math.max(0, length - 1) }
        : roll < 0.88 ? { type: 'delete', count: pick([1, 1, 2, 5, undefined, 0, -1]) }
        : { type: pick(['focus-lost', 'composition']) };
      attempt.events.push({ ...event, offsetMs });
      length = replayAttempt(attempt).typed.length;
    }
    const typedAt = replayCursor(attempt);
    attempt.events.forEach((event, index) => {
      // Events sharing an offset come due together, so compare at the last one of each offset.
      if (attempt.events[index + 1]?.offsetMs === event.offsetMs) return;
      const expected = replayAttempt({ ...attempt, events: attempt.events.slice(0, index + 1) }).typed;
      assert.equal(typedAt(event.offsetMs), expected, `run ${run}, event ${index}`);
    });
    assert.equal(typedAt(Infinity), replayAttempt(attempt).typed);
    // Seeking back and forward again lands on the same text.
    const middle = attempt.events[60].offsetMs;
    assert.equal(typedAt(middle), replayAttempt({ ...attempt, events: attempt.events.filter((event) => event.offsetMs <= middle) }).typed);
  }
});
