// Properties of conditionKey (ADR 0004: condition keys decide what counts as the same test) over generated
// conditions drawn from what this build offers. tests/typing.test.js pins the exact keys runs already carry.
import test from 'node:test';
import assert from 'node:assert/strict';
import fc from './fast-check.js';
import { CODE_LANGUAGES } from '../src/code-snippets.js';
import { bookIds } from '../src/books.js';
import { DEFAULT_LAYOUT, layoutIds } from '../src/layouts.js';
import { wordListIds } from '../src/words.js';
import {
  CORPUS_VERSION, CORRECTION_POLICIES, INPUT_CLASSES, METRIC_VERSION, QUOTE_DIFFICULTIES, QUOTE_LENGTHS, TEST_COUNTS, TEST_DURATIONS, conditionKey,
} from '../src/typing.js';

// Every condition that decides the test, with the values a run can carry. `only` is what the rest of the
// conditions must be for this one to matter: a code language only in code mode, quick end only where a
// mistake can stand at the end (relaxed correction, not timed).
const CONDITIONS = {
  mode: { values: ['time', 'words', 'quote', 'standard', 'custom', 'lesson', 'code', 'book'] },
  duration: { values: TEST_DURATIONS },
  count: { values: TEST_COUNTS },
  punctuation: { values: [false, true] },
  numbers: { values: [false, true] },
  quoteLength: { values: QUOTE_LENGTHS },
  difficulty: { values: QUOTE_DIFFICULTIES },
  wordList: { values: wordListIds },
  inputClass: { values: INPUT_CLASSES },
  correctionPolicy: { values: CORRECTION_POLICIES },
  corpus: { values: [CORPUS_VERSION, 'original-en-v5'] },
  metricVersion: { values: [METRIC_VERSION, 'stilltype-metrics-v0'] },
  recipe: { values: ['standard-v1', 'standard-v2'] },
  layout: { values: layoutIds },
  strictSpace: { values: [false, true] },
  codeLanguage: { values: CODE_LANGUAGES, only: { mode: 'code' } },
  book: { values: bookIds, only: { mode: 'book' } },
  quickEnd: { values: [true, false], only: { mode: 'words', correctionPolicy: 'relaxed' } },
};

// What each condition is when a run doesn't record it. Runs saved before a condition existed lack it.
const DEFAULTS = {
  punctuation: false, numbers: false, inputClass: 'physical-keyboard', correctionPolicy: 'mandatory', corpus: CORPUS_VERSION,
  metricVersion: METRIC_VERSION, recipe: null, layout: DEFAULT_LAYOUT, strictSpace: false, quickEnd: true,
};

// Settings that change how a run looks or whether it may go on, never which test it is.
const DISPLAY = {
  minimums: fc.record({ accuracy: fc.integer({ min: 80, max: 100 }), wpm: fc.integer({ min: 10, max: 120 }) }, { requiredKeys: [] }),
  fontSize: fc.constantFrom('24', '28', '32'),
  theme: fc.constantFrom('system', 'dark', 'light'),
  liveMetric: fc.constantFrom('wpm', 'cpm', 'off'),
  wordHighlight: fc.boolean(),
};

const conditions = fc.record(Object.fromEntries(Object.entries(CONDITIONS).map(([name, { values }]) => [name, fc.constantFrom(...values)])), { requiredKeys: [] });
const shuffled = (object, order) => Object.fromEntries(Object.entries(object).sort(([a], [b]) => order.indexOf(a) - order.indexOf(b)));
const NAMES = [...Object.keys(CONDITIONS), ...Object.keys(DISPLAY)];

test('the key reads only the conditions, in any order, and never a display setting or minimum', () => {
  const anyOrder = fc.shuffledSubarray(NAMES, { minLength: NAMES.length });

  fc.assert(fc.property(conditions, fc.record(DISPLAY, { requiredKeys: [] }), anyOrder, (chosen, display, order) => {
    assert.equal(conditionKey(shuffled({ ...display, ...chosen }, order)), conditionKey(chosen));
  }));
});

test('a condition at its default leaves the key as runs saved before it existed have it', () => {
  const defaults = fc.subarray(Object.keys(DEFAULTS));

  fc.assert(fc.property(conditions, defaults, (chosen, named) => {
    const filled = { ...Object.fromEntries(named.map((name) => [name, DEFAULTS[name]])), ...chosen };
    assert.equal(conditionKey(filled), conditionKey(chosen), `defaults for ${named.join(', ')}`);
  }));
});

test('changing any one condition that decides the test changes the key', () => {
  const change = fc.constantFrom(...Object.keys(CONDITIONS)).chain((name) => fc.tuple(
    fc.constant(name),
    fc.uniqueArray(fc.constantFrom(...CONDITIONS[name].values), { minLength: 2, maxLength: 2 }),
  ));

  fc.assert(fc.property(conditions, change, (chosen, [name, [before, after]]) => {
    const base = { ...chosen, ...CONDITIONS[name].only };
    assert.notEqual(conditionKey({ ...base, [name]: before }), conditionKey({ ...base, [name]: after }), `${name}: ${before} → ${after}`);
  }));
});

test('a stored run with malformed conditions still gets a key', () => {
  // Wrong types in the places older builds or a damaged copy could leave them, as JSON.parse returns them.
  // A key such as "toString" holding a non-function breaks any conversion to text; no build writes one.
  const primitive = fc.oneof(fc.string(), fc.double(), fc.boolean(), fc.constant(null));
  const plainKey = fc.string().filter((key) => !(key in Object.prototype));
  const value = fc.oneof(primitive, fc.array(primitive, { maxLength: 3 }), fc.dictionary(plainKey, primitive, { maxKeys: 3, noNullPrototype: true }));
  const stored = fc.dictionary(fc.constantFrom(...NAMES, 'unknown'), value, { maxKeys: NAMES.length, noNullPrototype: true });

  fc.assert(fc.property(stored, (stored) => {
    assert.equal(typeof conditionKey(stored), 'string');
  }));
});
