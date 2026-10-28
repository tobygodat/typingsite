import test from 'node:test';
import assert from 'node:assert/strict';
import { makeAdaptive, makePassage } from '../src/typing.js';
import { wordListIds } from '../src/words.js';

const seeded = (seed) => () => {
  seed = (seed * 16807) % 2147483647;

  return (seed - 1) / 2147483646;
};

// A word as the repeat rule sees it: lowercase, without the marks around it. Numbers and dashes have none.
const bare = (word) => word.toLowerCase().replace(/^[^a-z]+|[^a-z]+$/g, '');
const repeats = (text) => text.split(' ').map(bare).filter((word, i, words) => word && (word === words[i - 1] || word === words[i - 2]));
const settings = [[false, false], [true, false], [false, true], [true, true]];

test('no generated word equals either of the two before it, on every list and setting', () => {
  const found = [];

  for (const list of wordListIds) for (const [punctuation, numbers] of settings) for (let seed = 1; seed <= 30; seed += 1) {
    const text = makePassage(seed % 2 ? 'time' : 'words', 10 + seed * 3, punctuation, seeded(seed), list, numbers, 60);
    found.push(...repeats(text).map((word) => `${list} ${punctuation} ${numbers} seed ${seed}: ${word}`));

    if (!punctuation) assert.ok(!text.split(' ').includes('i'), 'without punctuation "i" is drawn again, as Monkeytype does with "I"');
  }

  // Adaptive text draws from the same generator: its targets are the pairs, never a doubled word.
  for (let seed = 1; seed <= 30; seed += 1) {
    const { text } = makeAdaptive(['th', 'ou'], { mode: 'time', duration: 60, punctuation: seed % 2 === 0, random: seeded(seed) });
    found.push(...repeats(text).map((word) => `adaptive seed ${seed}: ${word}`));
  }

  assert.deepEqual(found, []);
});

test('the same seed gives the same passage, and another seed another one', () => {
  for (const list of wordListIds) for (const [punctuation, numbers] of settings) for (const [mode, count] of [['time', 0], ['words', 25]]) {
    const passage = (seed) => makePassage(mode, count, punctuation, seeded(seed), list, numbers, 60);
    assert.equal(passage(11), passage(11));
    assert.notEqual(passage(11), passage(12));
  }
});

// Monkeytype's punctuateWord gives each mark its chance in turn; after a word ending in a letter every one is open.
const CHAIN = [['end', 0.1], ['double quotes', 0.01], ['single quotes', 0.011], ['brackets', 0.012], ['colon', 0.013], ['dash', 0.014], ['semicolon', 0.015], ['comma', 0.2]];

const CONTRACTIBLE = new Set(['are', 'can', 'could', 'did', 'does', 'do', 'had', 'has', 'have', 'is', 'it', 'i', 'you', 'that', 'must', 'there',
  'he', 'she', 'we', 'they', 'should', 'was', 'were', 'will', 'would', 'going']);

const mark = (word) => (/[.?!]$/.test(word) ? 'end' : /^".+"$/.test(word) ? 'double quotes' : /^'.+'$/.test(word) ? 'single quotes'
  : /^\(.+\)$/.test(word) ? 'brackets' : word.endsWith(':') ? 'colon' : word === '-' ? 'dash' : word.endsWith(';') ? 'semicolon'
    : word.endsWith(',') ? 'comma' : word.includes("'") ? 'contraction' : 'none');

test('punctuation follows Monkeytype: random marks at its rates, a capital after every sentence end', () => {
  const counts = {};
  const ends = {};
  let open = 0;
  let contractible = 0;

  for (let seed = 1; seed <= 40; seed += 1) {
    const words = makePassage('time', 0, true, seeded(seed), '200').split(' ');
    words.forEach((word, i) => {
      const previous = words[i - 1];
      const startsSentence = i === 0 || /[.?!]$/.test(previous);
      assert.equal(/^[A-Z]/.test(word), startsSentence || /^I\b/.test(word), `${previous} ${word}`);

      if (startsSentence) return assert.ok(/^[A-Z][a-z']*$/.test(word), `a sentence opens on a bare word: ${word}`);

      if (!/[a-z]$/i.test(previous)) return;
      open += 1;
      const kind = mark(word);
      counts[kind] = (counts[kind] || 0) + 1;

      if (kind === 'end') ends[word.at(-1)] = (ends[word.at(-1)] || 0) + 1;

      if (kind === 'contraction' || (kind === 'none' && CONTRACTIBLE.has(word.toLowerCase()))) contractible += 1;
    });
  }

  let rest = 1;

  for (const [kind, chance] of CHAIN) {
    const expected = rest * chance * open;
    rest *= 1 - chance;
    assert.ok(Math.abs(counts[kind] - expected) < expected * 0.2, `${kind}: ${counts[kind]} of ${open}, expected about ${Math.round(expected)}`);
  }

  // Ends are full stops 80% of the time, question and exclamation marks 10% each.
  assert.ok(Math.abs(ends['.'] / counts.end - 0.8) < 0.04 && Math.abs(ends['?'] / counts.end - 0.1) < 0.03, JSON.stringify(ends));
  // Half the words that have a contraction, and reach that step, become one.
  assert.ok(Math.abs(counts.contraction / contractible - 0.5) < 0.05, `${counts.contraction} of ${contractible}`);

  // A word test's last word ends a sentence and the one before it never does.
  for (let seed = 1; seed <= 200; seed += 1) {
    const words = makePassage('words', 5 + (seed % 40), true, seeded(seed)).split(' ');
    assert.match(words.at(-1), /[.?!]$/);
    assert.doesNotMatch(words.at(-2), /[.?!]$/);
  }
});

test('numbers replace about 1 word in 10 with 1 to 4 digits and no leading zero, as Monkeytype does', () => {
  const lengths = [0, 0, 0, 0];
  let words = 0;

  for (let seed = 1; seed <= 20; seed += 1) {
    const passage = makePassage('time', 0, seed % 2 === 0, seeded(seed), '1k', true).split(' ');
    words += passage.length;
    passage.filter((word) => /\d/.test(word)).forEach((word) => {
      assert.match(word, /^[1-9]\d{0,3}$/);
      lengths[word.length - 1] += 1;
    });
  }

  const numbers = lengths.reduce((sum, n) => sum + n, 0);
  assert.ok(Math.abs(numbers / words - 0.1) < 0.01, `${numbers} of ${words}`);
  assert.ok(lengths.every((n) => Math.abs(n / numbers - 0.25) < 0.03), lengths.join(' '));
});
