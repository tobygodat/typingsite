import { useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import { flushSync } from 'react-dom';
import { DEFAULT_KEYBINDINGS, KEYBINDING_ACTIONS, KEYBINDING_LABELS, parseBinding, validateKeybindings } from './keybindings.js';
import type { BindingErrors, KeybindingAction, Keybindings } from './keybindings.js';
import { createStore } from './store.js';

interface EditorView {
  values: Keybindings;
  errors: BindingErrors;
  recording: KeybindingAction | null;
  feedback: string;
}

export function createKeybindingEditor() {
  let getBindings = (): Keybindings => ({ ...DEFAULT_KEYBINDINGS });
  let onSave = (_next: Keybindings) => { void _next; };
  let renderedBindings: string | null = null;
  let focus: ((action: KeybindingAction) => void) | null = null;
  const edited = new Set<KeybindingAction>();
  const view = createStore<EditorView>({ values: { ...DEFAULT_KEYBINDINGS }, errors: {}, recording: null, feedback: '' });

  function update(patch: Partial<EditorView>) {
    flushSync(() => view.publish({ ...view.getSnapshot(), ...patch }));
  }

  function stopRecording() { update({ recording: null }); }

  function refresh({ force = false } = {}) {
    const bindings = getBindings();
    const signature = JSON.stringify(bindings);

    if (!force && signature === renderedBindings) return;

    if (force) { edited.clear(); stopRecording(); }

    renderedBindings = signature;
    const current = view.getSnapshot();
    const values = { ...current.values };
    const errors = { ...current.errors };

    for (const action of KEYBINDING_ACTIONS) if (!edited.has(action)) { values[action] = bindings[action]; delete errors[action]; }

    update({ values, errors, feedback: !edited.size && !current.recording ? '' : current.feedback });
  }

  function apply({ reselect = false } = {}) {
    const result = validateKeybindings(view.getSnapshot().values);
    const valid = KEYBINDING_ACTIONS.filter((action) => !result.errors[action]);
    const next = { ...getBindings() };

    for (const action of valid) {
      const value = result.bindings[action];

      if (value !== undefined) next[action] = value;
    }

    update({ errors: result.errors });

    if (!Object.keys(validateKeybindings(next).errors).length) {
      for (const action of valid) edited.delete(action);

      if (reselect || JSON.stringify(next) !== JSON.stringify(getBindings())) onSave(next);
      refresh();
    }

    update({ feedback: valid.length === KEYBINDING_ACTIONS.length ? '' : 'Fix the marked combinations.' });
  }

  return {
    view, refresh, stopRecording,
    isRecording: () => view.getSnapshot().recording !== null,
    configure(options: { getBindings(): Keybindings; onSave(bindings: Keybindings): void }) { getBindings = options.getBindings; onSave = options.onSave; },
    attach(callback: (action: KeybindingAction) => void) { focus = callback;

 return () => { if (focus === callback) focus = null; }; },
    edit(action: KeybindingAction, value: string) { edited.add(action); update({ values: { ...view.getSnapshot().values, [action]: value } }); },
    changed(action: KeybindingAction) { if (edited.has(action)) apply(); },
    reset() { onSave({ ...DEFAULT_KEYBINDINGS }); refresh({ force: true }); update({ feedback: 'Default keybindings restored.' }); },
    record(action: KeybindingAction) {
      const wasRecording = view.getSnapshot().recording === action;
      stopRecording();
      update(wasRecording ? { feedback: 'Recording cancelled.' } : { recording: action, feedback: 'Press a combination. Escape cancels; Tab moves focus. Enter Escape or Tab in the field to bind them.' });
    },
    keydown(event: KeyboardEvent, inInput: boolean) {
      const recording = view.getSnapshot().recording;

      if (!recording && event.key === 'Enter' && inInput) { event.preventDefault(); apply({ reselect: true });

 return; }

      if (!recording || event.isComposing || event.keyCode === 229) return;

      if (event.key === 'Tab') { stopRecording(); update({ feedback: 'Recording cancelled.' });

 return; }

      event.preventDefault();
      event.stopPropagation();

      if (event.key === 'Escape') { stopRecording(); update({ feedback: 'Recording cancelled.' });

 return; }

      if (event.repeat || ['Control', 'Meta', 'Alt', 'Shift', 'AltGraph'].includes(event.key)) return;
      const value = [event.ctrlKey && 'Ctrl', event.metaKey && 'Meta', event.altKey && 'Alt', event.shiftKey && 'Shift', event.key].filter(Boolean).join('+');
      const result = parseBinding(value, recording);

      if (result.error !== undefined) { update({ feedback: result.error });

 return; }

      update({ values: { ...view.getSnapshot().values, [recording]: result.binding } });
      edited.add(recording);
      stopRecording();
      focus?.(recording);
      apply({ reselect: true });
    },
  };
}

export type KeybindingEditorController = ReturnType<typeof createKeybindingEditor>;

export function KeybindingEditor({ editor }: { editor: KeybindingEditorController }) {
  const view = useSyncExternalStore(editor.view.subscribe, editor.view.getSnapshot, editor.view.getSnapshot);
  const inputs = useRef<Partial<Record<KeybindingAction, HTMLInputElement>>>({});
  useLayoutEffect(() => editor.attach((action) => inputs.current[action]?.focus()), [editor]);

  return <form id="keybindings-form" onKeyDown={(event) => editor.keydown(event.nativeEvent, event.target instanceof HTMLInputElement)}>
    {KEYBINDING_ACTIONS.map((action) => <div key={action} className="keybinding-row">
      <label htmlFor={`keybinding-${action}`}>{KEYBINDING_LABELS[action]}</label>
      <div className="keybinding-controls">
        <input ref={(node) => { if (node) inputs.current[action] = node; else delete inputs.current[action]; }} className="input" id={`keybinding-${action}`} name={action} type="text" spellCheck={false} autoComplete="off" autoCapitalize="off" aria-describedby={`keybindings-help keybinding-${action}-error`} aria-invalid={Boolean(view.errors[action])} value={view.values[action]} onChange={(event) => editor.edit(action, event.currentTarget.value)} onBlur={() => editor.changed(action)} />
        <button className="btn btn-secondary btn-sm" type="button" data-record={action} aria-label={`Record ${KEYBINDING_LABELS[action]} binding`} aria-pressed={view.recording === action} onClick={() => editor.record(action)} onBlur={() => editor.stopRecording()}>Record</button>
      </div>
      <p className="keybinding-error" id={`keybinding-${action}-error`}>{view.errors[action]}</p>
    </div>)}
    <div className="keybinding-actions"><button className="btn btn-ghost btn-sm" type="button" data-reset-bindings="" onClick={() => editor.reset()}>Reset defaults</button></div>
    <p id="keybindings-status" role="status" aria-live="polite">{view.feedback}</p>
  </form>;
}
