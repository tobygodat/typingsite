import test from 'node:test';
import assert from 'node:assert/strict';
import { stat } from 'node:fs/promises';
import { BOOKS, BOOK_VERSION, PAGE_WORDS, bookName, bookPage, bookPlace, openBook, paginate } from '../src/books.js';
import { BOOK_TEXTS } from '../src/book-texts.js';
import { CORPUS_VERSION, METRIC_VERSION, conditionKey } from '../src/typing.js';
import { conditionParts, shapeOf, trendRun } from '../src/insights.js';
import { preferencesInUse } from '../src/profile.js';
import { normalise } from '../scripts/build-book-texts.mjs';

const bookConditions = { mode: 'book', duration: null, count: null, punctuation: true, numbers: false, quoteLength: null, difficulty: null, wordList: null,
  book: 'alice', inputClass: 'physical-keyboard', correctionPolicy: 'relaxed', language: 'en', corpus: BOOK_VERSION, metricVersion: METRIC_VERSION };

test('four books with their first two sections and no more than 150 KB of text', async () => {
  assert.deepEqual(BOOKS.map((book) => book.id), ['alice', 'pride', 'sherlock', 'frankenstein']);

  for (const book of BOOKS) assert.equal(BOOK_TEXTS[book.id].length, 2, book.id);
  assert.match(BOOK_TEXTS.pride[0].paragraphs[0], /^It is a truth universally acknowledged, that a single man in possession of a good fortune must be in want of a wife\.$/);
  assert.ok((await stat(new URL('../src/book-texts.js', import.meta.url))).size < 150_000);
  assert.equal(bookName('sherlock'), 'sherlock holmes');
});

test('every page is plain printable ASCII the engine can type, and pages keep every word in order', () => {
  const ids = new Set();

  for (const { id } of BOOKS) {
    const pages = openBook(id);
    assert.ok(pages.length > 20, id);
    pages.forEach((page, index) => {
      assert.equal(page.page, index);
      assert.match(page.text, /^[\x21-\x7e]+(?: [\x21-\x7e]+)*$/, page.id);
      const words = page.text.split(' ').length;
      assert.ok(words >= PAGE_WORDS.min && words <= PAGE_WORDS.max, `${page.id}: ${words} words`);
      assert.ok(!ids.has(page.id), page.id);
      ids.add(page.id);
    });
    assert.equal(pages.map((page) => page.text).join(' '), BOOK_TEXTS[id].flatMap((section) => section.paragraphs).join(' '));
    // Each section starts on a new page.
    assert.ok(pages.some((page) => page.text.startsWith(BOOK_TEXTS[id][1].paragraphs[0].split(' ').slice(0, 8).join(' '))), id);
  }
});

test('pagination is deterministic and prefers paragraph and sentence ends', () => {
  const sentence = (n) => `${Array.from({ length: 9 }, (_, i) => `Word${n}${i}`).join(' ')} end.`;
  const paragraphs = [Array.from({ length: 6 }, (_, i) => sentence(i)).join(' '), Array.from({ length: 6 }, (_, i) => sentence(i + 6)).join(' ')];
  const pages = paginate(paragraphs);
  assert.deepEqual(pages, paginate(paragraphs));
  assert.deepEqual(pages, paragraphs);
  // One long paragraph still splits at a sentence end near the target.
  const long = paginate([Array.from({ length: 14 }, (_, i) => sentence(i)).join(' ')]);
  assert.ok(long.every((page) => page.endsWith('end.')));
  assert.ok(long.every((page) => page.split(' ').length <= PAGE_WORDS.max));
  // "Mr." is not the end of a sentence.
  const bennet = paginate([`${'a '.repeat(PAGE_WORDS.target - 2)}said Mr. Bennet. ${'B '.repeat(60).trim()} c.`]);
  assert.ok(bennet[0].endsWith('said Mr. Bennet.'));
});

test('the place in a book follows the latest counted run on one of its pages, and wraps after the last', () => {
  const pages = openBook('alice');
  const run = (page, overrides = {}) => ({ kind: 'test', status: 'complete', interrupted: false, conditions: bookConditions, textId: pages[page].id, ...overrides });
  assert.equal(bookPlace([], 'alice'), 0);
  assert.equal(bookPlace([run(0)], 'alice'), 1);
  assert.equal(bookPlace([run(0), run(4), run(2)], 'alice'), 3);
  // Interrupted runs, other books and other modes don't move it.
  assert.equal(bookPlace([run(2), run(5, { status: 'interrupted', interrupted: true })], 'alice'), 3);
  assert.equal(bookPlace([run(2), { ...run(5), conditions: { ...bookConditions, book: 'pride' } }], 'alice'), 3);
  assert.equal(bookPlace([run(2), { ...run(5), conditions: { ...bookConditions, mode: 'quote' } }], 'alice'), 3);
  // A retest at book conditions moves it like a test; a drill at book conditions types no page.
  assert.equal(bookPlace([run(2), run(3, { kind: 'retest' })], 'alice'), 4);
  assert.equal(bookPlace([run(2), run(0, { kind: 'drill', textId: 'drill-th-123' })], 'alice'), 3);
  // After the last page, page 1; a page from another text version isn't found, so page 1 too.
  assert.equal(bookPlace([run(pages.length - 1)], 'alice'), 0);
  assert.equal(bookPlace([run(3, { textId: 'book-alice-c1p4-oldhash' })], 'alice'), 0);
});

test('a page number is read back from the page id', () => {
  const pages = openBook('frankenstein');
  assert.equal(bookPage(pages[0].id), 1);
  assert.equal(bookPage(pages[11].id), 12);
  assert.equal(bookPage('book-frankenstein-c1p1-oldhash'), null);
  assert.equal(bookPage('quote-12'), null);
  assert.equal(bookPage(undefined), null);
});

test('book pages key by book and text version, apart from every other mode', () => {
  const practice = { mode: 'time', duration: 30, count: null, punctuation: false, quoteLength: null, difficulty: null, wordList: '200',
    inputClass: 'physical-keyboard', correctionPolicy: 'relaxed', language: 'en', corpus: CORPUS_VERSION, metricVersion: METRIC_VERSION };

  assert.equal(conditionKey(practice), 'time:30::plain:::200:physical-keyboard:relaxed:original-en-v6:stilltype-metrics-v1');
  assert.equal(conditionKey(bookConditions), 'book-alice:::punctuation::::physical-keyboard:relaxed:gutenberg-en-v1:stilltype-metrics-v1');
  assert.notEqual(conditionKey({ ...bookConditions, book: 'pride' }), conditionKey(bookConditions));
  assert.notEqual(conditionKey({ ...bookConditions, corpus: 'gutenberg-en-v2' }), conditionKey(bookConditions));
  assert.equal(shapeOf(bookConditions), 'book:alice');
  assert.equal(conditionParts(bookConditions).length, 'alice in wonderland');
  // A completed, fresh book page is a practice run like any other.
  assert.equal(trendRun({ kind: 'test', status: 'complete', interrupted: false, fresh: true, conditions: bookConditions }), true);
});

test('the chosen book is a preference, and an unknown one reads as the first book', () => {
  assert.equal(preferencesInUse({}).book, 'alice');
  assert.equal(preferencesInUse({ book: 'pride' }).book, 'pride');
  assert.equal(preferencesInUse({ book: 'ulysses' }).book, 'alice');
});

test('normalising Gutenberg text keeps the words and makes them typable', () => {
  const raw = [
    '[Illustration: “Caption”',
    '',
    '[_Copyright 1894._]]',
    '',
    '“Où est ma chatte?” said Alice—it was _very_ odd…',
    'and she ran on.',
    '',
    '      *      *      *',
    '',
    'A second paragraph’s end.',
  ].join('\n');

  assert.deepEqual(normalise(raw), ['"Ou est ma chatte?" said Alice--it was very odd... and she ran on.', "A second paragraph's end."]);
  assert.throws(() => normalise('A snowman ☃'), /Unsupported characters/);
});
