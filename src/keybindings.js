// Keyboard policy is shared by settings, profile loading and the event dispatcher.
export const DEFAULT_KEYBINDINGS = Object.freeze({ restart: 'Escape', commands: 'Mod+K', exitFocus: 'Escape' });
export const KEYBINDING_LABELS = Object.freeze({ restart: 'restart test / local challenge', commands: 'commands', exitFocus: 'exit focus mode' });
const modifiers = ['Ctrl', 'Meta', 'Mod', 'Alt', 'Shift'];
const aliases = { control: 'Ctrl', ctrl: 'Ctrl', cmd: 'Meta', command: 'Meta', meta: 'Meta', mod: 'Mod', alt: 'Alt', shift: 'Shift', esc: 'Escape', escape: 'Escape', tab: 'Tab', enter: 'Enter' };
const alias = (value) => Object.hasOwn(aliases, value.toLowerCase()) ? aliases[value.toLowerCase()] : null;

export function parseBinding(value, action) {
  if (typeof value !== 'string') return { error: 'Enter a key combination.' };
  if (!value.trim() || value.trim().toLowerCase() === 'none') return { binding: '' };
  const parts = value.trim().split('+').map((part) => part.trim());
  const rawKey = parts.pop();
  const key = alias(rawKey) || (/^[a-z0-9]$/i.test(rawKey) ? rawKey.toUpperCase() : /^f(?:[1-9]|1[0-2])$/i.test(rawKey) ? rawKey.toUpperCase() : null);
  const mods = parts.map(alias);
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

function variants(binding) {
  return binding.includes('Mod+') ? [binding.replace('Mod+', 'Ctrl+'), binding.replace('Mod+', 'Meta+')] : [binding];
}

export function validateKeybindings(values) {
  const bindings = {};
  const errors = {};
  for (const action of Object.keys(DEFAULT_KEYBINDINGS)) {
    const result = parseBinding(values?.[action], action);
    if (result.error) errors[action] = result.error;
    else bindings[action] = result.binding;
  }
  const actions = Object.keys(bindings);
  for (let i = 0; i < actions.length; i += 1) {
    for (const other of actions.slice(i + 1)) {
      const action = actions[i];
      const binding = bindings[action];
      // Escape first leaves focus mode, then restarts on the next press, as before.
      if (!binding || (binding === 'Escape' && bindings[other] === 'Escape' && action === 'restart' && other === 'exitFocus')) continue;
      if (variants(binding).some((value) => variants(bindings[other]).includes(value))) {
        errors[action] = `Already used by ${KEYBINDING_LABELS[other]}.`;
        errors[other] = `Already used by ${KEYBINDING_LABELS[action]}.`;
      }
    }
  }
  return { bindings, errors };
}

export function normalizeKeybindings(value, legacyRestart) {
  const values = { ...DEFAULT_KEYBINDINGS };
  for (const action of Object.keys(values)) {
    if (value && Object.hasOwn(value, action)) {
      const result = parseBinding(value[action], action);
      if (!result.error) values[action] = result.binding;
    }
  }
  if (!value && ['Escape', 'Tab', 'Enter'].includes(legacyRestart)) values.restart = legacyRestart;
  return Object.keys(validateKeybindings(values).errors).length ? { ...DEFAULT_KEYBINDINGS } : values;
}

export function matchesBinding(event, binding, { allowAccentComposition = false } = {}) {
  const composing = event.isComposing || event.keyCode === 229;
  if (!binding || (composing && !allowAccentComposition) || event.getModifierState?.('AltGraph')) return false;
  return variants(binding).some((value) => {
    const parts = value.split('+');
    const key = parts.pop();
    return event.key?.toUpperCase() === key.toUpperCase()
      && Boolean(event.ctrlKey) === parts.includes('Ctrl') && Boolean(event.metaKey) === parts.includes('Meta')
      && Boolean(event.altKey) === parts.includes('Alt') && Boolean(event.shiftKey) === parts.includes('Shift');
  });
}

export function bindingLabel(binding) {
  return binding ? binding.replace('Escape', 'esc').replace('Tab', 'tab').replace('Enter', 'enter').toLowerCase() : 'none';
}

export function ariaShortcuts(binding) {
  return binding ? variants(binding).map((value) => value.replace('Ctrl+', 'Control+')).join(' ') : '';
}

export function createKeybindingEditor({ form, status, getBindings, onSave }) {
  const actions = Object.keys(DEFAULT_KEYBINDINGS);
  let recording = null;
  let renderedBindings = null;
  let dirty = false;
  const input = (action) => form.querySelector(`[name="${action}"]`);
  const feedback = (message) => { status.textContent = message; };
  function stopRecording() {
    recording = null;
    form.querySelectorAll('[data-record]').forEach((button) => button.setAttribute('aria-pressed', 'false'));
  }
  function refresh({ force = false } = {}) {
    const signature = JSON.stringify(getBindings());
    if (!force && (dirty || signature === renderedBindings)) return;
    dirty = false;
    renderedBindings = signature;
    stopRecording();
    for (const action of actions) {
      input(action).value = getBindings()[action];
      input(action).removeAttribute('aria-invalid');
      form.querySelector(`#keybinding-${action}-error`).textContent = '';
    }
    feedback('');
  }
  form.addEventListener('input', () => { dirty = true; });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    stopRecording();
    const result = validateKeybindings(Object.fromEntries(actions.map((action) => [action, input(action).value])));
    for (const action of actions) {
      input(action).setAttribute('aria-invalid', String(Boolean(result.errors[action])));
      form.querySelector(`#keybinding-${action}-error`).textContent = result.errors[action] || '';
    }
    const invalid = actions.find((action) => result.errors[action]);
    if (invalid) { feedback('Bindings were not saved. Fix the marked combinations.'); input(invalid).focus(); return; }
    dirty = false;
    onSave(result.bindings);
    refresh();
    feedback('Keybindings saved.');
  });
  form.querySelector('[data-reset-bindings]').addEventListener('click', () => {
    onSave({ ...DEFAULT_KEYBINDINGS });
    refresh({ force: true });
    feedback('Default keybindings restored.');
  });
  form.querySelectorAll('[data-record]').forEach((button) => button.addEventListener('click', () => {
    const action = button.dataset.record;
    const wasRecording = recording === action;
    stopRecording();
    if (wasRecording) { feedback('Recording cancelled.'); return; }
    recording = action;
    button.setAttribute('aria-pressed', 'true');
    feedback('Press a combination. Escape cancels; Tab moves focus. Enter Escape or Tab in the field to bind them.');
  }));
  form.addEventListener('keydown', (event) => {
    if (!recording || event.isComposing || event.keyCode === 229) return;
    if (event.key === 'Tab') { stopRecording(); feedback('Recording cancelled.'); return; }
    event.preventDefault();
    event.stopPropagation();
    if (event.key === 'Escape') { stopRecording(); feedback('Recording cancelled.'); return; }
    if (event.repeat || ['Control', 'Meta', 'Alt', 'Shift', 'AltGraph'].includes(event.key)) return;
    const action = recording;
    const value = [event.ctrlKey && 'Ctrl', event.metaKey && 'Meta', event.altKey && 'Alt', event.shiftKey && 'Shift', event.key].filter(Boolean).join('+');
    const result = parseBinding(value, action);
    if (result.error) { feedback(result.error); return; }
    input(action).value = result.binding;
    dirty = true;
    stopRecording();
    input(action).focus();
    feedback('Combination recorded. Save to apply it.');
  });
  form.addEventListener('focusout', (event) => { if (event.target.matches('[data-record]')) stopRecording(); });
  return { refresh, stopRecording, isRecording: () => recording !== null };
}
