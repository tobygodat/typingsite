// Word highlight (settings → word highlight): a quiet tint on the word being typed or the one after it.
// Presentational only: scoring, replay and the test conditions never read it.
// Words follow renderText's split on single spaces. A space belongs to the word before it, so a
// finished word stays current until its space is typed.

export const WORD_HIGHLIGHT_MODES = ['off', 'current', 'next'];
export const DEFAULT_WORD_HIGHLIGHT = 'off';

export function normalizeWordHighlight(value) {
  return WORD_HIGHLIGHT_MODES.includes(value) ? value : DEFAULT_WORD_HIGHLIGHT;
}

// The word index of every character in the passage.
export function wordIndexes(text) {
  const indexes = new Array(text.length);
  let word = 0;

  for (let position = 0; position < text.length; position += 1) {
    indexes[position] = word;

    if (text[position] === ' ') word += 1;
  }

  return indexes;
}

// The current and next word with the caret at `position`; -1 where there is none
// (the passage is finished, or the current word is the last).
export function wordsAt(indexes, wordCount, position) {
  if (!Number.isInteger(position) || position < 0 || position >= indexes.length) return { current: -1, next: -1 };
  const current = indexes[position];

  return { current, next: current + 1 < wordCount ? current + 1 : -1 };
}
