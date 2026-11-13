import { useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import { flushSync } from 'react-dom';
import * as account from './account.js';
import { createStore } from './store.js';

interface SuggestionPorts { beforeOpen(): void; screen(): string }

interface SuggestionHost { open(): void; close(): void; focus(): void }

export function createSuggestion() {
  const view = createStore({ text: '', error: '', pending: false, disabled: true, toast: false });
  let ports: SuggestionPorts | null = null;
  let host: SuggestionHost | null = null;
  let toastTimer = 0;
  let disposed = false;
  const publish = (next: ReturnType<typeof view.getSnapshot>) => { if (!disposed) flushSync(() => view.publish(next)); };

  return {
    view,
    configure(next: SuggestionPorts) { ports = next; },
    attach(next: SuggestionHost) { host = next;

 return () => { if (host === next) host = null; }; },
    open() {
      ports?.beforeOpen();
      const current = view.getSnapshot();
      publish({ ...current, error: '', disabled: !current.text.trim() });
      host?.open(); host?.focus();
    },
    close() { host?.close(); },
    edit(text: string) { publish({ ...view.getSnapshot(), text, disabled: !text.trim() }); },
    async send(website: string) {
      const text = view.getSnapshot().text;
      const screen = ports?.screen() ?? '';
      const invalid = account.suggestionRow(text, screen).error;

      if (invalid) { publish({ ...view.getSnapshot(), error: invalid });

 return; }

      publish({ ...view.getSnapshot(), pending: true, disabled: true, error: '' });

      try {
        if (!website) await account.sendSuggestion(text, screen);

        if (disposed) return;
        publish({ ...view.getSnapshot(), text: '', toast: true });
        host?.close();
        clearTimeout(toastTimer);
        toastTimer = window.setTimeout(() => publish({ ...view.getSnapshot(), toast: false }), 4000);
      } catch (error) {
        const status = error instanceof Error && 'status' in error && Boolean(error.status);
        publish({ ...view.getSnapshot(), error: status ? 'The suggestion couldn’t be saved. Your text is still here; try again later.' : 'Can’t reach the server. Your text is still here; try again when you’re connected.' });
      } finally {
        const current = view.getSnapshot();
        publish({ ...current, pending: false, disabled: !current.text.trim() });
      }
    },
    dispose() { disposed = true; clearTimeout(toastTimer); },
  };
}

export type SuggestionController = ReturnType<typeof createSuggestion>;

export function SuggestionDialog({ controller }: { controller: SuggestionController }) {
  const view = useSyncExternalStore(controller.view.subscribe, controller.view.getSnapshot, controller.view.getSnapshot);
  const dialog = useRef<HTMLDialogElement>(null);
  const text = useRef<HTMLTextAreaElement>(null);
  const website = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => controller.attach({ open() { dialog.current?.showModal(); }, close() { dialog.current?.close(); }, focus() { text.current?.focus(); } }), [controller]);

  return <dialog ref={dialog} id="suggest-dialog" aria-labelledby="suggest-dialog-title" onClick={(event) => { if (event.target === event.currentTarget) controller.close(); }}><form id="suggest-form" className="dialog-content" noValidate onSubmit={(event) => { event.preventDefault(); void controller.send(website.current?.value ?? ''); }}><div><h2 id="suggest-dialog-title">Suggest a feature</h2><p>Only your words and the screen you sent them from are saved.</p></div><label htmlFor="suggest-text">Your suggestion<textarea ref={text} id="suggest-text" className="input textarea" rows={5} maxLength={account.MAX_SUGGESTION} aria-describedby="suggest-count suggest-error" value={view.text} onChange={(event) => controller.edit(event.currentTarget.value)}></textarea></label><div className="suggest-meta"><p id="suggest-error" className="field-error" role="alert">{view.error}</p><span id="suggest-count" className="suggest-count">{view.text.length} / {account.MAX_SUGGESTION}</span></div><div className="suggest-trap" aria-hidden="true"><label htmlFor="suggest-website">Leave this empty</label><input ref={website} id="suggest-website" type="text" tabIndex={-1} autoComplete="off" /></div><div className="dialog-actions"><button id="cancel-suggest" className="btn btn-ghost" type="button" onClick={() => controller.close()}>Cancel</button><button id="send-suggest" className="btn btn-primary" type="submit" disabled={view.disabled}>{view.pending ? 'Sending…' : 'Send suggestion'}</button></div></form></dialog>;
}

export function SuggestionToast({ controller }: { controller: SuggestionController }) {
  const view = useSyncExternalStore(controller.view.subscribe, controller.view.getSnapshot, controller.view.getSnapshot);

  return <div id="suggest-toast" className="toast" role="status" hidden={!view.toast}><span className="status-dot" aria-hidden="true"></span><span>Suggestion sent. Thank you.</span></div>;
}
