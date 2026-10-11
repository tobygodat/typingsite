import { CHARS_PER_WORD } from './typing.js';

// Speed is scored, stored, compared and keyed in wpm: correct characters kept / 5 / minutes
// (metrics() in typing.js). cpm is the same rate counted per character, wpm × 5, and exists only
// on screen. Every figure is converted from the saved wpm, so a run, its best and its comparison
// always agree; cpm therefore moves in steps of five.
export const SPEED_UNITS = ['wpm', 'cpm'];
export const DEFAULT_SPEED_UNIT = 'wpm';

export function normalizeSpeedUnit(unit) {
  return SPEED_UNITS.includes(unit) ? unit : DEFAULT_SPEED_UNIT;
}

// A wpm figure (a score, best, median or difference) in the chosen unit.
export function speedValue(wpm, unit) {
  return normalizeSpeedUnit(unit) === 'cpm' ? wpm * CHARS_PER_WORD : wpm;
}

// A figure entered in the chosen unit, back in wpm. Unrounded: the caller keeps whole wpm, so an
// entered cpm lands on the nearest step of five.
export function wpmFromSpeed(value, unit) {
  return Number(value) / speedValue(1, unit);
}

export function formatSpeed(wpm, unit) {
  return `${speedValue(wpm, unit)} ${normalizeSpeedUnit(unit)}`;
}

// The run card's one-line definition of the speed figure.
export function speedDefinition(unit) {
  return normalizeSpeedUnit(unit) === 'cpm'
    ? `cpm counts correct characters kept (wpm × ${CHARS_PER_WORD})`
    : 'wpm counts correct characters kept';
}
