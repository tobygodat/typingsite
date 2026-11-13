import { isRecord } from './domain-values.js';
import { APP_FONTS, TYPING_FONTS } from './fonts.js';

interface PaintTheme {
  id?: unknown;
  colors: Record<string, unknown> & { ground: string };
}

function isPaintTheme(value: unknown): value is PaintTheme {
  return isRecord(value) && isRecord(value.colors) && typeof value.colors.ground === 'string';
}

function parse(text: string): unknown {
  return JSON.parse(text);
}

// This bundle stays inline so cached appearance is applied before CSS and React load.
try {
  const root = document.documentElement;
  const session = parse(localStorage.getItem('stilltype-session-v1') ?? 'null');
  const user = isRecord(session) && isRecord(session.user) ? session.user.id : undefined;
  const profile = user ? parse(localStorage.getItem('stilltype-profile-v2:' + String(user)) ?? 'null') : null;
  const preferences = isRecord(profile) && isRecord(profile.preferences) ? profile.preferences : undefined;
  const dark = ['dark', 'terminal', 'midnight', 'nord'];
  const light = ['light', 'paper', 'shadcn', 'soft', 'swiss', 'e-ink'];
  let customs: PaintTheme[] = [];

  try {
    const stored = parse(String(preferences?.customThemes));

    if (Array.isArray(stored)) customs = stored.filter(isPaintTheme);
  } catch {}

  const custom = (id: unknown) => customs.find((entry) => entry.id === id);

  const channel = (ground: string, at: number) => {
    const value = parseInt(ground.slice(at, at + 2), 16) / 255;

    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };

  const modeOf = (id: unknown) => {
    if (typeof id === 'string' && (dark.includes(id) || light.includes(id))) return dark.includes(id) ? 'dark' : 'light';
    const ground = custom(id)?.colors.ground;

    if (!ground) return null;

    return 0.2126 * channel(ground, 1) + 0.7152 * channel(ground, 3) + 0.0722 * channel(ground, 5) > 0.179 ? 'light' : 'dark';
  };

  const system = matchMedia('(prefers-color-scheme: light)').matches
    ? (modeOf(preferences?.lightTheme) === 'light' ? preferences?.lightTheme : 'light')
    : (modeOf(preferences?.darkTheme) === 'dark' ? preferences?.darkTheme : 'dark');

  const theme = modeOf(preferences?.theme) ? preferences?.theme : system;
  const entry = custom(theme);

  root.dataset.theme = String(entry ? modeOf(theme) : theme);

  if (entry) {
    for (const [name, value] of Object.entries(entry.colors)) {
      if (/^[a-z0-9-]+$/.test(name) && /^#[0-9a-f]{6}$/i.test(String(value))) root.style.setProperty('--' + name, String(value));
    }

    root.dataset.custom = '';
  }

  if (typeof preferences?.typingFont === 'string' && TYPING_FONTS.includes(preferences.typingFont)) root.dataset.typingFont = preferences.typingFont;

  if (typeof preferences?.appFont === 'string' && APP_FONTS.includes(preferences.appFont)) root.dataset.appFont = preferences.appFont;
} catch {}
