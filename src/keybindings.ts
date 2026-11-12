import { isRecord } from './domain-values.js';

export type KeybindingAction = 'restart' | 'commands' | 'exitFocus';

export interface Keybindings { restart: string; commands: string; exitFocus: string }

export type BindingErrors = Partial<Record<KeybindingAction, string>>;

export type BindingResult = { binding: string; error?: never } | { error: string; binding?: never };

export const KEYBINDING_ACTIONS: KeybindingAction[] = ['restart', 'commands', 'exitFocus'];

// Keyboard policy is shared by settings, profile loading and the event dispatcher.
export const DEFAULT_KEYBINDINGS: Readonly<Keybindings> = Object.freeze({ restart: 'Escape', commands: 'Mod+K', exitFocus: 'Escape' });
export const KEYBINDING_LABELS = Object.freeze({ restart: 'restart test / local challenge', commands: 'commands', exitFocus: 'exit focus mode' });
const modifiers = ['Ctrl', 'Meta', 'Mod', 'Alt', 'Shift'];
const aliases = { control: 'Ctrl', ctrl: 'Ctrl', cmd: 'Meta', command: 'Meta', meta: 'Meta', mod: 'Mod', alt: 'Alt', shift: 'Shift', esc: 'Escape', escape: 'Escape', tab: 'Tab', enter: 'Enter' };

function isAlias(value: string): value is keyof typeof aliases { return Object.hasOwn(aliases, value); }

function alias(value: string) {
  const name = value.toLowerCase();

  return isAlias(name) ? aliases[name] : null;
}

export function parseBinding(value: unknown, action: KeybindingAction): BindingResult {
  if (typeof value !== 'string') return { error: 'Enter a key combination.' };

  if (!value.trim() || value.trim().toLowerCase() === 'none') return { binding: '' };
  const parts = value.trim().split('+').map((part) => part.trim());
  const rawKey = parts.pop() ?? '';
  const key = alias(rawKey) || (/^[a-z0-9]$/i.test(rawKey) ? rawKey.toUpperCase() : /^f(?:[1-9]|1[0-2])$/i.test(rawKey) ? rawKey.toUpperCase() : null);
  const mods = parts.map((part) => alias(part) ?? '');

  if (!key || modifiers.includes(key) || mods.some((mod) => !modifiers.includes(mod)) || new Set(mods).size !== mods.length
    || (mods.includes('Mod') && (mods.includes('Ctrl') || mods.includes('Meta')))) return { error: 'Use a key such as Escape, Tab, Enter, F2 or Ctrl+Shift+E.' };

  if ((mods.includes('Ctrl') || mods.includes('Mod')) && mods.includes('Alt')) return { error: 'Ctrl+Alt is reserved for AltGr typing.' };

  if (mods.includes('Ctrl') && mods.includes('Meta')) return { error: 'Choose Ctrl, Meta or Mod, not Ctrl and Meta together.' };

  if (key === 'Tab' && mods.length) return { error: 'Modified Tab is reserved for focus and browser navigation.' };

  if (key === 'Escape' && mods.length) return { error: 'Use Escape without modifiers so menus can dismiss it.' };
  const primary = mods.some((mod) => ['Ctrl', 'Meta', 'Mod'].includes(mod));

  if (!mods.length && !['Escape', 'Tab', 'Enter', 'F2', 'F4', 'F7', 'F8', 'F9', 'F10'].includes(key)) return { error: 'Printable keys need Ctrl, Meta, Mod or Alt+Shift to preserve typing.' };

  if (mods.length && !primary && !(mods.includes('Alt') && mods.includes('Shift'))) return { error: 'Use Ctrl, Meta, Mod or Alt+Shift with the key.' };

  if (['F1', 'F3', 'F4', 'F5', 'F6', 'F7', 'F10', 'F11', 'F12'].includes(key)
    || (primary && (/^[0-9]$/.test(key) || ['A', 'B', 'C', 'V', 'X', 'Z', 'Y', 'W', 'T', 'N', 'R', 'L', 'P', 'S', 'F', 'D', 'G', 'H', 'I', 'J', 'M', 'Q', 'U', 'O'].includes(key)))
    || (primary && key === 'E' && !mods.includes('Shift'))
    || (mods.includes('Alt') && ['F4', 'F10'].includes(key))) return { error: 'That combination is reserved for the browser or system.' };

  if (action !== 'restart' && ['Tab', 'Enter'].includes(key)) return { error: 'Tab and Enter are available only for restart; other actions must preserve navigation.' };

  return { binding: [...modifiers.filter((mod) => mods.includes(mod)), key].join('+') };
}

function variants(binding: string) {
  return binding.includes('Mod+') ? [binding.replace('Mod+', 'Ctrl+'), binding.replace('Mod+', 'Meta+')] : [binding];
}

export function validateKeybindings(values: unknown) {
  const bindings: Partial<Keybindings> = {};
  const errors: BindingErrors = {};

  for (const action of KEYBINDING_ACTIONS) {
    const result = parseBinding(isRecord(values) ? values[action] : undefined, action);

    if (result.error) errors[action] = result.error;
    else bindings[action] = result.binding;
  }

  const actions = KEYBINDING_ACTIONS.filter((action) => bindings[action] !== undefined);

  for (let i = 0; i < actions.length; i += 1) {
    for (const other of actions.slice(i + 1)) {
      const action = actions[i];

      if (!action) continue;
      const binding = bindings[action];

      // Escape first leaves focus mode, then restarts on the next press, as before.
      if (!binding || (binding === 'Escape' && bindings[other] === 'Escape' && action === 'restart' && other === 'exitFocus')) continue;

      if (variants(binding).some((value) => variants(bindings[other] ?? '').includes(value))) {
        errors[action] = `Already used by ${KEYBINDING_LABELS[other]}.`;
        errors[other] = `Already used by ${KEYBINDING_LABELS[action]}.`;
      }
    }
  }

  return { bindings, errors };
}

export function normalizeKeybindings(value?: unknown, legacyRestart?: unknown): Keybindings {
  const values: Keybindings = { ...DEFAULT_KEYBINDINGS };

  for (const action of KEYBINDING_ACTIONS) {
    if (isRecord(value) && Object.hasOwn(value, action)) {
      const result = parseBinding(value[action], action);

      if (result.binding !== undefined) values[action] = result.binding;
    }
  }

  if (!value && typeof legacyRestart === 'string' && ['Escape', 'Tab', 'Enter'].includes(legacyRestart)) values.restart = legacyRestart;

  return Object.keys(validateKeybindings(values).errors).length ? { ...DEFAULT_KEYBINDINGS } : values;
}

export interface BindingEvent {
  key?: string;
  keyCode?: number;
  isComposing?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  getModifierState?(key: string): boolean;
}

export function matchesBinding(event: BindingEvent, binding: string | null | undefined, { allowAccentComposition = false } = {}) {
  const composing = event.isComposing || event.keyCode === 229;

  if (!binding || (composing && !allowAccentComposition) || event.getModifierState?.('AltGraph')) return false;

  return variants(binding).some((value) => {
    const parts = value.split('+');
    const key = parts.pop() ?? '';

    return event.key?.toUpperCase() === key.toUpperCase()
      && Boolean(event.ctrlKey) === parts.includes('Ctrl') && Boolean(event.metaKey) === parts.includes('Meta')
      && Boolean(event.altKey) === parts.includes('Alt') && Boolean(event.shiftKey) === parts.includes('Shift');
  });
}

export function bindingLabel(binding: string | null | undefined) {
  return binding ? binding.replace('Escape', 'esc').replace('Tab', 'tab').replace('Enter', 'enter').toLowerCase() : 'none';
}

export function ariaShortcuts(binding: string | null | undefined) {
  return binding ? variants(binding).map((value) => value.replace('Ctrl+', 'Control+')).join(' ') : '';
}

