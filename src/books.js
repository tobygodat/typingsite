// Book mode: the opening chapters of four public-domain books, typed a page at a time.
// Titles, pagination and per-chapter speed live here; the text is in book-texts.js and is
// fetched the first time book mode opens. A book page is its own condition: it never becomes
// a best, a retest baseline, a trend point or training evidence (see summarizePatterns).
import { conditionKey, textId } from './typing.js';
import { median, validRun } from './insights.js';

// Part of every book page's conditions. Bump it if the text or the pagination changes, so
// remembered places and chapter speeds never mix two different sets of pages.
export const BOOK_VERSION = 'gutenberg-en-v1';
export const BOOK_CREDIT = 'Text from Project Gutenberg; public domain in the US';
export const DEFAULT_BOOK = 'alice';

export const BOOKS = [
  { id: 'alice', title: 'Alice’s Adventures in Wonderland', short: 'Alice in Wonderland', author: 'Lewis Carroll', gutenberg: 11 },
  { id: 'pride', title: 'Pride and Prejudice', short: 'Pride and Prejudice', author: 'Jane Austen', gutenberg: 1342 },
  { id: 'sherlock', title: 'The Adventures of Sherlock Holmes', short: 'Sherlock Holmes', author: 'Arthur Conan Doyle', gutenberg: 1661 },
  { id: 'frankenstein', title: 'Frankenstein', short: 'Frankenstein', author: 'Mary Wollstonecraft Shelley', gutenberg: 84 },
];
export const bookIds = BOOKS.map((book) => book.id);
export const findBook = (id) => BOOKS.find((book) => book.id === id) || null;

let texts = null;
let loading = null;

// The text is about 90 KB, so it only loads when someone opens book mode.
export function loadBookTexts() {
  loading ||= import('./book-texts.js').then((module) => { texts = module.BOOK_TEXTS; return texts; })
    .catch((error) => { loading = null; throw error; });
  return loading;
}

// A page is about one passage: roughly 55 words, never more than 80.
export const PAGE_WORDS = { min: 30, target: 55, max: 80 };
const ABBREVIATION = /^(?:Mr|Mrs|Dr|St|Messrs|Mme)\.$/;

function endsSentence(word, next) {
  if (!/[.!?]['")]*$/.test(word)) return false;
  if (ABBREVIATION.test(word.replace(/^["'(]+/, ''))) return false;
  return /^["'(]*[A-Z]/.test(next);
}

const endsClause = (word) => /(?:[,;:]['")]*|--)$/.test(word);

// What it costs, in words of distance from the target, to end a page after a word: nothing at a
// paragraph end, a little at a sentence end, more at a clause, and most inside a quotation or
// mid-sentence. So pages stay near one passage long but rarely split a line of dialogue.
const COST = { paragraph: 0, sentence: 8, clause: 20, quoted: 30, anywhere: 60 };

function breakCosts(paragraphs) {
  const words = [];
  for (const paragraph of paragraphs) {
    const list = paragraph.split(' ');
    let quoted = false;
    list.forEach((word, i) => {
      for (const char of word) if (char === '"') quoted = !quoted;
      const next = list[i + 1];
      let cost = COST.anywhere;
      if (next === undefined) cost = COST.paragraph;
      else if (endsSentence(word, next)) cost = quoted ? COST.quoted : COST.sentence;
      else if (!quoted && endsClause(word)) cost = COST.clause;
      words.push({ word, cost });
    });
  }
  return words;
}

// Deterministic: the same paragraphs always give the same pages. Paragraphs join with one space,
// because the typing engine has no line breaks.
export function paginate(paragraphs, { min, target, max } = PAGE_WORDS) {
  const words = breakCosts(paragraphs);
  const pages = [];
  let start = 0;
  while (start < words.length) {
    let end = words.length;
    if (end - start > max) {
      // Leave at least a minimum page behind, so a chapter never ends on a scrap.
      let best = Infinity;
      for (let candidate = start + min; candidate <= Math.min(start + max, words.length - min); candidate += 1) {
        const cost = words[candidate - 1].cost + Math.abs(candidate - start - target);
        if (cost < best) { best = cost; end = candidate; }
      }
    }
    pages.push(words.slice(start, end).map((item) => item.word).join(' '));
    start = end;
  }
  return pages;
}

const opened = new Map();

// Every page of a book's included chapters, in order. Null until the text has loaded.
export function openBook(id) {
  const book = findBook(id);
  if (!book || !texts?.[id]) return null;
  if (opened.has(id)) return opened.get(id);
  const pages = [];
  const chapters = texts[id].map((section, chapter) => {
    const chapterPages = paginate(section.paragraphs);
    const first = pages.length;
    chapterPages.forEach((text, index) => {
      pages.push({
        id: `book-${id}-c${chapter + 1}p${index + 1}-${textId(text).replace(/^generated-/, '')}`,
        book: id, chapter, page: pages.length, pageInChapter: index, pagesInChapter: chapterPages.length, text,
      });
    });
    return { index: chapter, label: section.label, title: section.title, firstPage: first, pageCount: chapterPages.length };
  });
  const result = { ...book, chapters, pages };
  opened.set(id, result);
  return result;
}

// The next page to type: a stored index, clamped. Equal to pages.length once every page is done.
export function bookPlace(places, id, total) {
  const page = places?.[id]?.page;
  return Number.isInteger(page) && page > 0 ? Math.min(page, total) : 0;
}

export function chapterName(chapter) {
  return chapter.title ? `${chapter.label} · ${chapter.title}` : chapter.label;
}

// Per chapter: the median wpm of the latest completed run on each page, at one exact condition
// key (so touch and keyboard, or the two correction rules, never mix), with the page count behind it.
export function chapterSpeeds(runs, book, conditions) {
  const key = conditionKey(conditions);
  const latest = new Map();
  for (const run of runs) {
    if (run.kind !== 'book' || !validRun(run) || run.book?.id !== book.id || conditionKey(run.conditions) !== key) continue;
    if (!Number.isInteger(run.book.page) || run.book.page >= book.pages.length) continue;
    latest.set(run.book.page, run);
  }
  return book.chapters.map((chapter) => {
    const typed = [...latest.values()].filter((run) => book.pages[run.book.page].chapter === chapter.index);
    const wpm = median(typed.map((run) => run.score.wpm));
    return { ...chapter, pagesTyped: typed.length, medianWpm: wpm === null ? null : Math.round(wpm) };
  });
}
