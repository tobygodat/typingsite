function isCompositionRecord(item: unknown): item is CompositionRecord {
  if (!isRecord(item) || typeof item.id !== 'string') return false;

  return COUNTS.every((key) => typeof item[key] === 'number' && Number.isFinite(item[key]) && item[key] >= 0);
}

import { at, isRecord } from './domain-values.js';

export interface ComposeKey { type: 'insert' | 'delete'; at: number }

interface Edit { inputType?: string; data?: string | null; selectionStart?: number; selectionEnd?: number }

export type CompositionSummary = ReturnType<typeof composeSummary>;

import type { CompositionRecord } from './profile-types.js';

export type { CompositionRecord } from './profile-types.js';
// Composing practice: a short prompt, a free-typing field and no target text.
// It measures free-typing speed and backspace rate as numbers of their own. They are never
// compared with copy tests, never a best, and the words themselves are never stored.

export const COMPOSE_VERSION = 'stilltype-compose-v1';
export const COMPOSE_LIMIT_MS = 60_000;

// A gap longer than this between two keys is thinking, not typing, and is left out of active time.
// It matches the pause cut-off the copy-test pair timings use.
export const COMPOSE_PAUSE_MS = 2000;

// Less active typing than this is too little to call a speed.
export const COMPOSE_MIN_ACTIVE_MS = 5000;
export const MAX_COMPOSITIONS = 100;

// Neutral, everyday prompts: nothing personal or sensitive, and answerable in a minute.
export const COMPOSE_PROMPTS = [
  { id: 'morning', text: 'Describe your morning in three sentences.' },
  { id: 'room', text: 'Describe the room around you to someone who has never seen it.' },
  { id: 'drink', text: 'Explain how you make your usual hot drink, step by step.' },
  { id: 'walk', text: 'Describe a walk you know well, from start to finish.' },
  { id: 'weather', text: 'Write a few sentences about today’s weather.' },
  { id: 'game', text: 'Explain the rules of a simple game to a new player.' },
  { id: 'meal', text: 'Describe a meal you can cook without a recipe.' },
  { id: 'directions', text: 'Give directions from your door to the nearest shop.' },
  { id: 'object', text: 'Describe an object near you and what it is for.' },
  { id: 'tool', text: 'Describe a tool you use often and how you hold it.' },
  { id: 'afternoon', text: 'Plan a quiet afternoon in three or four sentences.' },
  { id: 'fold', text: 'Explain how to fold a shirt or a sheet of paper neatly.' },
];

export function promptText(id: unknown) {
  return COMPOSE_PROMPTS.find((prompt) => prompt.id === id)?.text || null;
}

// Every prompt once, in a random order, before any repeats. `avoid` never comes first, so a new
// deck can't hand back the prompt that was just on screen.
export function promptDeck(random = Math.random, avoid: string | null = null) {
  const ids = COMPOSE_PROMPTS.map((prompt) => prompt.id);

  for (let i = ids.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [ids[i], ids[j]] = [at(ids, j), at(ids, i)];
  }

  if (ids.length > 1 && ids[0] === avoid) [ids[0], ids[1]] = [at(ids, 1), at(ids, 0)];

  return ids;
}

// Invisible format characters (zero-width spaces, bidi marks, soft hyphens) are not counted.
const FORMAT = /\p{Cf}/gu;

export function countCharacters(text: unknown) {
  return [...String(text).replace(FORMAT, '')].length;
}

export function countWords(text: unknown) {
  return String(text).replace(FORMAT, '').trim().split(/\s+/u).filter(Boolean).length;
}

// The edits one key makes at the caret, and so the only ones counted: a character, Enter,
// Backspace and Delete, and Ctrl/⌥+Backspace or Delete for a word, which counts as one deleting key.
const KEYED_INSERTS = new Set(['insertText', 'insertLineBreak', 'insertParagraph']);
const KEYED_DELETES = new Set(['deleteContentBackward', 'deleteContentForward', 'deleteWordBackward', 'deleteWordForward']);

// Line deletes (⌘+Backspace, Ctrl+Shift+Backspace) are keys too, but one can clear the whole field.
const LINE_DELETE = /^delete(?:(?:Soft|Hard)Line(?:Backward|Forward)|EntireSoftLine)$/;

export function keyedEdit(inputType: string) {
  if (KEYED_INSERTS.has(inputType)) return 'insert';

  return KEYED_DELETES.has(inputType) ? 'delete' : null;
}

// Why an edit is refused before it lands, or null to let it through. Anything that could change
// more than one character without a counted key is refused: paste, cut, drop, undo and redo,
// transpose, autocorrect and spellcheck replacement, line deletes, multi-character inserts, and
// any key typed or deleted over a selection (it would silently replace the whole selection).
export function refusedEdit({ inputType = '', data = null, selectionStart = 0, selectionEnd = 0 }: Edit = {}) {
  if (inputType === 'insertFromPaste' || inputType === 'insertFromPasteAsQuotation') return 'paste';

  if (LINE_DELETE.test(inputType)) return 'lineDelete';

  if (!keyedEdit(inputType)) return 'edit';

  if (inputType === 'insertText' && data && [...data].length !== 1) return 'multiCharacter';

  return selectionStart === selectionEnd ? null : 'selection';
}

const WORD_DELETES = new Set(['deleteWordBackward', 'deleteWordForward']);

const GRAPHEMES = typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function'
  ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
  : null;

// Characters as a reader sees them (an accented letter or a flag is one), or code points, where a
// surrogate pair is one, when the browser can't segment graphemes.
export function graphemeCount(text: unknown, segmenter = GRAPHEMES) {
  return segmenter ? [...segmenter.segment(String(text))].length : [...String(text)].length;
}

// The kind of key that turned `before` (the text the counted keys built) into `after` (what the
// field now holds), or null when no single counted key could have: an insert adds exactly the one
// character it reports (Enter, a line break; a typed character that reports none can't be checked)
// and removes nothing; Backspace and Delete remove exactly one character (a selection is never
// one), and only Ctrl/⌥ word deletes may remove up to a word. Anything else changed the text some
// other way, such as autocorrect, assistive text or an edit the browser applied after it was
// refused, and is never counted.
export function keyedChange(before: string, after: string, { inputType = '', data = null }: Edit = {}) {
  const kind = keyedEdit(inputType);

  if (!kind) return null;
  const was = [...String(before)];
  const is = [...String(after)];
  let start = 0;

  while (start < was.length && start < is.length && was[start] === is[start]) start += 1;
  let end = 0;

  while (end < was.length - start && end < is.length - start && was[was.length - 1 - end] === is[is.length - 1 - end]) end += 1;
  const removed = was.slice(start, was.length - end).join('');
  const added = is.slice(start, is.length - end).join('');

  if (kind === 'delete') {
    if (!removed || added) return null;

    return (WORD_DELETES.has(inputType) ? countWords(removed) <= 1 : graphemeCount(removed) === 1) ? 'delete' : null;
  }

  const reported = inputType === 'insertText' ? data : '\n';

  return !removed && [...added].length === 1 && added === reported ? 'insert' : null;
}

// Active time is the sum of the gaps between consecutive keys, where a gap longer than the pause
// cut-off (thinking, not typing) counts as the average of the shorter gaps. Dropping long gaps
// outright would leave the key after each pause with no time of its own and overstate the speed
// of anyone who writes in bursts. Times are milliseconds from the first key.
export function activeTime(times: number[], pauseMs = COMPOSE_PAUSE_MS) {
  let typing = 0;
  let gaps = 0;
  let pauses = 0;

  for (let i = 1; i < times.length; i += 1) {
    const gap = at(times, i) - at(times, i - 1);

    if (gap < 0) continue;

    if (gap <= pauseMs) {
      typing += gap;
      gaps += 1;
    } else pauses += 1;
  }

  return gaps ? typing + pauses * (typing / gaps) : 0;
}

// keys: [{ type: 'insert' | 'delete', at }], one entry per key that changed the text.
// - characters: what is in the text when it ends (what you kept), not every key pressed.
// - wpm: characters ÷ 5 per minute of active time, or null when there is too little typing to say.
// - backspaceRate: backspace and delete keystrokes (each auto-repeat of a held key included, and a
//   word deleted with Ctrl/⌥ counted once) as a share of all keystrokes, in whole percent.
export function composeSummary({ keys = [], text = '', elapsedMs = 0 }: { keys?: ComposeKey[]; text?: string; elapsedMs?: number } = {}) {
  const inserts = keys.filter((key) => key.type === 'insert').length;
  const backspaces = keys.filter((key) => key.type === 'delete').length;
  const keystrokes = inserts + backspaces;
  const activeMs = Math.round(activeTime(keys.map((key) => key.at)));
  const characters = countCharacters(text);
  const measurable = activeMs >= COMPOSE_MIN_ACTIVE_MS && characters > 0;

  return {
    version: COMPOSE_VERSION,
    characters,
    words: countWords(text),
    keystrokes,
    backspaces,
    activeMs,
    elapsedMs: Math.round(Math.max(0, elapsedMs)),
    wpm: measurable ? Math.round(characters / 5 / (activeMs / 60000)) : null,
    backspaceRate: keystrokes ? Math.round((backspaces / keystrokes) * 100) : null,
    measurable,
  };
}

const COUNTS: (keyof Pick<CompositionRecord, 'characters' | 'words' | 'keystrokes' | 'backspaces' | 'activeMs' | 'elapsedMs' | 'wpm' | 'backspaceRate'>)[] = ['characters', 'words', 'keystrokes', 'backspaces', 'activeMs', 'elapsedMs', 'wpm', 'backspaceRate'];

// The stored record: numbers and labels only. There is no field that could carry the writing.
export function compositionRecord(summary: Pick<CompositionRecord, 'version' | 'characters' | 'words' | 'keystrokes' | 'backspaces' | 'activeMs' | 'elapsedMs' | 'wpm' | 'backspaceRate'>, { id, at, promptId, inputClass = 'physical-keyboard', endedBy = 'done' }: { id: unknown; at?: unknown; promptId?: string | null; inputClass?: string; endedBy?: string }) {
  const record: CompositionRecord = { characters: summary.characters, words: summary.words, keystrokes: summary.keystrokes, backspaces: summary.backspaces, activeMs: summary.activeMs, elapsedMs: summary.elapsedMs, wpm: summary.wpm, backspaceRate: summary.backspaceRate, id: String(id), at: typeof at === 'string' ? at : null,
    version: typeof summary.version === 'string' ? summary.version : COMPOSE_VERSION,
    promptId: typeof promptId === 'string' && promptText(promptId) ? promptId : null,
    inputClass: inputClass === 'touch' ? 'touch' : 'physical-keyboard',
    endedBy: endedBy === 'time' ? 'time' : 'done' };


  return record;
}

// Loading keeps only well-formed records, rebuilt from known fields, so nothing else rides along.
export function normalizeCompositions(list: unknown) {
  if (!Array.isArray(list)) return [];

  return list
    .filter(isCompositionRecord)
    .map((item) => compositionRecord(item, item))
    .slice(-MAX_COMPOSITIONS);
}

export function retainCompositions<T>(list: readonly T[]) {
  return list.slice(-MAX_COMPOSITIONS);
}
