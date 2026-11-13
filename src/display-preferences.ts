import type { LearningStore } from './learning-store.js';
import type { PracticeSession, SessionKind } from './practice-session.js';
import type { ProfileSync } from './profile-sync.js';
import type { SettingsController } from './settings.js';
import type { ThemeEditorController } from './theme-editor.js';
import { showThemeOptions, wearColors } from './theme-editor.js';
import { DARK_THEMES, LIGHT_THEMES } from './profile.js';
import type { CustomTheme } from './custom-themes.js';
import { normalizeCustomThemes, readCustomThemes, themeMode as colorsMode } from './custom-themes.js';

type ThemeMode = 'dark' | 'light';

interface DisplayPorts { light(): boolean; restorePassage(): void; typingRelayout(): void; relayout(): void; onlineRelayout(): void; syncSound(): void }

export function createDisplayPreferences({ learning, practice, sync, settings, themeEditor, ports }: {
  learning: LearningStore; practice: PracticeSession; sync: ProfileSync; settings: SettingsController; themeEditor: ThemeEditorController; ports: DisplayPorts;
}) {
  function modeOf(theme: string): ThemeMode | null {
    if (DARK_THEMES.includes(theme)) return 'dark';

    if (LIGHT_THEMES.includes(theme)) return 'light';
    const custom = readCustomThemes(learning.preferences.customThemes).find((entry) => entry.id === theme);

    return custom ? colorsMode(custom.colors) : null;
  }

  function themeMode() {
    const theme = learning.preferences.theme;

    return typeof theme === 'string' ? modeOf(theme) ?? 'system' : 'system';
  }

  function themeFor(mode: ThemeMode) {
    const current = learning.preferences.theme;

    if (typeof current === 'string' && modeOf(current) === mode) return current;
    const saved = learning.preferences[`${mode}Theme`];

    return modeOf(saved) === mode ? saved : mode;
  }

  function shownTheme() {
    const mode = themeMode();

    return themeFor(mode === 'system' ? ports.light() ? 'light' : 'dark' : mode);
  }

  function wearTheme(colors: Parameters<typeof wearColors>[1], theme?: string) {
    const root = document.documentElement;
    root.dataset.theme = String(wearColors(root, colors) ?? theme);
    const ground = getComputedStyle(root).getPropertyValue('--ground').trim();

    for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) meta.content = ground;
  }

  function applyTheme() {
    const themes = readCustomThemes(learning.preferences.customThemes);
    const theme = shownTheme();
    wearTheme(themeEditor.draftColors() ?? themes.find((entry) => entry.id === theme)?.colors, theme);
    showThemeOptions(themes, theme);
    settings.select('theme-select', themeMode());
    settings.select('dark-theme', themeFor('dark'));
    settings.select('light-theme', themeFor('light'));
  }

  function keepPick() {
    const left = themeMode();

    if (left !== 'system') learning.preferences[`${left}Theme`] = themeFor(left);
  }

  function showTheme(theme: string) {
    themeEditor.close({ focus: false });
    keepPick();
    learning.preferences.theme = theme;
    applyTheme();
    sync.saveChoice('theme');
  }

  function setThemeMode(mode: string) {
    showTheme(mode === 'dark' || mode === 'light' ? themeFor(mode) : mode);
  }

  function pickTheme(mode: ThemeMode, theme: string) {
    if (themeMode() !== 'system') return showTheme(theme);
    themeEditor.close({ focus: false });
    learning.preferences[`${mode}Theme`] = theme;
    applyTheme();
    sync.saveChoice(`${mode}Theme`);
  }

  function saveCustomThemes(customThemes: string | readonly CustomTheme[], saved?: string | null) {
    const mode = themeMode();
    keepPick();
    learning.preferences.customThemes = normalizeCustomThemes(customThemes);
    const current = learning.preferences.theme;

    if (current !== 'system' && (typeof current !== 'string' || !modeOf(current))) learning.preferences.theme = mode;
    const modes: ThemeMode[] = ['dark', 'light'];

    for (const pick of modes) if (modeOf(learning.preferences[`${pick}Theme`]) !== pick) learning.preferences[`${pick}Theme`] = pick;

    if (saved) {
      if (themeMode() === 'system') learning.preferences[`${modeOf(saved)}Theme`] = saved;
      else { keepPick(); learning.preferences.theme = saved; }
    }

    applyTheme();
    sync.saveChoice('customThemes', 'theme', 'darkTheme', 'lightTheme');
  }

  const tapeLayout = () => String(learning.preferences.tape && practice.sessionKind !== 'challenge');

  function syncLayout() {
    if (document.body.dataset.tape !== tapeLayout() || document.body.dataset.fontSize !== String(learning.preferences.fontSize)) ports.restorePassage();
    document.body.dataset.fontSize = String(learning.preferences.fontSize);
    document.body.dataset.tape = tapeLayout();
    ports.typingRelayout();
  }

  function measureTypingBaseline() {
    const probe = document.createElement('canvas').getContext('2d');

    if (!probe) throw new TypeError('The typing font needs a canvas context');
    probe.font = `1000px ${getComputedStyle(document.documentElement).getPropertyValue('--font-typing')}`;
    const { fontBoundingBoxAscent: ascent, fontBoundingBoxDescent: descent } = probe.measureText('H');

    if (ascent) document.documentElement.style.setProperty('--typing-baseline', `${(ascent - descent) / 2000}em`);
  }

  function applyFonts() {
    const root = document.documentElement.dataset;
    settings.select('typing-font', learning.preferences.typingFont);
    settings.select('app-font', learning.preferences.appFont);

    if (root.typingFont === learning.preferences.typingFont && root.appFont === learning.preferences.appFont) return;
    root.typingFont = learning.preferences.typingFont;
    root.appFont = learning.preferences.appFont;
    measureTypingBaseline();
    ports.relayout();
    ports.onlineRelayout();
  }

  function applySound() {
    ports.syncSound();
    settings.select('sound-select', learning.preferences.sound);
    settings.present({ volume: learning.preferences.soundVolume, soundOff: learning.preferences.sound === 'off' });
  }

  return { themeMode, themeFor, shownTheme, wearTheme, applyTheme, setThemeMode, pickTheme, saveCustomThemes,
    syncLayout, measureTypingBaseline, applyFonts, applySound,
    session(kind: SessionKind) { practice.sessionKind = kind; syncLayout(); },
  };
}
