import { at as indexed, isRecord } from './domain-values.js';
import type { SpeedFormat } from './units.js';

export interface RaceResult { lead: string; opponent: string; wpm: [number, number] }

export type RaceOutcome = 'won' | 'lost' | 'tied';

import { formatSpeed } from './units.js';

// An online race result in the inbox. The entry keeps both scores in wpm (`race.wpm`, yours first)
// so it reads in whichever speed unit is chosen when it is shown; its `text` is the same sentence
// in wpm, which is also what builds without the speed unit setting show. `figure` makes each speed:
// wpm text as saved, or a figure in the chosen unit on screen (speedFigure).
const savedSpeed = (wpm: number, options?: SpeedFormat) => formatSpeed(wpm, options, 'wpm');

export function raceResultParts({ lead, opponent, wpm }: RaceResult, figure: (wpm: number, options?: SpeedFormat) => string | Node = savedSpeed) {
  return [`${lead} ${opponent}: `, figure(wpm[0]), ' to ', figure(wpm[1], { bare: true }), '.'];
}

export const raceResultText = (race: RaceResult) => raceResultParts(race).join('');

// How a race went for `mine`, as its results show it: more wpm wins, and accuracy breaks a wpm tie.
export function raceOutcome(mine: { wpm?: number; accuracy?: number }, theirs: { wpm?: number; accuracy?: number }) {
  const ahead = (mine.wpm || 0) - (theirs.wpm || 0) || (mine.accuracy ?? 100) - (theirs.accuracy ?? 100);

  return ahead > 0 ? 'won' : ahead < 0 ? 'lost' : 'tied';
}

export const RACE_LEADS = { won: 'You beat', lost: 'You raced', tied: 'You tied with' };

// The pair's wins as the service keeps them ([mine, theirs]), and which figure this race just raised.
// Null when there is no tally to show: a guest on either side, or a service without one.
export function tallyView(tally: unknown, outcome: string) {
  if (!Array.isArray(tally) || tally.length !== 2 || !tally.every(Number.isSafeInteger)) return null;

  return { mine: tally[0], theirs: tally[1], raised: outcome === 'won' ? 'mine' : outcome === 'lost' ? 'theirs' : null };
}

// The two Rematch controls of a finished race: this racer's button and what the other picked. A racer who
// left takes the choice with them. When both have picked, the next race is starting.
export function rematchControls(mine: { rematch?: boolean }, theirs: { left?: boolean; rematch?: boolean }) {
  return {
    mine: theirs.left ? 'inactive' : mine.rematch ? 'chosen' : 'open',
    theirs: theirs.left ? 'left' : theirs.rematch ? 'chosen' : 'open',
    starting: Boolean(mine.rematch && theirs.rematch && !theirs.left),
  };
}

const score = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0;

const validRace = (race: unknown): race is RaceResult => isRecord(race) && typeof race.lead === 'string' && typeof race.opponent === 'string'
  && Array.isArray(race.wpm) && race.wpm.length === 2 && race.wpm.every(score);

// The saved scores of a result entry, or null when it has none to convert (then its text is shown).
export function raceResultOf(entry: unknown) {
  return isRecord(entry) && entry.kind === 'result' && validRace(entry.race) ? entry.race : null;
}

// Before the speed unit setting, a result entry kept only its sentence, always worded as
// raceResultText(race): "You beat Lin: 72 wpm to 65." The service rounds scores to whole
// wpm, and the name sits between the lead and the last ": N wpm to N.", so the scores read back
// unambiguously whatever the name holds. The sentence is read only when it is exactly that: a known
// lead that agrees with the scores (accuracy only breaks a tie), whole wpm without leading zeros,
// and rewording it gives back the same text. Anything else is left to be shown as written.
const LEGACY_RESULT = /^(You tied with|You beat|You raced) (.+): (0|[1-9]\d*) wpm to (0|[1-9]\d*)\.$/s;

export function parseLegacyRaceResult(text: unknown) {
  if (typeof text !== 'string') return null;
  const match = LEGACY_RESULT.exec(text);

  if (!match) return null;
  const [lead, opponent, mine, theirs] = [indexed(match, 1), indexed(match, 2), indexed(match, 3), indexed(match, 4)];
  const wpm: [number, number] = [Number(mine), Number(theirs)];

  if (!wpm.every(Number.isSafeInteger)) return null;
  const agrees = lead === 'You tied with' ? wpm[0] === wpm[1] : lead === 'You beat' ? wpm[0] >= wpm[1] : wpm[0] <= wpm[1];

  if (!agrees) return null;
  const race = { lead, opponent, wpm };

  return raceResultText(race) === text ? race : null;
}

// A loaded inbox entry. A result saved before the speed unit setting gains the scores read from its
// sentence; its text stays exactly as saved. Every other entry comes back as it is (the same
// object), so normalising twice changes nothing.
export function normalizeInboxEntry<T>(entry: T) {
  if (!isRecord(entry) || entry.kind !== 'result' || entry.race !== undefined) return entry;
  const race = parseLegacyRaceResult(entry.text);

  return race ? { ...entry, race } : entry;
}
