import test from 'node:test';
import assert from 'node:assert/strict';
import { stat } from 'node:fs/promises';
import { BOOKS, BOOK_CREDIT, BOOK_VERSION, PAGE_WORDS, bookPlace, chapterSpeeds, loadBookTexts, openBook, paginate } from '../src/books.js';
import { CORPUS_VERSION, METRIC_VERSION, comparable, conditionKey, recommendTarget, summarizePatterns } from '../src/typing.js';
import { recurringTargets, runRecord, trendRun } from '../src/insights.js';
import { normalise } from '../scripts/build-book-texts.mjs';

const texts = await loadBookTexts();
const bookConditions = { mode: 'book', duration: null, count: null, punctuation: true, quoteLength: null, difficulty: null, wordList: null,
  book: 'alice', inputClass: 'physical-keyboard', correctionPolicy: 'relaxed', language: 'en', corpus: BOOK_VERSION, metricVersion: METRIC_VERSION };

test('four Gutenberg books, credited, with their first two sections and no more than 150 KB of text', async () => {
  assert.deepEqual(BOOKS.map((book) => book.gutenberg), [11, 1342, 1661, 84]);
  assert.equal(BOOK_CREDIT, 'Text from Project Gutenberg; public domain in the US');
  for (const book of BOOKS) assert.equal(texts[book.id].length, 2, book.id);
  assert.deepEqual(texts.alice.map((section) => `${section.label} · ${section.title}`), ['Chapter I · Down the Rabbit-Hole', 'Chapter II · The Pool of Tears']);
  assert.match(texts.pride[0].paragraphs[0], /^It is a truth universally acknowledged, that a single man in possession of a good fortune must be in want of a wife\.$/);
  assert.ok((await stat(new URL('../src/book-texts.js', import.meta.url))).size < 150_000);
});

test('every page is plain printable ASCII the engine can type, and pages keep every word in order', () => {
  const ids = new Set();
  for (const meta of BOOKS) {
    const book = openBook(meta.id);
    assert.ok(book.pages.length > 20, meta.id);
    for (const page of book.pages) {
      assert.match(page.text, /^[\x21-\x7e]+(?: [\x21-\x7e]+)*$/, page.id);
      const words = page.text.split(' ').length;
      assert.ok(words >= PAGE_WORDS.min && words <= PAGE_WORDS.max, `${page.id}: ${words} words`);
      assert.ok(!ids.has(page.id), page.id);
      ids.add(page.id);
    }
    book.chapters.forEach((chapter, index) => {
      const pages = book.pages.slice(chapter.firstPage, chapter.firstPage + chapter.pageCount);
      assert.ok(pages.every((page) => page.chapter === index && page.pagesInChapter === chapter.pageCount));
      assert.equal(pages.map((page) => page.text).join(' '), texts[meta.id][index].paragraphs.join(' '));
    });
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

test('the place in a book is clamped, and starts at page 1 for anything unknown', () => {
  assert.equal(bookPlace({}, 'alice', 10), 0);
  assert.equal(bookPlace({ alice: { page: 3 } }, 'alice', 10), 3);
  assert.equal(bookPlace({ alice: { page: 30 } }, 'alice', 10), 10);
  assert.equal(bookPlace({ alice: { page: -2 } }, 'alice', 10), 0);
  assert.equal(bookPlace({ alice: { page: 1.5 } }, 'alice', 10), 0);
  assert.equal(bookPlace({ alice: { page: '4' } }, 'alice', 10), 0);
  assert.equal(bookPlace(undefined, 'alice', 10), 0);
});

test('chapter speed is the median of the latest counted run on each page, at one exact condition', () => {
  const book = openBook('alice');
  const second = book.chapters[1].firstPage;
  const run = (page, wpm, overrides = {}) => ({ id: `${page}-${wpm}`, kind: 'book', status: 'complete', interrupted: false, conditions: bookConditions,
    book: { id: 'alice', chapter: book.pages[page].chapter, page }, score: { wpm, accuracy: 97 }, ...overrides });
  const runs = [
    run(0, 40), run(0, 50), run(1, 61), run(2, 70),
    run(3, 200, { status: 'interrupted', interrupted: true }),
    run(4, 200, { conditions: { ...bookConditions, inputClass: 'touch' } }),
    run(5, 200, { conditions: { ...bookConditions, correctionPolicy: 'mandatory' } }),
    run(6, 200, { book: { id: 'pride', chapter: 0, page: 6 } }),
    run(7, 200, { kind: 'test' }),
    run(second, 55),
  ];
  const [first, next] = chapterSpeeds(runs, book, bookConditions);
  assert.deepEqual([first.pagesTyped, first.medianWpm], [3, 61]);
  assert.deepEqual([next.pagesTyped, next.medianWpm], [1, 55]);
  assert.equal(first.pageCount, book.chapters[0].pageCount);
  const touch = chapterSpeeds(runs, book, { ...bookConditions, inputClass: 'touch' });
  assert.deepEqual([touch[0].pagesTyped, touch[0].medianWpm, touch[1].medianWpm], [1, 200, null]);
});

test('a book page is its own condition: never a best key, a trend, a comparison or training evidence', () => {
  // The practice default key is unchanged; the book key matches no practice key.
  const practice = { mode: 'time', duration: 30, count: null, punctuation: false, quoteLength: null, difficulty: null, wordList: '200',
    inputClass: 'physical-keyboard', correctionPolicy: 'relaxed', language: 'en', corpus: CORPUS_VERSION, metricVersion: METRIC_VERSION };
  assert.equal(conditionKey(practice), 'time:30::plain:::200:physical-keyboard:relaxed:original-en-v5:stilltype-metrics-v1');
  assert.equal(conditionKey(bookConditions), 'book:::punctuation::::physical-keyboard:relaxed:gutenberg-en-v1:stilltype-metrics-v1');
  assert.equal(conditionKey({ ...bookConditions, book: 'pride' }), conditionKey(bookConditions));

  const text = 'the then there these';
  const events = [...text].map((char, i) => ({ type: 'insert', text: i === 1 ? 'x' : char, position: i, accepted: true, offsetMs: i * 150 }));
  const attempt = (id, kind, textId) => ({ id, kind, text, textId, status: 'complete', interrupted: false, fresh: true, metricVersion: METRIC_VERSION,
    conditions: bookConditions, events, startedAt: 0, endedAt: 3000, book: kind === 'book' ? { id: 'alice', chapter: 0, page: 0 } : undefined });
  const pages = Array.from({ length: 6 }, (_, i) => attempt(`p${i}`, 'book', `page-${i}`));
  assert.equal(summarizePatterns(pages, 20, bookConditions).attemptCount, 0);
  assert.equal(recommendTarget(pages, bookConditions).kind, 'general');
  assert.equal(comparable(pages[0], pages[1]), false);
  assert.equal(comparable(attempt('t', 'test', 'a'), attempt('r', 'retest', 'b')), true);

  const records = pages.map((page) => ({ ...runRecord(page), at: '2026-10-01T12:00:00Z' }));
  assert.deepEqual(records[0].book, { id: 'alice', chapter: 0, page: 0 });
  assert.equal(records.some(trendRun), false);
  assert.deepEqual(recurringTargets(records, [], bookConditions), []);
  assert.equal('book' in runRecord(attempt('t', 'test', 'a')), false);
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
