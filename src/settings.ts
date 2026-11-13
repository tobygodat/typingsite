import { createPaceControls } from './pace-controls.js';
import { createKeybindingEditor } from './keybinding-editor.js';
import { flushSync } from 'react-dom';
import { createStore } from './store.js';

export type SettingsCategory = 'appearance' | 'practice' | 'keyboard' | 'sound' | 'shortcuts';

export type SettingId = 'wallpaper-style' | 'numbers-toggle' | 'word-list' | 'repeat-quotes-toggle' | 'daily-goal' | 'train-focus' | 'drill-length' | 'retest-toggle' | 'font-size' | 'typing-font' | 'app-font' | 'speed-unit' | 'word-highlight' | 'word-highlight-slide' | 'live-toggle' | 'keyboard-toggle' | 'finger-toggle' | 'layout-select' | 'correction-select' | 'strict-space-toggle' | 'quick-end-toggle' | 'min-accuracy' | 'min-wpm' | 'theme-select' | 'dark-theme' | 'light-theme' | 'pace-select' | 'focus-toggle' | 'tape-toggle' | 'sound-select';

interface SettingsPresentation { slide: boolean; standard: boolean; rules: string; quickEnd: string; volume: number; soundOff: boolean }

interface SettingsView {
  presentation: SettingsPresentation;
  category: SettingsCategory;
  selected: Partial<Record<SettingId, string>>;
  disabled: Partial<Record<SettingId, boolean>>;
}

interface SettingsHost {
  open(category: SettingsCategory, from?: Element | null): void;
  close(): void;
  category(): void;
}

export function createSettings() {
  let host: SettingsHost | null = null;
  let stopRecording = () => {};
  let volumeInput = (value: number) => { void value; };
  let volumeCommit = () => {};
  const choices = new Map<SettingId, (value: string) => void>();
  const view = createStore<SettingsView>({ category: 'appearance', selected: {}, disabled: {}, presentation: { slide: false, standard: false, rules: '', quickEnd: '', volume: 50, soundOff: true } });

  function select(id: SettingId, value: string | number | boolean) {
    const current = view.getSnapshot();
    const selected = String(value);

    if (current.selected[id] === selected) return;
    flushSync(() => view.publish({ ...current, selected: { ...current.selected, [id]: selected } }));
  }

  function category(next: SettingsCategory) {
    flushSync(() => view.publish({ ...view.getSnapshot(), category: next }));
    host?.category();
    stopRecording();
  }

  return {
    pace: createPaceControls(),
    view, select, category,
    present(patch: Partial<SettingsPresentation>) { const current = view.getSnapshot();

      flushSync(() => view.publish({ ...current, presentation: { ...current.presentation, ...patch } }));
    },
    onVolume(edit: (value: number) => void, commit: () => void) { volumeInput = edit; volumeCommit = commit; },
    editVolume(value: number) { volumeInput(value); },
    commitVolume() { volumeCommit(); },
    keybindings: createKeybindingEditor(),
    disable(id: SettingId, disabled: boolean) {
      const current = view.getSnapshot();

      if (current.disabled[id] === disabled) return;
      flushSync(() => view.publish({ ...current, disabled: { ...current.disabled, [id]: disabled } }));
    },
    onSetting(id: SettingId, choose: (value: string) => void) { choices.set(id, choose); },
    choose(id: SettingId, value: string) { select(id, value); choices.get(id)?.(value); },
    open(next = view.getSnapshot().category, from?: Element | null) {
      category(next);
      host?.open(next, from);
    },
    close() { host?.close(); },
    closed() { stopRecording(); },
    configure(stop: () => void) { stopRecording = stop; },
    attach(next: SettingsHost) {
      host = next;

      return () => { if (host === next) host = null; };
    },
  };
}

export type SettingsController = ReturnType<typeof createSettings>;
