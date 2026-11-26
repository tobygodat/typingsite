// Fluid word flow (ADR 0027): the passage is typed a word at a time. A space ends the word where it
// stands, letters past a word's end stay on that word, and a clean word behind the caret is locked.
// Pure domain: the live input asks it what a key does and records the steps it returns; replay folds
// the same steps. Nothing here reads the DOM, motion or scoring.

export const WORD_FLOW_MAX_EXTRA = 8;

// Stands in the kept text for a letter a space skipped. It is a private-use character, so it never
// equals a passage letter and scores as not typed right.
export const MISSED = '';

// typed: the kept text, one character per passage position (MISSED where a space skipped a letter).
// extras: letters typed past a word's end, by the position of that word's end (its space, or the
// passage end). Extras only stand on a word whose letters were all typed, so a word never has both.
export interface WordFlowState { readonly text: string; readonly typed: string; readonly extras: ReadonlyMap<number, string> }

export type WordFlowStep =
  | { type: 'insert'; text: string; position: number }
  | { type: 'skip'; position: number; count: number }
  | { type: 'extra'; text: string; position: number }
  | { type: 'delete'; count: number }
  | { type: 'delete-extra'; count: number };

export interface WordFlowResult { state: WordFlowState; steps: WordFlowStep[] }

export function createWordFlow(text: string): WordFlowState {
  return { text, typed: '', extras: new Map() };
}

const atWordStart = (text: string, position: number) => position === 0 || text[position - 1] === ' ';

function wordStart(text: string, position: number) {
  return text.lastIndexOf(' ', position - 1) + 1;
}

function wordEnd(text: string, position: number) {
  const space = text.indexOf(' ', position);

  return space === -1 ? text.length : space;
}

// What a skip keeps: the skipped letters as MISSED, then the space it lands on (none at the passage end).
export function skippedText(textLength: number, position: number, count: number) {
  return MISSED.repeat(count) + (position + count < textLength ? ' ' : '');
}

export function applyWordFlowStep(state: WordFlowState, step: WordFlowStep): WordFlowState {
  const { text, typed, extras } = state;

  if (step.type === 'insert') return { ...state, typed: typed + step.text };

  if (step.type === 'skip') return { ...state, typed: typed + skippedText(text.length, step.position, step.count) };

  if (step.type === 'delete') return { ...state, typed: typed.slice(0, Math.max(0, typed.length - step.count)) };
  const position = typed.length;
  const kept = extras.get(position) ?? '';
  const next = new Map(extras);
  const word = step.type === 'extra' ? kept + step.text : kept.slice(0, Math.max(0, kept.length - step.count));

  if (word) next.set(position, word);
  else next.delete(position);

  return { ...state, extras: next };
}

function run(state: WordFlowState, steps: WordFlowStep[]): WordFlowResult {
  return { state: steps.reduce(applyWordFlowStep, state), steps };
}

export function applyWordFlowKey(state: WordFlowState, char: string): WordFlowResult {
  const { text, typed, extras } = state;
  const position = typed.length;

  if (position >= text.length) return run(state, []);

  if (char === ' ') {
    if (text[position] === ' ') return run(state, [{ type: 'insert', text: ' ', position }]);

    if (atWordStart(text, position)) return run(state, []);

    return run(state, [{ type: 'skip', position, count: wordEnd(text, position) - position }]);
  }

  if (text[position] !== ' ') return run(state, [{ type: 'insert', text: char, position }]);

  if ((extras.get(position) ?? '').length >= WORD_FLOW_MAX_EXTRA) return run(state, []);

  return run(state, [{ type: 'extra', text: char, position }]);
}

// The previous word can be reopened only if it was left wrong: a skipped or wrong letter, or extras.
function previousWordOpen(state: WordFlowState, position: number) {
  const end = position - 1;
  const start = wordStart(state.text, end);

  return state.extras.has(end) || state.typed.slice(start, end) !== state.text.slice(start, end);
}

// Back over the space into the previous word, to just after its last typed letter (or its extras).
function stepBack(state: WordFlowState): WordFlowStep[] {
  const { typed } = state;
  let end = typed.length - 1;

  while (end > 0 && typed[end - 1] === MISSED) end -= 1;

  return [{ type: 'delete', count: typed.length - end }];
}

export function applyWordFlowDelete(state: WordFlowState): WordFlowResult {
  const { text, typed, extras } = state;
  const position = typed.length;

  if (extras.has(position)) return run(state, [{ type: 'delete-extra', count: 1 }]);

  if (position === 0) return run(state, []);

  if (!atWordStart(text, position)) return run(state, [{ type: 'delete', count: 1 }]);

  return run(state, previousWordOpen(state, position) ? stepBack(state) : []);
}

// Option+Backspace or Ctrl+Backspace: the current word back to its first letter, extras included. At a
// word's first letter it takes the previous word instead, if that word may be reopened.
export function applyWordFlowDeleteWord(state: WordFlowState): WordFlowResult {
  const { text, typed, extras } = state;
  let position = typed.length;
  const steps: WordFlowStep[] = [];

  if (position > 0 && atWordStart(text, position) && !extras.has(position)) {
    if (!previousWordOpen(state, position)) return run(state, []);
    const back = stepBack(state);
    steps.push(...back);
    position = run(state, back).state.typed.length;
  }

  const extra = extras.get(position);

  if (extra) steps.push({ type: 'delete-extra', count: extra.length });
  const count = position - wordStart(text, position);

  if (count > 0) steps.push({ type: 'delete', count });

  return run(state, steps);
}

// How many kept characters a linear word delete takes: trailing spaces, then the letters before them.
export function linearWordDeleteCount(typed: string) {
  let end = typed.length;

  while (end > 0 && typed[end - 1] === ' ') end -= 1;

  while (end > 0 && typed[end - 1] !== ' ') end -= 1;

  return typed.length - end;
}
