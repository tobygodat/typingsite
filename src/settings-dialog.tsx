import { PaceNote, PaceCustom } from './pace-controls.js';
import { formatSpeed, unitText } from './units.js';
import { MIN_WPM_OPTIONS } from './profile.js';
import type { SettingsImport } from './import-dialog.js';
import { AccountSaved } from './account-view.js';
import type { AccountSession } from './account-session.js';
import { createThemeEditor, ThemeSettings } from './theme-editor.js';
import type { ThemeEditorController } from './theme-editor.js';
import { createWallpaper } from './wallpaper.js';
import type { WallpaperController } from './wallpaper.js';
import { WallpaperSettings } from './wallpaper-settings.js';
import { KeybindingEditor } from './keybinding-editor.js';
import { APP_FONTS, DEFAULT_FONT, TYPING_FONTS, fontName } from './fonts.js';
import { wordListIds } from './words.js';
import { useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { CSSProperties, InputHTMLAttributes, MouseEvent } from 'react';
import { createSettings } from './settings.js';
import type { RangeId, SettingId, SettingsController } from './settings.js';
import { CARET_GLIDE } from './caret-glide.js';

export function SettingsDialog({ controller, themeEditor: providedTheme, wallpaper: providedWallpaper, accounts, importing }: { controller?: SettingsController; themeEditor?: ThemeEditorController; wallpaper?: WallpaperController; accounts?: AccountSession; importing?: SettingsImport } = {}) {
  const [localTheme] = useState(createThemeEditor);
  const [localWallpaper] = useState(createWallpaper);
  const themeEditor = providedTheme ?? localTheme;
  const wallpaper = providedWallpaper ?? localWallpaper;
  const [local] = useState(createSettings);
  const settings = controller ?? local;
  const view = useSyncExternalStore(settings.view.subscribe, settings.view.getSnapshot, settings.view.getSnapshot);
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<Element | null>(null);
  useLayoutEffect(() => settings.attach({
    open(category, from) {
      opener.current = from === undefined ? document.activeElement : from;
      const panel = dialog.current;

      if (panel && !panel.open) panel.showModal();
      panel?.querySelector<HTMLButtonElement>(`[data-settings-category="${category}"]`)?.focus({ preventScroll: true });
    },
    close() {
      if (!dialog.current?.open) return;
      dialog.current.close();

      if (document.querySelector('dialog[open]')) return;
      const target = opener.current instanceof HTMLElement && opener.current.isConnected && opener.current.checkVisibility({ visibilityProperty: true }) ? opener.current : document.getElementById('exit-focus');
      target?.focus({ preventScroll: true });
    },
    category() { const content = dialog.current?.querySelector('.settings-content');

 if (content) content.scrollTop = 0; },
  }), [settings]);

  function radio(id: SettingId, value: string, fallback = false): InputHTMLAttributes<HTMLInputElement> {
    return { value, checked: view.selected[id] === undefined ? fallback : view.selected[id] === value, readOnly: true };
  }

  function choose(id: SettingId, event: MouseEvent<HTMLFieldSetElement>) {
    const target = event.target;

    if (target instanceof HTMLInputElement && target.type === 'radio' && !target.matches(':disabled')) settings.choose(id, target.value);
  }

  return (
<dialog
  ref={dialog}
  id="settings-dialog"
  aria-labelledby="settings-title"
  onCancel={(event) => { event.preventDefault(); settings.close(); }}
  onClose={(event) => {
    event.currentTarget.removeAttribute('data-radio-keyboard-focus');
    themeEditor.close({ focus: false });
    settings.closed();
  }}
  onKeyDownCapture={(event) => {
    const target = event.target;

    if (event.key.startsWith('Arrow') && target instanceof HTMLInputElement && target.type === 'radio') {
      event.currentTarget.setAttribute('data-radio-keyboard-focus', '');
    }
  }}
  onPointerDownCapture={(event) => event.currentTarget.removeAttribute('data-radio-keyboard-focus')}
>
    <header className="settings-header">
      <h2 id="settings-title">Settings</h2>
      <button id="settings-close" type="button" onClick={() => settings.close()} aria-label="Close settings"><span className="key-hint">esc</span><span aria-hidden="true">×</span></button>
    </header>
    <div className="settings-body">
      <nav className="settings-nav" aria-label="Settings categories">
        <button type="button" id="settings-appearance-button" data-settings-category="appearance" aria-controls="settings-appearance" aria-current={view.category === 'appearance' ? 'true' : undefined} onClick={() => settings.category('appearance')}>Appearance</button>
        <button type="button" id="settings-practice-button" data-settings-category="practice" aria-controls="settings-practice" aria-current={view.category === 'practice' ? 'true' : undefined} onClick={() => settings.category('practice')}>Practice</button>
        <button type="button" id="settings-keyboard-button" data-settings-category="keyboard" aria-controls="settings-keyboard" aria-current={view.category === 'keyboard' ? 'true' : undefined} onClick={() => settings.category('keyboard')}>Keyboard</button>
        <button type="button" id="settings-sound-button" data-settings-category="sound" aria-controls="settings-sound" aria-current={view.category === 'sound' ? 'true' : undefined} onClick={() => settings.category('sound')}>Sound</button>
        <button type="button" id="settings-shortcuts-button" data-settings-category="shortcuts" aria-controls="settings-shortcuts" aria-current={view.category === 'shortcuts' ? 'true' : undefined} onClick={() => settings.category('shortcuts')}>Shortcuts</button>
      </nav>
      <div className="settings-content">
        <section id="settings-appearance" className="settings-category" aria-labelledby="settings-appearance-button" hidden={view.category !== 'appearance'}>
          <h3 className="settings-group-title">Colors and background</h3>
          <ThemeSettings controller={themeEditor} settings={settings} />
          <WallpaperSettings controller={wallpaper} settings={settings} />
          <h3 className="settings-group-title">Interface</h3>
          <div className="preference-row">
            <div className="preference-copy"><strong id="navigation-select-label">navigation</strong></div>
            <fieldset className="setting-options" id="navigation-select" aria-labelledby="navigation-select-label" disabled={view.disabled['navigation-select'] ?? false} onClick={(event) => choose('navigation-select', event)}>
              <label className="setting-option"><input type="radio" name="navigation-select" {...radio('navigation-select', 'side', true)} /><span>side bar</span></label>
              <label className="setting-option"><input type="radio" name="navigation-select" {...radio('navigation-select', 'top')} /><span>top bar</span></label>
            </fieldset>
          </div>
          <div className="preference-row">
            <div className="preference-copy"><strong id="app-font-label">app font</strong></div>
            <fieldset className="setting-options" id="app-font" aria-labelledby="app-font-label" disabled={view.disabled['app-font'] ?? false} onClick={(event) => choose('app-font', event)}>
              {APP_FONTS.map((font) => <label key={font} className="setting-option"><input type="radio" name="app-font" {...radio('app-font', font, font === DEFAULT_FONT)} /><span>{fontName(font)}</span></label>)}
            </fieldset>
          </div>
          <h3 className="settings-group-title">Typing display</h3>
          <div className="preference-row">
            <div className="preference-copy"><strong id="font-size-label">text size</strong></div>
            <fieldset className="setting-options" id="font-size" aria-labelledby="font-size-label" disabled={view.disabled['font-size'] ?? false} onClick={(event) => choose('font-size', event)}>
              <label className="setting-option"><input type="radio" name="font-size" {...radio('font-size', '22')} /><span>small</span></label>
              <label className="setting-option"><input type="radio" name="font-size" {...radio('font-size', '28', true)} /><span>medium</span></label>
              <label className="setting-option"><input type="radio" name="font-size" {...radio('font-size', '36')} /><span>large</span></label>
            </fieldset>
          </div>
          <div className="preference-row">
            <div className="preference-copy"><strong id="word-highlight-label">word highlight</strong></div>
            <fieldset className="setting-options" id="word-highlight" aria-labelledby="word-highlight-label" disabled={view.disabled['word-highlight'] ?? false} onClick={(event) => choose('word-highlight', event)}>
              <label className="setting-option"><input type="radio" name="word-highlight" {...radio('word-highlight', 'off', true)} /><span>off</span></label>
              <label className="setting-option"><input type="radio" name="word-highlight" {...radio('word-highlight', 'current')} /><span>this word</span></label>
              <label className="setting-option"><input type="radio" name="word-highlight" {...radio('word-highlight', 'next')} /><span>next word</span></label>
            </fieldset>
          </div>
          <div className="preference-row" hidden={!view.presentation.slide}>
            <div className="preference-copy"><strong id="word-highlight-slide-label">slide</strong></div>
            <fieldset className="setting-options" id="word-highlight-slide" aria-labelledby="word-highlight-label word-highlight-slide-label" disabled={view.disabled['word-highlight-slide'] ?? false} onClick={(event) => choose('word-highlight-slide', event)}>
              <label className="setting-option"><input type="radio" name="word-highlight-slide" {...radio('word-highlight-slide', 'false', true)} /><span>off</span></label>
              <label className="setting-option"><input type="radio" name="word-highlight-slide" {...radio('word-highlight-slide', 'true')} /><span>on</span></label>
            </fieldset>
          </div>
          <div className="preference-row">
            <div className="preference-copy"><strong id="typing-motion-label">typing motion</strong><small className="preference-note" id="typing-motion-note">Spring carries the caret through a burst. Instant skips caret, scroll, and word highlight animations.</small></div>
            <fieldset className="setting-options" id="typing-motion" aria-labelledby="typing-motion-label" aria-describedby="typing-motion-note" onClick={(event) => choose('typing-motion', event)}>
              <label className="setting-option"><input type="radio" name="typing-motion" {...radio('typing-motion', 'spring', true)} /><span>spring</span></label>
              <label className="setting-option"><input type="radio" name="typing-motion" {...radio('typing-motion', 'smooth')} /><span>smooth</span></label>
              <label className="setting-option"><input type="radio" name="typing-motion" {...radio('typing-motion', 'instant')} /><span>instant</span></label>
            </fieldset>
          </div>
          <PreferenceRange settings={settings} id="caret-glide" label="glide speed" note="Smooth only. Shorter is faster." value={view.presentation.caretGlide} min={CARET_GLIDE.min} max={CARET_GLIDE.max} step={CARET_GLIDE.step} unit=" ms" disabled={view.presentation.glideOff} />
          <div className="preference-row">
            <div className="preference-copy"><strong id="tape-toggle-label">one-line tape</strong></div>
            <fieldset className="setting-options" id="tape-toggle" aria-labelledby="tape-toggle-label" disabled={view.disabled['tape-toggle'] ?? false} onClick={(event) => choose('tape-toggle', event)}>
              <label className="setting-option"><input type="radio" name="tape-toggle" {...radio('tape-toggle', 'false', true)} /><span>off</span></label>
              <label className="setting-option"><input type="radio" name="tape-toggle" {...radio('tape-toggle', 'true')} /><span>on</span></label>
            </fieldset>
          </div>
          <div className="preference-row">
            <label className="preference-copy" htmlFor="typing-font"><strong>typing font</strong></label>
            <select id="typing-font" value={view.selected['typing-font'] ?? DEFAULT_FONT} disabled={view.disabled['typing-font']} onChange={(event) => settings.choose('typing-font', event.currentTarget.value)}>
              {TYPING_FONTS.map((font) => <option key={font} value={font}>{fontName(font)}</option>)}
            </select>
          </div>
          <div className="settings-preview" aria-label="Passage preview">
            <p id="settings-preview-passage"><span>Find</span> <span>a</span> <span>little</span> <span>room</span> <span>for</span> <span>thought.</span></p>
          </div>
        </section>
        <section id="settings-practice" className="settings-category" aria-labelledby="settings-practice-button" hidden={view.category !== 'practice'}>
          <h3 className="settings-group-title">Test setup</h3>
          <div className="preference-row">
            <div className="preference-copy"><strong id="word-list-label">word list</strong><small id="word-list-lock" className="preference-lock" hidden={!view.presentation.standard}>{view.presentation.standard ? 'fixed for standard' : ''}</small></div>
            <fieldset className="setting-options" id="word-list" aria-labelledby="word-list-label" aria-describedby="word-list-lock" disabled={view.disabled['word-list'] ?? false} onClick={(event) => choose('word-list', event)}>
              {wordListIds.map((id) => <label key={id} className="setting-option"><input type="radio" name="word-list" {...radio('word-list', id, id === '200')} /><span>top {id}</span></label>)}
              <label className="setting-option" hidden={!view.presentation.standard}><input type="radio" name="word-list" disabled {...radio('word-list', 'standard')} /><span>1k–10k</span></label>
            </fieldset>
          </div>
          <div className="preference-row">
            <div className="preference-copy"><strong id="numbers-toggle-label">numbers</strong><small id="numbers-toggle-lock" className="preference-lock" hidden>fixed for standard</small></div>
            <fieldset className="setting-options" id="numbers-toggle" aria-labelledby="numbers-toggle-label" aria-describedby="numbers-toggle-lock" disabled={view.disabled['numbers-toggle'] ?? false} onClick={(event) => choose('numbers-toggle', event)}>
              <label className="setting-option"><input type="radio" name="numbers-toggle" {...radio('numbers-toggle', 'false', true)} /><span>off</span></label>
              <label className="setting-option"><input type="radio" name="numbers-toggle" {...radio('numbers-toggle', 'true')} /><span>on</span></label>
            </fieldset>
          </div>
          <div className="preference-row">
            <div className="preference-copy"><strong id="repeat-quotes-toggle-label">repeat quotes</strong></div>
            <fieldset className="setting-options" id="repeat-quotes-toggle" aria-labelledby="repeat-quotes-toggle-label" disabled={view.disabled['repeat-quotes-toggle'] ?? false} onClick={(event) => choose('repeat-quotes-toggle', event)}>
              <label className="setting-option"><input type="radio" name="repeat-quotes-toggle" {...radio('repeat-quotes-toggle', 'false', true)} /><span>off</span></label>
              <label className="setting-option"><input type="radio" name="repeat-quotes-toggle" {...radio('repeat-quotes-toggle', 'true')} /><span>on</span></label>
            </fieldset>
          </div>
          <h3 className="settings-group-title">Typing rules</h3>
          <div className="preference-row">
            <div className="preference-copy"><strong id="correction-select-label">correction</strong><small id="correction-select-lock" className="preference-lock" hidden>fixed for standard</small></div>
            <fieldset className="setting-options" id="correction-select" aria-labelledby="correction-select-label" aria-describedby="correction-select-lock" disabled={view.disabled['correction-select'] ?? false} onClick={(event) => choose('correction-select', event)}>
              <label className="setting-option"><input type="radio" name="correction-select" {...radio('correction-select', 'relaxed', true)} /><span>free</span></label>
              <label className="setting-option"><input type="radio" name="correction-select" {...radio('correction-select', 'mandatory')} /><span>stop on error</span></label>
              <label className="setting-option"><input type="radio" name="correction-select" {...radio('correction-select', 'no-backspace')} /><span>no backspace</span></label>
              <label className="setting-option"><input type="radio" name="correction-select" {...radio('correction-select', 'fail-word')} /><span>fail on word error</span></label>
              <label className="setting-option"><input type="radio" name="correction-select" {...radio('correction-select', 'fail-any')} /><span>fail on any error</span></label>
            </fieldset>
          </div>
          <div className="preference-row">
            <div className="preference-copy"><strong id="strict-space-toggle-label">strict space</strong><small className="preference-note" id="rules-note" hidden={!view.presentation.rules}>{view.presentation.rules}</small></div>
            <fieldset className="setting-options" id="strict-space-toggle" aria-labelledby="strict-space-toggle-label" aria-describedby="rules-note" disabled={view.disabled['strict-space-toggle'] ?? false} onClick={(event) => choose('strict-space-toggle', event)}>
              <label className="setting-option"><input type="radio" name="strict-space-toggle" {...radio('strict-space-toggle', 'false', true)} /><span>off</span></label>
              <label className="setting-option"><input type="radio" name="strict-space-toggle" {...radio('strict-space-toggle', 'true')} /><span>on</span></label>
            </fieldset>
          </div>
          <div className="preference-row">
            <div className="preference-copy"><strong id="word-flow-toggle-label">word flow</strong><small className="preference-note" id="word-flow-note">Fluid: space ends a word where it stands. Races, code, the standard test and strict rules stay linear.</small></div>
            <fieldset className="setting-options" id="word-flow-toggle" aria-labelledby="word-flow-toggle-label" aria-describedby="word-flow-note" disabled={view.disabled['word-flow-toggle'] ?? false} onClick={(event) => choose('word-flow-toggle', event)}>
              <label className="setting-option"><input type="radio" name="word-flow-toggle" {...radio('word-flow-toggle', 'fluid', true)} /><span>fluid</span></label>
              <label className="setting-option"><input type="radio" name="word-flow-toggle" {...radio('word-flow-toggle', 'linear')} /><span>linear</span></label>
            </fieldset>
          </div>
          <div className="preference-row">
            <div className="preference-copy"><strong id="quick-end-toggle-label">quick end</strong><small className="preference-note" id="quick-end-note" hidden={!view.presentation.quickEnd}>{view.presentation.quickEnd}</small></div>
            <fieldset className="setting-options" id="quick-end-toggle" aria-labelledby="quick-end-toggle-label" aria-describedby="quick-end-note rules-note" disabled={view.disabled['quick-end-toggle'] ?? false} onClick={(event) => choose('quick-end-toggle', event)}>
              <label className="setting-option"><input type="radio" name="quick-end-toggle" {...radio('quick-end-toggle', 'false')} /><span>off</span></label>
              <label className="setting-option"><input type="radio" name="quick-end-toggle" {...radio('quick-end-toggle', 'true', true)} /><span>on</span></label>
            </fieldset>
          </div>
          <div className="preference-row">
            <div className="preference-copy"><strong id="min-accuracy-label">minimum accuracy</strong></div>
            <fieldset className="setting-options" id="min-accuracy" aria-labelledby="min-accuracy-label" disabled={view.disabled['min-accuracy'] ?? false} onClick={(event) => choose('min-accuracy', event)}>
              <label className="setting-option"><input type="radio" name="min-accuracy" {...radio('min-accuracy', '0', true)} /><span>any %</span></label>
              <label className="setting-option"><input type="radio" name="min-accuracy" {...radio('min-accuracy', '80')} /><span>80%</span></label>
              <label className="setting-option"><input type="radio" name="min-accuracy" {...radio('min-accuracy', '90')} /><span>90%</span></label>
              <label className="setting-option"><input type="radio" name="min-accuracy" {...radio('min-accuracy', '95')} /><span>95%</span></label>
              <label className="setting-option"><input type="radio" name="min-accuracy" {...radio('min-accuracy', '98')} /><span>98%</span></label>
            </fieldset>
          </div>
          <div className="preference-row">
            <div className="preference-copy"><strong id="min-wpm-label">minimum speed</strong></div>
            <fieldset className="setting-options" id="min-wpm" aria-labelledby="min-wpm-label" disabled={view.disabled['min-wpm'] ?? false} onClick={(event) => choose('min-wpm', event)}>
              <label className="setting-option"><input type="radio" name="min-wpm" {...radio('min-wpm', '0', true)} /><span data-speed-unit="any {unit}">{unitText('any {unit}')}</span></label>
              {MIN_WPM_OPTIONS.filter((value) => value !== 0).map((value) => <label key={value} className="setting-option"><input type="radio" name="min-wpm" {...radio('min-wpm', String(value))} /><span data-wpm={value}>{formatSpeed(value)}</span></label>)}
            </fieldset>
          </div>
          <h3 className="settings-group-title">During a test</h3>
          <div className="preference-row">
            <div className="preference-copy"><strong id="pace-select-label">pace caret</strong><PaceNote controller={settings.pace} /></div>
            <fieldset className="setting-options" id="pace-select" aria-labelledby="pace-select-label" aria-describedby="pace-note" disabled={view.disabled['pace-select'] ?? false} onClick={(event) => choose('pace-select', event)}>
              <label className="setting-option"><input type="radio" name="pace-select" {...radio('pace-select', 'off', true)} /><span>off</span></label>
              <label className="setting-option"><input type="radio" name="pace-select" {...radio('pace-select', 'best')} /><span>personal best</span></label>
              <label className="setting-option"><input type="radio" name="pace-select" {...radio('pace-select', 'average')} /><span>average</span></label>
              <label className="setting-option"><input type="radio" name="pace-select" {...radio('pace-select', 'last')} /><span>last run</span></label>
              <label className="setting-option"><input type="radio" name="pace-select" {...radio('pace-select', 'custom')} /><span>custom</span></label>
            </fieldset>
          </div>
          <PaceCustom controller={settings.pace} />
          <div className="preference-row">
            <div className="preference-copy"><strong id="speed-unit-label">speed unit</strong></div>
            <fieldset className="setting-options" id="speed-unit" aria-labelledby="speed-unit-label" disabled={view.disabled['speed-unit'] ?? false} onClick={(event) => choose('speed-unit', event)}>
              <label className="setting-option"><input type="radio" name="speed-unit" {...radio('speed-unit', 'wpm', true)} /><span>wpm</span></label>
              <label className="setting-option"><input type="radio" name="speed-unit" {...radio('speed-unit', 'cpm')} /><span>cpm</span></label>
            </fieldset>
          </div>
          <div className="preference-row">
            <div className="preference-copy"><strong id="live-toggle-label" data-speed-unit="live {unit} and accuracy">{unitText('live {unit} and accuracy')}</strong></div>
            <fieldset className="setting-options" id="live-toggle" aria-labelledby="live-toggle-label" disabled={view.disabled['live-toggle'] ?? false} onClick={(event) => choose('live-toggle', event)}>
              <label className="setting-option"><input type="radio" name="live-toggle" {...radio('live-toggle', 'false', true)} /><span>off</span></label>
              <label className="setting-option"><input type="radio" name="live-toggle" {...radio('live-toggle', 'true')} /><span>on</span></label>
            </fieldset>
          </div>
          <div className="preference-row">
            <div className="preference-copy"><strong id="focus-toggle-label">focus mode</strong></div>
            <fieldset className="setting-options" id="focus-toggle" aria-labelledby="focus-toggle-label" disabled={view.disabled['focus-toggle'] ?? false} onClick={(event) => choose('focus-toggle', event)}>
              <label className="setting-option"><input type="radio" name="focus-toggle" {...radio('focus-toggle', 'false', true)} /><span>off</span></label>
              <label className="setting-option"><input type="radio" name="focus-toggle" {...radio('focus-toggle', 'true')} /><span>on</span></label>
            </fieldset>
          </div>
          <h3 className="settings-group-title">Training</h3>
          <div className="preference-row">
            <div className="preference-copy"><strong id="daily-goal-label">daily goal</strong></div>
            <fieldset className="setting-options" id="daily-goal" aria-labelledby="daily-goal-label" disabled={view.disabled['daily-goal'] ?? false} onClick={(event) => choose('daily-goal', event)}>
              <label className="setting-option"><input type="radio" name="daily-goal" {...radio('daily-goal', '0', true)} /><span>off</span></label>
              <label className="setting-option"><input type="radio" name="daily-goal" {...radio('daily-goal', '5')} /><span>5 min</span></label>
              <label className="setting-option"><input type="radio" name="daily-goal" {...radio('daily-goal', '10')} /><span>10 min</span></label>
              <label className="setting-option"><input type="radio" name="daily-goal" {...radio('daily-goal', '15')} /><span>15 min</span></label>
              <label className="setting-option"><input type="radio" name="daily-goal" {...radio('daily-goal', '30')} /><span>30 min</span></label>
            </fieldset>
          </div>
          <div className="preference-row">
            <div className="preference-copy"><strong id="train-focus-label">train focus</strong></div>
            <fieldset className="setting-options" id="train-focus" aria-labelledby="train-focus-label" disabled={view.disabled['train-focus'] ?? false} onClick={(event) => choose('train-focus', event)}>
              <label className="setting-option"><input type="radio" name="train-focus" {...radio('train-focus', 'balanced', true)} /><span>balanced</span></label>
              <label className="setting-option"><input type="radio" name="train-focus" {...radio('train-focus', 'accuracy')} /><span>accuracy</span></label>
              <label className="setting-option"><input type="radio" name="train-focus" {...radio('train-focus', 'speed')} /><span>speed</span></label>
            </fieldset>
          </div>
          <div className="preference-row">
            <div className="preference-copy"><strong id="drill-length-label">drill length</strong></div>
            <fieldset className="setting-options" id="drill-length" aria-labelledby="drill-length-label" disabled={view.disabled['drill-length'] ?? false} onClick={(event) => choose('drill-length', event)}>
              <label className="setting-option"><input type="radio" name="drill-length" {...radio('drill-length', '15')} /><span>15 s</span></label>
              <label className="setting-option"><input type="radio" name="drill-length" {...radio('drill-length', '30', true)} /><span>30 s</span></label>
              <label className="setting-option"><input type="radio" name="drill-length" {...radio('drill-length', '60')} /><span>60 s</span></label>
              <label className="setting-option"><input type="radio" name="drill-length" {...radio('drill-length', '120')} /><span>120 s</span></label>
            </fieldset>
          </div>
          <div className="preference-row">
            <div className="preference-copy"><strong id="retest-toggle-label">retest after drill</strong></div>
            <fieldset className="setting-options" id="retest-toggle" aria-labelledby="retest-toggle-label" disabled={view.disabled['retest-toggle'] ?? false} onClick={(event) => choose('retest-toggle', event)}>
              <label className="setting-option"><input type="radio" name="retest-toggle" {...radio('retest-toggle', 'false')} /><span>off</span></label>
              <label className="setting-option"><input type="radio" name="retest-toggle" {...radio('retest-toggle', 'true', true)} /><span>on</span></label>
            </fieldset>
          </div>
        </section>
        <section id="settings-keyboard" className="settings-category" aria-labelledby="settings-keyboard-button" hidden={view.category !== 'keyboard'}>
          <div className="preference-row">
            <div className="preference-copy"><strong id="layout-select-label">keyboard layout</strong><small id="layout-note" className="preference-note">Doesn’t remap keys; set the layout in your system.</small></div>
            <fieldset className="setting-options" id="layout-select" aria-labelledby="layout-select-label" aria-describedby="layout-note" disabled={view.disabled['layout-select'] ?? false} onClick={(event) => choose('layout-select', event)}>
              <label className="setting-option"><input type="radio" name="layout-select" {...radio('layout-select', 'qwerty', true)} /><span>qwerty</span></label>
              <label className="setting-option"><input type="radio" name="layout-select" {...radio('layout-select', 'dvorak')} /><span>dvorak</span></label>
              <label className="setting-option"><input type="radio" name="layout-select" {...radio('layout-select', 'colemak')} /><span>colemak</span></label>
              <label className="setting-option"><input type="radio" name="layout-select" {...radio('layout-select', 'colemak-dh')} /><span>colemak-dh</span></label>
              <label className="setting-option"><input type="radio" name="layout-select" {...radio('layout-select', 'workman')} /><span>workman</span></label>
            </fieldset>
          </div>
          <div className="preference-row">
            <div className="preference-copy"><strong id="keyboard-toggle-label">keyboard</strong></div>
            <fieldset className="setting-options" id="keyboard-toggle" aria-labelledby="keyboard-toggle-label" disabled={view.disabled['keyboard-toggle'] ?? false} onClick={(event) => choose('keyboard-toggle', event)}>
              <label className="setting-option"><input type="radio" name="keyboard-toggle" {...radio('keyboard-toggle', 'false', true)} /><span>off</span></label>
              <label className="setting-option"><input type="radio" name="keyboard-toggle" {...radio('keyboard-toggle', 'true')} /><span>on</span></label>
            </fieldset>
          </div>
          <div className="preference-row" id="finger-row">
            <div className="preference-copy"><strong id="finger-toggle-label">finger map</strong><small id="finger-note" className="preference-note">Turn on the keyboard to show its finger map.</small></div>
            <fieldset className="setting-options" id="finger-toggle" aria-labelledby="finger-toggle-label" aria-describedby="finger-note" disabled={view.disabled['finger-toggle'] ?? false} onClick={(event) => choose('finger-toggle', event)}>
              <label className="setting-option"><input type="radio" name="finger-toggle" {...radio('finger-toggle', 'false', true)} /><span>off</span></label>
              <label className="setting-option"><input type="radio" name="finger-toggle" {...radio('finger-toggle', 'true')} /><span>on</span></label>
            </fieldset>
          </div>
        </section>
        <section id="settings-sound" className="settings-category" aria-labelledby="settings-sound-button" hidden={view.category !== 'sound'}>
          <div className="preference-row">
            <div className="preference-copy"><strong id="sound-select-label">sound</strong></div>
            <fieldset className="setting-options" id="sound-select" aria-labelledby="sound-select-label" disabled={view.disabled['sound-select'] ?? false} onClick={(event) => choose('sound-select', event)}>
              <label className="setting-option"><input type="radio" name="sound-select" {...radio('sound-select', 'off', true)} /><span>off</span></label>
              <label className="setting-option"><input type="radio" name="sound-select" {...radio('sound-select', 'clicks')} /><span>clicks</span></label>
              <label className="setting-option"><input type="radio" name="sound-select" {...radio('sound-select', 'clicks-errors')} /><span>clicks + error tick</span></label>
            </fieldset>
          </div>
          <PreferenceRange settings={settings} id="sound-volume" label="volume" value={view.presentation.volume} min={0} max={100} step={5} unit="%" disabled={view.presentation.soundOff} />
        </section>
        <section id="settings-shortcuts" className="settings-category keybindings-category" aria-labelledby="settings-shortcuts-button" hidden={view.category !== 'shortcuts'}>
          <p id="keybindings-help">Mod means Ctrl or ⌘. Leave blank to disable.</p>
          <KeybindingEditor editor={settings.keybindings} />

        </section>
      </div>
    </div>
    <footer className="settings-footer">
      <AccountSaved controller={accounts} />
      <button id="import-trigger" className="btn btn-ghost" type="button" aria-label="Import Monkeytype settings" aria-haspopup="dialog" aria-controls="import-dialog" onClick={() => importing?.open()}>Import Monkeytype</button>
      <button onClick={() => settings.close()} id="settings-done" className="btn btn-primary" type="button">Done</button>
    </footer>
  </dialog>
  );
}

interface RangeProps { settings: SettingsController; id: RangeId; label: string; note?: string; value: number; min: number; max: number; step: number; unit: string; disabled: boolean }

function PreferenceRange({ settings, id, label, note, value, min, max, step, unit, disabled }: RangeProps) {
  const input = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => {
    const field = input.current;

    if (!field) return;
    const commit = () => settings.commitRange(id);
    field.addEventListener('change', commit);

    return () => field.removeEventListener('change', commit);
  }, [settings, id]);
  const style: CSSProperties & { '--fill': string } = { '--fill': `${((value - min) / (max - min)) * 100}%` };
  const shown = `${value}${unit}`;

  return (
    <label className="preference-row" id={`${id}-row`} htmlFor={id}>
      <span className="preference-copy"><strong id={`${id}-label`}>{label}</strong>{note && <small className="preference-note" id={`${id}-note`}>{note}</small>}</span>
      <span className="preference-range">
        <span id={`${id}-value`} className="preference-value num" aria-hidden="true">{shown}</span>
        <input
          ref={input}
          className="range"
          id={id}
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          aria-labelledby={`${id}-label`}
          aria-valuetext={shown}
          aria-describedby={note ? `${id}-note` : undefined}
          disabled={disabled}
          style={style}
          onInput={(event) => settings.editRange(id, Number(event.currentTarget.value))}
        />
      </span>
    </label>
  );
}
