import { lookup } from './domain-values.js';
import { at } from './domain-values.js';
import { analysisRuns } from './domain-history.js';

export interface BookPage { id: string; book: unknown; text: string; page: number }

// Book mode: the opening sections of four public-domain books, typed a page at a time.
// The text is in book-texts.js (generated); pagination and the place in each book live here.
import { BOOK_TEXTS } from './book-texts.js';
import { textId } from './typing.js';

// Part of every book page's conditions, so bests and trends never mix two different sets of pages.
// Bump it if the text or the pagination changes.
export const BOOK_VERSION = 'gutenberg-en-v1';
export const DEFAULT_BOOK = 'alice';

export const BOOKS = [
  { id: 'alice', name: 'alice in wonderland' },
  { id: 'pride', name: 'pride and prejudice' },
  { id: 'sherlock', name: 'sherlock holmes' },
  { id: 'frankenstein', name: 'frankenstein' },
];

export const bookIds = BOOKS.map((book) => book.id);
export const bookName = (id: unknown) => BOOKS.find((book) => book.id === id)?.name || 'book';

// A page is about one passage: roughly 55 words, never more than 80.
export const PAGE_WORDS = { min: 30, target: 55, max: 80 };
const ABBREVIATION = /^(?:Mr|Mrs|Dr|St|Messrs|Mme)\.$/;

function endsSentence(word: string, next: string) {
  if (!/[.!?]['")]*$/.test(word)) return false;

  if (ABBREVIATION.test(word.replace(/^["'(]+/, ''))) return false;

  return /^["'(]*[A-Z]/.test(next);
}

const endsClause = (word: string) => /(?:[,;:]['")]*|--)$/.test(word);

// What it costs, in words of distance from the target, to end a page after a word: nothing at a
// paragraph end, a little at a sentence end, more at a clause, and most inside a quotation or
// mid-sentence. So pages stay near one passage long but rarely split a line of dialogue.
const COST = { paragraph: 0, sentence: 8, clause: 20, quoted: 30, anywhere: 60 };

function breakCosts(paragraphs: string[]) {
  const words: { word: string; cost: number }[] = [];

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
export function paginate(paragraphs: string[], { min, target, max } = PAGE_WORDS) {
  const words = breakCosts(paragraphs);
  const pages = [];
  let start = 0;

  while (start < words.length) {
    let end = words.length;

    if (end - start > max) {
      // Leave at least a minimum page behind, so a section never ends on a scrap.
      let best = Infinity;

      for (let candidate = start + min; candidate <= Math.min(start + max, words.length - min); candidate += 1) {
        const cost = at(words, candidate - 1).cost + Math.abs(candidate - start - target);

        if (cost < best) { best = cost; end = candidate; }
      }
    }

    pages.push(words.slice(start, end).map((item) => item.word).join(' '));
    start = end;
  }

  return pages;
}

const opened = new Map<unknown, BookPage[]>();

// Every page of a book, in order. Each section starts on a new page. A page's id carries a hash of
// its text, so a change to the text or the pagination gives new ids.
export function openBook(id: unknown) {
  const sections = lookup(BOOK_TEXTS, String(id));

  if (!sections) return null;

  if (!opened.has(id)) {
    const pages = sections.flatMap((section, s) => paginate(section.paragraphs).map((text, p) => ({
      id: `book-${id}-c${s + 1}p${p + 1}-${textId(text).replace(/^generated-/, '')}`, book: id, text, page: 0,
    })));

    pages.forEach((page, index) => { page.page = index; });
    opened.set(id, pages);
  }

  return opened.get(id) ?? null;
}

// The next page to type: the one after the latest completed, uninterrupted run on a page of this
// book, from the run history (so it syncs and clears with it). A drill at book conditions types no
// page, and a page from another text version isn't found, so neither counts. After the last page
// the book starts again at page 1.
export function bookPlace(inputRuns: readonly unknown[], id: unknown) {
  const runs = analysisRuns(inputRuns);
  const pages = openBook(id);

  if (!pages) return 0;

  for (let i = runs.length - 1; i >= 0; i -= 1) {
    const run = at(runs, i);

    if (run.conditions?.mode !== 'book' || run.conditions.book !== id || run.status !== 'complete' || run.interrupted) continue;
    const index = pages.findIndex((page) => page.id === run.textId);

    if (index >= 0) return (index + 1) % pages.length;
  }

  return 0;
}

// "page 12": a page's place in its book, or null for a text that isn't a current book page.
export function bookPage(textId: string | null | undefined) {
  const id = /^book-([a-z]+)-/.exec(textId || '')?.[1];
  const index = (id ? openBook(id) : null)?.findIndex((page) => page.id === textId) ?? -1;

  return index < 0 ? null : index + 1;
}
