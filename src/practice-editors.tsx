import { useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import { flushSync } from 'react-dom';
import { createStore } from './store.js';
import { CUSTOM_MAX, CUSTOM_MIN_CHARS, CUSTOM_MIN_WORDS, customTextProblem, normalizeCustomText, normalizeManualTarget } from './typing.js';
import { CUSTOM_ORDERS } from './profile.js';
import type { LearningStore } from './learning-store.js';
import type { ProfileSync } from './profile-sync.js';

interface EditorPorts {
  beforeCustom(): void;
  changed(): void;
  useCustom(): void;
  drill(recommendation: { kind: 'manual'; target: string; title: string }): void;
}

interface EditorView { open: boolean; text: string; order: string; error: string; disabled: boolean; manual: boolean; target: string; targetInvalid: boolean }

export function customErrorMessage(problem: ReturnType<typeof customTextProblem>) {
  if (!problem) return '';

  if (problem.kind === 'empty') return 'Add some text first.';

  if (problem.kind === 'short') return `Use at least ${CUSTOM_MIN_WORDS} words and ${CUSTOM_MIN_CHARS} characters, so the run is long enough to time.`;

  if (problem.kind === 'untypable') {
    const point = problem.char.codePointAt(0);

    if (point === undefined) throw new Error('Missing unsupported character');

    return `“${problem.char}” (U+${point.toString(16).toUpperCase().padStart(4, '0')}) can’t be typed here. Custom text uses the letters, digits, spaces and punctuation of an English keyboard.`;
  }

  return `Keep it to ${CUSTOM_MAX.toLocaleString('en')} characters, about ten minutes of typing. This text has ${problem.length.toLocaleString('en')}.`;
}

export function createPracticeEditors(learning: LearningStore, sync: ProfileSync) {
  const view = createStore<EditorView>({ open: false, text: '', order: 'as-written', error: '', disabled: true, manual: false, target: '', targetInvalid: false });
  let ports: EditorPorts | null = null;
  let customInput: HTMLTextAreaElement | null = null;
  let targetInput: HTMLInputElement | null = null;
  const publish = (next: EditorView) => flushSync(() => view.publish(next));

  function edit(text: string) {
    const problem = customTextProblem(normalizeCustomText(text, Infinity));
    publish({ ...view.getSnapshot(), text, disabled: problem?.kind === 'empty' || problem?.kind === 'short', error: problem?.kind === 'short' ? customErrorMessage(problem) : '' });
  }

  return {
    view, edit,
    configure(next: EditorPorts) { ports = next; },
    attachCustom(input: HTMLTextAreaElement) { customInput = input;

 return () => { if (customInput === input) customInput = null; }; },
    attachTarget(input: HTMLInputElement) { targetInput = input;

 return () => { if (targetInput === input) targetInput = null; }; },
    get customOpen() { return view.getSnapshot().open; },
    set customOpen(open: boolean) { publish({ ...view.getSnapshot(), open }); },
    order(order: string) { publish({ ...view.getSnapshot(), order }); },
    open(open = true) {
      ports?.beforeCustom();
      publish({ ...view.getSnapshot(), open });

      if (open) {
        edit(view.getSnapshot().text || learning.preferences.customText || '');
        publish({ ...view.getSnapshot(), order: learning.preferences.customOrder });
      }

      ports?.changed();

      if (open) customInput?.focus();
    },
    use() {
      const current = view.getSnapshot();
      const text = normalizeCustomText(current.text, Infinity);
      const error = customErrorMessage(customTextProblem(text));
      publish({ ...current, error });

      if (error) { customInput?.focus();

 return; }

      learning.preferences.customText = text;
      learning.preferences.customOrder = CUSTOM_ORDERS.includes(current.order) ? current.order : 'as-written';
      sync.saveChoice('customText', 'customOrder');
      publish({ ...view.getSnapshot(), open: false });
      ports?.useCustom();
    },
    manual(open: boolean) {
      publish({ ...view.getSnapshot(), manual: open });

      if (open) targetInput?.focus();
    },
    toggleManual() { this.manual(!view.getSnapshot().manual); },
    target(target: string) { publish({ ...view.getSnapshot(), target }); },
    submitTarget() {
      const raw = view.getSnapshot().target.trim();
      const valid = /^[a-z]{1,8}$/i.test(raw);
      publish({ ...view.getSnapshot(), targetInvalid: !valid });

      if (!valid) return;
      const target = normalizeManualTarget(raw);
      ports?.drill({ kind: 'manual', target, title: `Practice “${target}”` });
    },
  };
}

export type PracticeEditorsController = ReturnType<typeof createPracticeEditors>;

export function CustomTextEditor({ controller }: { controller: PracticeEditorsController }) {
  const view = useSyncExternalStore(controller.view.subscribe, controller.view.getSnapshot, controller.view.getSnapshot);
  const input = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => { if (input.current) return controller.attachCustom(input.current); }, [controller]);

  return <div id="custom-options" className="custom-options" role="group" aria-label="Custom text" hidden={!view.open}>
    <label htmlFor="custom-text" className="custom-label">your text<span id="custom-count" className="custom-count">{view.text.length.toLocaleString('en')} / {CUSTOM_MAX.toLocaleString('en')}</span></label>
    <textarea ref={input} id="custom-text" className="input custom-textarea" rows={4} spellCheck={false} placeholder="Paste or type any passage" aria-describedby="custom-count custom-error" value={view.text} aria-invalid={Boolean(view.error)} onChange={(event) => controller.edit(event.currentTarget.value)}></textarea>
    <div className="custom-actions"><label htmlFor="custom-order">order<select id="custom-order" className="input select" value={view.order} onChange={(event) => controller.order(event.currentTarget.value)}><option value="as-written">as written</option><option value="shuffled">shuffled words</option><option value="random">random words</option></select></label><button id="custom-use" className="btn btn-primary btn-sm" type="button" disabled={view.disabled} onClick={() => controller.use()}>Use this text</button></div>
    <p id="custom-error" className="field-error" role="alert">{view.error}</p>
  </div>;
}

export function ManualTargetEditor({ controller }: { controller: PracticeEditorsController }) {
  const view = useSyncExternalStore(controller.view.subscribe, controller.view.getSnapshot, controller.view.getSnapshot);
  const input = useRef<HTMLInputElement>(null);

  useLayoutEffect(() => { if (input.current) return controller.attachTarget(input.current); }, [controller]);

  return <form id="manual-target" className="custom-options manual-target" noValidate hidden={!view.manual} onSubmit={(event) => { event.preventDefault(); controller.submitTarget(); }}>
    <label htmlFor="manual-target-input" className="sr-only">Letters to drill</label><div className="input-action"><input ref={input} id="manual-target-input" className="input" type="text" maxLength={16} placeholder="letters, e.g. br" aria-describedby="manual-target-error" aria-invalid={view.targetInvalid} value={view.target} onChange={(event) => controller.target(event.currentTarget.value)} /><button id="apply-manual-target" className="btn btn-secondary" type="submit">Drill it</button></div>
    <p id="manual-target-error" className="field-error" role="alert">{view.targetInvalid ? 'Use 1–8 letters, no spaces or punctuation.' : ''}</p>
  </form>;
}
