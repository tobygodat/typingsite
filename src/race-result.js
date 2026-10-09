import { formatSpeed, speedValue } from './units.js';

// An online race result in the inbox. The entry keeps both scores in wpm (`race.wpm`, yours first)
// so it reads in whichever speed unit is chosen when it is shown; its `text` is the same sentence
// in wpm, which is also what builds without the speed unit setting show.
export function raceResultText({ lead, opponent, wpm }, unit) {
  return `${lead} ${opponent}: ${formatSpeed(wpm[0], unit)} to ${speedValue(wpm[1], unit)}.`;
}

const score = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const validRace = (race) => typeof race?.lead === 'string' && typeof race.opponent === 'string'
  && Array.isArray(race.wpm) && race.wpm.length === 2 && race.wpm.every(score);

// The saved scores of a result entry, or null when it has none to convert (then its text is shown).
export function raceResultOf(entry) {
  return entry?.kind === 'result' && validRace(entry.race) ? entry.race : null;
}

// Before the speed unit setting, a result entry kept only its sentence, always worded as
// raceResultText(race, 'wpm'): "You beat Lin: 72 wpm to 65." The service rounds scores to whole
// wpm, and the name sits between the lead and the last ": N wpm to N.", so the scores read back
// unambiguously whatever the name holds. The sentence is read only when it is exactly that: a known
// lead that agrees with the scores (accuracy only breaks a tie), whole wpm without leading zeros,
// and rewording it gives back the same text. Anything else is left to be shown as written.
const LEGACY_RESULT = /^(You tied with|You beat|You raced) (.+): (0|[1-9]\d*) wpm to (0|[1-9]\d*)\.$/s;

export function parseLegacyRaceResult(text) {
  if (typeof text !== 'string') return null;
  const match = LEGACY_RESULT.exec(text);
  if (!match) return null;
  const [, lead, opponent, mine, theirs] = match;
  const wpm = [Number(mine), Number(theirs)];
  if (!wpm.every(Number.isSafeInteger)) return null;
  const agrees = lead === 'You tied with' ? wpm[0] === wpm[1] : lead === 'You beat' ? wpm[0] >= wpm[1] : wpm[0] <= wpm[1];
  if (!agrees) return null;
  const race = { lead, opponent, wpm };
  return raceResultText(race, 'wpm') === text ? race : null;
}

// A loaded inbox entry. A result saved before the speed unit setting gains the scores read from its
// sentence; its text stays exactly as saved. Every other entry comes back as it is (the same
// object), so normalising twice changes nothing.
export function normalizeInboxEntry(entry) {
  if (entry?.kind !== 'result' || entry.race !== undefined) return entry;
  const race = parseLegacyRaceResult(entry.text);
  return race ? { ...entry, race } : entry;
}
