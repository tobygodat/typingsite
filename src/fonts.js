// Typing font (the passage, the compose field, replay) and app font (everything else readable, numerals
// included), chosen in settings → appearance. Display only, never a test condition. Each id names a
// family stack in src/styles.css (html[data-typing-font], html[data-app-font]); a font file loads the
// first time text uses it. index.html applies a signed-in pick before first paint and keeps its own
// copy of these lists (tests/fonts.test.js keeps them equal).

export const DEFAULT_FONT = 'literata';
export const TYPING_FONTS = ['literata', 'source-serif', 'inter', 'jetbrains-mono', 'ibm-plex-mono', 'roboto-mono', 'fira-code'];
export const APP_FONTS = ['literata', 'source-serif', 'inter'];

export const fontName = (id) => id.replaceAll('-', ' ');
export const normalizeFont = (value, fonts) => (fonts.includes(value) ? value : DEFAULT_FONT);
