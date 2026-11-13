import { Fragment, useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import { flushSync } from 'react-dom';
import { LENGTHS, isPresetLength, parseCustomLength } from './lengths.js';
import { createStore } from './store.js';
import type { LearningStore } from './learning-store.js';
import type { PracticeSession } from './practice-session.js';
import type { ProfileSync } from './profile-sync.js';

type LengthMode = 'time' | 'words';

interface LengthView { open: boolean; mode: LengthMode; text: string; offered: string; invalid: boolean; error: string; revision: number }

interface LengthHost { input: HTMLInputElement; form: HTMLFormElement; pill: HTMLButtonElement; controls: HTMLElement }

interface LengthPorts { reset(focus?: boolean): void; controls(): void; glide(): void; focusPractice(): void }

export function createCustomLength(learning: LearningStore, practice: PracticeSession, sync: ProfileSync) {
  const view = createStore<LengthView>({ open: false, mode: 'time', text: '', offered: '', invalid: false, error: '', revision: 0 });
  let host: LengthHost | null = null;
  let ports: LengthPorts | null = null;
  let dropped = false;
  const publish = (next: LengthView) => flushSync(() => view.publish(next));

  function error(message: string) {
    const current = view.getSnapshot();

    if (message || current.error) publish({ ...current, error: message, revision: current.revision + 1 });
  }

  function close({ focus = false } = {}) {
    if (!view.getSnapshot().open) return;
    publish({ ...view.getSnapshot(), open: false, invalid: false });
    ports?.glide();

    if (focus) {
      if (learning.preferences.focusMode) ports?.focusPractice();
      else host?.pill.focus({ preventScroll: true });
    }
  }

  function commit({ leaving = false } = {}) {
    const current = view.getSnapshot();
    const { mode } = current;
    const spec = LENGTHS[mode];
    const raw = current.text.trim();

    if (leaving && (!raw || raw === current.offered)) { close();

 return; }

    const result = parseCustomLength(mode, raw);

    if (!result.ok) {
      if (leaving) close();
      else { publish({ ...view.getSnapshot(), invalid: true }); host?.input.select(); }

      error(result.message);

      return;
    }

    close();
    const chosen = ['mode', spec.key, ...(!isPresetLength(mode, result.value) ? [spec.customKey] : [])];

    if (learning.preferences.mode === mode && learning.preferences[spec.key] === result.value) {
      sync.saveChoice(...chosen);

      if (!leaving) ports?.focusPractice();

      return;
    }

    learning.preferences.mode = mode;
    learning.preferences[spec.key] = result.value;

    if (!isPresetLength(mode, result.value)) learning.preferences[spec.customKey] = result.value;
    ports?.controls();
    sync.saveChoice(...chosen);
    ports?.reset(!leaving);
  }

  return {
    view, error, close, commit,
    configure(next: LengthPorts) { ports = next; },
    attach(next: LengthHost) { host = next;

 return () => { if (host === next) host = null; }; },
    open(selected?: LengthMode) {
      const mode = selected ?? learning.preferences.mode;

      if (mode !== 'time' && mode !== 'words') return;

      if (practice.attempt?.status === 'running') ports?.reset();
      const spec = LENGTHS[mode];
      const text = learning.preferences[spec.customKey] ? String(learning.preferences[spec.customKey]) : '';
      dropped = false;
      publish({ ...view.getSnapshot(), open: true, mode, text, offered: text, invalid: false, error: '' });
      ports?.glide();
      host?.input.focus({ preventScroll: true });
      host?.input.select();
    },
    refresh() {
      error('');

      if (view.getSnapshot().mode !== learning.preferences.mode) close();
    },
    edit(text: string) { publish({ ...view.getSnapshot(), text }); },
    pointer(target: EventTarget | null) { if (view.getSnapshot().open && target instanceof Node && !host?.form.contains(target)) dropped = true; },
    cancelPointer() { dropped = false; },
    blur(target: EventTarget | null) {
      if (!view.getSnapshot().open || (target instanceof Node && host?.form.contains(target)) || !document.hasFocus()) return;
      const stranded = learning.preferences.focusMode && (!target || (target instanceof Node && host?.controls.contains(target)));

      if (dropped) { dropped = false; close(); }
      else commit({ leaving: true });

      if (stranded) ports?.focusPractice();
    },
  };
}

export type CustomLengthController = ReturnType<typeof createCustomLength>;

export function CustomLengthField({ controller, mode, current }: { controller: CustomLengthController; mode: LengthMode; current: number }) {
  const view = useSyncExternalStore(controller.view.subscribe, controller.view.getSnapshot, controller.view.getSnapshot);
  const pill = useRef<HTMLButtonElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const spec = LENGTHS[mode];
  const editing = LENGTHS[view.mode];
  const custom = !isPresetLength(mode, current);

  useLayoutEffect(() => {
    const controls = form.current?.closest<HTMLElement>('.practice-controls');

    if (controls && input.current && form.current && pill.current) return controller.attach({ controls, input: input.current, form: form.current, pill: pill.current });
  }, [controller]);

  return <><button ref={pill} id="custom-length" type="button" className={custom ? 'is-active' : ''} aria-pressed={custom} aria-label={custom ? `custom ${spec.noun}, ${current} ${spec.unit}` : `custom ${spec.noun}`} hidden={view.open} onClick={() => controller.open()}>{custom ? current : 'custom'}</button>
    <form ref={form} id="custom-length-form" className="custom-length" noValidate hidden={!view.open} data-length-mode={view.mode} onSubmit={(event) => { event.preventDefault(); controller.commit(); }} onBlur={(event) => controller.blur(event.relatedTarget)}>
      <input ref={input} id="custom-length-input" className="custom-length-input" type="text" inputMode="numeric" enterKeyHint="done" maxLength={12} autoComplete="off" spellCheck={false} placeholder={`${editing.min}–${editing.max}`} aria-label={`${view.mode === 'time' ? 'custom time in seconds' : 'custom number of words'}, ${editing.min} to ${editing.max}`} aria-describedby="custom-length-error" aria-invalid={view.invalid} data-offered={view.offered} value={view.text} onChange={(event) => controller.edit(event.currentTarget.value)} onKeyDown={(event) => { if (event.key !== 'Escape') return; event.preventDefault(); event.stopPropagation(); controller.error(''); controller.close({ focus: true }); }} />
    </form></>;
}

export function CustomLengthError({ controller }: { controller: CustomLengthController }) {
  const view = useSyncExternalStore(controller.view.subscribe, controller.view.getSnapshot, controller.view.getSnapshot);

  return <p id="custom-length-error" className="field-error custom-length-error" role="alert"><Fragment key={view.revision}>{view.error}</Fragment></p>;
}
