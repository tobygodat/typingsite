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

export function promptText(id) {
  return COMPOSE_PROMPTS.find((prompt) => prompt.id === id)?.text || null;
}

// Every prompt once, in a random order, before any repeats. `avoid` never comes first, so a new
// deck can't hand back the prompt that was just on screen.
export function promptDeck(random = Math.random, avoid = null) {
  const ids = COMPOSE_PROMPTS.map((prompt) => prompt.id);
  for (let i = ids.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  if (ids.length > 1 && ids[0] === avoid) [ids[0], ids[1]] = [ids[1], ids[0]];
  return ids;
}

// Invisible format characters (zero-width spaces, bidi marks, soft hyphens) are not counted.
const FORMAT = /\p{Cf}/gu;

export function countCharacters(text) {
  return [...String(text).replace(FORMAT, '')].length;
}

export function countWords(text) {
  return String(text).replace(FORMAT, '').trim().split(/\s+/u).filter(Boolean).length;
}

// Active time is the sum of the gaps between consecutive keys, where a gap longer than the pause
// cut-off (thinking, not typing) counts as the average of the shorter gaps. Dropping long gaps
// outright would leave the key after each pause with no time of its own and overstate the speed
// of anyone who writes in bursts. Times are milliseconds from the first key.
export function activeTime(times, pauseMs = COMPOSE_PAUSE_MS) {
  let typing = 0;
  let gaps = 0;
  let pauses = 0;
  for (let i = 1; i < times.length; i += 1) {
    const gap = times[i] - times[i - 1];
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
// - backspaceRate: backspace and delete keystrokes (each auto-repeat of a held key included) as a
//   share of all keystrokes, in whole percent.
export function composeSummary({ keys = [], text = '', elapsedMs = 0 } = {}) {
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

const COUNTS = ['characters', 'words', 'keystrokes', 'backspaces', 'activeMs', 'elapsedMs', 'wpm', 'backspaceRate'];

// The stored record: numbers and labels only. There is no field that could carry the writing.
export function compositionRecord(summary, { id, at, promptId, inputClass = 'physical-keyboard', endedBy = 'done' }) {
  const record = { id: String(id), at: typeof at === 'string' ? at : null,
    version: typeof summary.version === 'string' ? summary.version : COMPOSE_VERSION,
    promptId: promptText(promptId) ? promptId : null,
    inputClass: inputClass === 'touch' ? 'touch' : 'physical-keyboard',
    endedBy: endedBy === 'time' ? 'time' : 'done' };
  for (const key of COUNTS) record[key] = summary[key];
  return record;
}

// Loading keeps only well-formed records, rebuilt from known fields, so nothing else rides along.
export function normalizeCompositions(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((item) => item && typeof item === 'object' && typeof item.id === 'string'
      && COUNTS.every((key) => Number.isFinite(item[key]) && item[key] >= 0))
    .map((item) => compositionRecord(item, item))
    .slice(-MAX_COMPOSITIONS);
}

export function retainCompositions(list) {
  return list.slice(-MAX_COMPOSITIONS);
}
