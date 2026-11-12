// Typing font (the passage, the compose field, replay) and app font (everything else readable, numerals
// included), chosen in settings → appearance. Display only, never a test condition. Each id names a
// family stack in src/styles.css (html[data-typing-font], html[data-app-font]); a font file loads the
// first time text uses it. The inline prepaint bundle shares these lists to apply signed-in picks.

export const DEFAULT_FONT = 'literata';
export const TYPING_FONTS = ['literata', 'source-serif', 'inter', 'jetbrains-mono', 'ibm-plex-mono', 'roboto-mono', 'fira-code'];
export const APP_FONTS = ['literata', 'source-serif', 'inter'];

export const fontName = (id: string) => id.replaceAll('-', ' ');
export const normalizeFont = (value: unknown, fonts: readonly string[]) => (typeof value === 'string' && fonts.includes(value) ? value : DEFAULT_FONT);
