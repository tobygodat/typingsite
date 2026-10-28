// Custom themes: a name and a hex for each colour token, worn over the dark or light token set by the
// background's luminance. The stylesheet derives the tints (`:root[data-theme][data-custom]` in
// src/styles.css) and the surfaces from the colours they follow, so a derived token is stored only once
// someone overrides it. Saved in the synced preferences (`customThemes`, as JSON text); `theme` names one by its id.

export const MAX_CUSTOM_THEMES = 5;
export const MAX_THEME_NAME = 40;
export const CUSTOM_PREFIX = 'custom-';
export const isCustomId = (value) => typeof value === 'string' && value.startsWith(CUSTOM_PREFIX);

// Every colour token a built-in theme defines, in the editor's order. `key` ones are shown up front;
// `derived` ones follow their source in the stylesheet until overridden. The edge function
// (supabase/functions/generate-theme) asks the model for every token that isn't derived.
export const THEME_TOKENS = [
  { name: 'ground', label: 'background', key: true },
  { name: 'text', label: 'text', key: true },
  { name: 'muted', label: 'muted text', key: true },
  { name: 'accent', label: 'accent', key: true },
  { name: 'danger', label: 'mistakes', key: true },
  { name: 'accent-ink', label: 'on accent' },
  { name: 'warning', label: 'warning' },
  { name: 'ghost', label: 'ghost' },
  { name: 'ground-2', label: 'background 2', derived: true },
  { name: 'raised', label: 'raised', derived: true },
  { name: 'card-top', label: 'card top', derived: true },
  { name: 'card-bottom', label: 'card bottom', derived: true },
  { name: 'outline', label: 'outline', derived: true },
  { name: 'selection', label: 'selection', derived: true },
  { name: 'raised-2', label: 'hover', derived: true },
  { name: 'placeholder', label: 'placeholder', derived: true },
  { name: 'hairline', label: 'rule', derived: true },
  { name: 'hairline-strong', label: 'strong rule', derived: true },
  { name: 'accent-soft', label: 'accent tint', derived: true },
  { name: 'practice-level-1', label: 'practice 1', derived: true },
  { name: 'practice-level-2', label: 'practice 2', derived: true },
  { name: 'practice-level-3', label: 'practice 3', derived: true },
  { name: 'danger-soft', label: 'mistake tint', derived: true },
  { name: 'heat-1', label: 'heat 1', derived: true },
  { name: 'heat-2', label: 'heat 2', derived: true },
  { name: 'heat-3', label: 'heat 3', derived: true },
  { name: 'word-highlight', label: 'word highlight', derived: true },
  { name: 'finger-band', label: 'finger band', derived: true },
  { name: 'backdrop', label: 'backdrop', derived: true },
];

export const BASE_TOKENS = THEME_TOKENS.flatMap((token) => (token.derived ? [] : [token.name]));
const TOKEN_NAMES = new Set(THEME_TOKENS.map((token) => token.name));

const HEX = /^#[0-9a-f]{6}$/;

export const normalizeHex = (value) => {
  const text = typeof value === 'string' ? value.trim().toLowerCase() : '';
  const hex = text.startsWith('#') ? text : `#${text}`;

  return HEX.test(hex) ? hex : null;
};

const channels = (hex) => [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16));

const linear = (value) => {
  const s = value / 255;

  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};

export const luminance = (hex) => {
  const [r, g, b] = channels(hex).map(linear);

  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

export const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);

  return (hi + 0.05) / (lo + 0.05);
};

const toHex = (rgb) => `#${rgb.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('')}`;

// `top` at `alpha` over `under`, as the stylesheet's color-mix(in srgb, top N%, transparent) paints it.
export const mix = (top, under, alpha) => toHex(channels(top).map((v, i) => v * alpha + channels(under)[i] * (1 - alpha)));

// Dark or light: whichever of black or white text contrasts more with the background (0.179 is where
// the two are equal).
export const themeMode = (colors) => (luminance(colors.ground) > 0.179 ? 'light' : 'dark');

// What has to stay readable on the background: passage text (typed and untyped) and the coral of a
// mistyped letter on its tint need 4.5:1 (WCAG AA for text), the caret 3:1 (AA for non-text).
// The tint's share matches the stylesheet's derived --danger-soft.
export const READABLE = [
  { name: 'text', min: 4.5 },
  { name: 'muted', min: 4.5 },
  { name: 'accent', min: 3 },
  { name: 'danger', min: 4.5 },
];

export function contrastIssues(colors) {
  const issues = {};
  const tint = colors['danger-soft'] || mix(colors.danger, colors.ground, themeMode(colors) === 'light' ? 0.12 : 0.16);

  for (const { name, min } of READABLE) {
    const under = name === 'danger' ? tint : colors.ground;
    const ratio = contrast(colors[name], under);

    if (ratio < min) issues[name] = Math.floor(ratio * 10) / 10;
  }

  return issues;
}

export const cleanThemeName = (value) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, MAX_THEME_NAME) : '');

// A stored theme as this build uses it: hex colours for every base token and any derived ones
// overridden, nothing else. Anything short of that is dropped, as are repeats and any past the cap.
function normalizeTheme(raw) {
  if (!raw || typeof raw !== 'object' || !isCustomId(raw.id)) return null;
  const name = cleanThemeName(raw.name);
  const colors = {};

  for (const [token, value] of Object.entries(raw.colors && typeof raw.colors === 'object' ? raw.colors : {})) {
    const hex = TOKEN_NAMES.has(token) && normalizeHex(value);

    if (hex) colors[token] = hex;
  }

  if (!name || BASE_TOKENS.some((token) => !colors[token])) return null;

  return { id: raw.id.slice(0, 64), name, colors };
}

// Stored as JSON text, not an array: older builds compare settings with ===, and would take an array
// for a fresh change on every save and stamp their copy over newer themes from elsewhere.
function themeList(value) {
  let list = value;

  if (typeof value === 'string') {
    try { list = JSON.parse(value); } catch { list = []; }
  }

  const themes = [];

  for (const theme of (Array.isArray(list) ? list : []).map(normalizeTheme)) {
    if (theme && !themes.some((kept) => kept.id === theme.id) && themes.length < MAX_CUSTOM_THEMES) themes.push(theme);
  }

  return themes;
}

export const normalizeCustomThemes = (value) => JSON.stringify(themeList(value));

// The saved themes in a `customThemes` preference, already normalized.
let lastText = null;
let lastList = [];

export function readCustomThemes(text) {
  if (text !== lastText) [lastText, lastList] = [text, themeList(text)];

  return lastList;
}

export const newThemeId = () => `${CUSTOM_PREFIX}${(globalThis.crypto?.randomUUID?.() || `${Date.now()}${Math.random()}`).replace(/[^a-z0-9]/gi, '').slice(0, 12)}`;
