import { CHARS_PER_WORD } from './typing.js';

// Speed is scored, stored, compared and keyed in wpm: correct characters kept / 5 / minutes
// (metrics() in typing.js). cpm is the same rate counted per character, wpm × 5, and exists only
// on screen. Every figure is converted from the saved wpm, so a run, its best and its comparison
// always agree: whole-wpm figures read in steps of five cpm, and a median between two runs on a half.
export const SPEED_UNITS = ['wpm', 'cpm'];
export const DEFAULT_SPEED_UNIT = 'wpm';

// The unit on screen. Every speed shown keeps its wpm on its element (data-wpm), and every unit word
// its template (data-speed-unit), so showSpeedUnit re-texts them all in place: nothing is redrawn,
// re-scored or re-keyed.
let shown = DEFAULT_SPEED_UNIT;

export function normalizeSpeedUnit(unit) {
  return SPEED_UNITS.includes(unit) ? unit : DEFAULT_SPEED_UNIT;
}

// A wpm figure (a score, best, median or difference) in the chosen unit.
export function speedValue(wpm, unit = shown) {
  return normalizeSpeedUnit(unit) === 'cpm' ? wpm * CHARS_PER_WORD : wpm;
}

// A figure entered in the chosen unit, back in wpm. Unrounded: the caller keeps whole wpm, so an
// entered cpm lands on the nearest step of five.
export function wpmFromSpeed(value, unit = shown) {
  return Number(value) / speedValue(1, unit);
}

// A difference to at most one decimal, signed: "+0.3", "−2", "0". Rounded before the sign is chosen,
// so a float remainder like 0.30000000000000004 reads 0.3 and a tiny one reads 0, unsigned.
export function signedNumber(value) {
  const rounded = Number(Number(value).toFixed(1));
  return `${rounded > 0 ? '+' : rounded < 0 ? '−' : ''}${Math.abs(rounded)}`;
}

// "72 wpm"; bare, "72" beside its own unit label; signed, "+3 wpm" or "−3 wpm"; whole, rounded once
// after converting, so a 65.5 wpm median reads 66 wpm and 328 cpm.
export function formatSpeed(wpm, { bare = false, signed = false, whole = false } = {}, unit = shown) {
  const value = speedValue(wpm, unit);
  const number = signed ? signedNumber(value) : whole ? String(Math.round(value)) : `${Number(value.toFixed(1))}`;
  return bare ? number : `${number} ${normalizeSpeedUnit(unit)}`;
}

// The run card's definitions of the speed figure and of raw speed, as unitText templates.
export const SPEED_DEFINITION = '{unit} counts correct characters kept{cpm: (wpm × 5)}';
export const RAW_SPEED_DEFINITION = 'Every character typed, mistakes included: characters{wpm: ÷ 5} per minute';

// A unit word in a template: {unit} is the unit, and {wpm:…} or {cpm:…} is text only that unit shows.
export function unitText(template, unit = shown) {
  return template.replace(/\{(unit|wpm|cpm)(?::([^}]*))?\}/g, (_, key, text) => (key === 'unit' ? unit : key === unit ? text : ''));
}

// Shows a speed kept in wpm on an element in the form its data-bare, data-signed and data-whole ask for, or a dash
// for none. Text that hasn't changed isn't touched (the live speed ticks ten times a second).
export function showSpeed(node, wpm) {
  if (wpm === null || wpm === undefined) delete node.dataset.wpm;
  else node.dataset.wpm = wpm;
  if (node.localName === 'data') node.value = wpm ?? '';
  const text = wpm === null || wpm === undefined ? '—' : formatSpeed(wpm, { bare: 'bare' in node.dataset, signed: 'signed' in node.dataset, whole: 'whole' in node.dataset });
  if (node.textContent !== text) node.textContent = text;
  return node;
}

// A <data> element: a value for machines (its wpm, in value) shown as text for people (the speed in the
// unit on screen), which is what <data> is for. Not being a span also keeps the rules that style the spans
// of a row off a figure inside one.
export function speedFigure(wpm, { bare = false, signed = false, whole = false } = {}) {
  const node = document.createElement('data');
  if (bare) node.dataset.bare = '';
  if (signed) node.dataset.signed = '';
  if (whole) node.dataset.whole = '';
  return showSpeed(node, wpm);
}

// A unit word in copy built on the fly; an empty template is the unit itself.
export function unitLabel(template = '') {
  const node = document.createElement('span');
  node.dataset.speedUnit = template;
  node.textContent = unitText(template || '{unit}');
  return node;
}

// Re-texts every speed and unit word on screen in this unit. Returns whether the unit changed. A figure
// inside a live region that is showing may be read out again in the new unit: accepted, since a unit change
// is almost always the person's own, and one synced from another device mid-session is rare.
export function showSpeedUnit(unit) {
  const next = normalizeSpeedUnit(unit);
  if (next === shown) return false;
  shown = next;
  document.querySelectorAll('[data-wpm]').forEach((node) => showSpeed(node, Number(node.dataset.wpm)));
  document.querySelectorAll('[data-speed-unit]').forEach((node) => { node.textContent = unitText(node.dataset.speedUnit || '{unit}'); });
  return true;
}
