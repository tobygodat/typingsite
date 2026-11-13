import { useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import { flushSync } from 'react-dom';
import * as account from './account.js';
import type { Session } from './network.js';
import type { AccountSession } from './account-session.js';
import { createStore } from './store.js';

interface DeletionPorts { dismissFilters(): void; beforeOpen(): void; confirmed(session: Session): void }

interface DeletionHost { open(): void; close(): void; focus(): void }

export function createAccountDeletion(accounts: AccountSession) {
  const view = createStore({ value: '', pending: false, error: '', attempted: false });
  let ports: DeletionPorts | null = null;
  let host: DeletionHost | null = null;
  let disposed = false;
  const publish = (next: ReturnType<typeof view.getSnapshot>) => { if (!disposed) flushSync(() => view.publish(next)); };

  return {
    view,
    configure(next: DeletionPorts) { ports = next; },
    attach(next: DeletionHost) { host = next;

 return () => { if (host === next) host = null; }; },
    open() {
      ports?.dismissFilters();

      if (!accounts.session) return;
      ports?.beforeOpen();
      publish({ value: '', pending: false, error: '', attempted: view.getSnapshot().attempted });
      host?.open();
      host?.focus();
    },
    edit(value: string) { if (!view.getSnapshot().pending) publish({ ...view.getSnapshot(), value }); },
    close() { if (!view.getSnapshot().pending) host?.close(); },
    async confirm() {
      const session = accounts.session;
      const current = view.getSnapshot();

      if (!session || current.pending || current.value !== 'delete') return;
      host?.focus();
      publish({ ...current, pending: true, error: '', attempted: true });

      try { await account.deleteAccount(session); }
      catch (error) {
        publish({ ...view.getSnapshot(), pending: false, error: error instanceof Error ? error.message : String(error) });

        if (!disposed) {
          if (!account.loadSession()) accounts.sync('expired');
          host?.focus();
        }

        return;
      }

      if (!disposed && accounts.session) ports?.confirmed(accounts.session);
    },
    dispose() { disposed = true; },
  };
}

export type AccountDeletion = ReturnType<typeof createAccountDeletion>;

export function DeleteAccountDialog({ controller }: { controller: AccountDeletion }) {
  const view = useSyncExternalStore(controller.view.subscribe, controller.view.getSnapshot, controller.view.getSnapshot);
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => controller.attach({ open() { dialog.current?.showModal(); }, close() { dialog.current?.close(); }, focus() { input.current?.focus(); } }), [controller]);

  return <dialog ref={dialog} id="delete-account-dialog" aria-labelledby="delete-account-title" aria-describedby="delete-account-copy" onCancel={(event) => { if (view.pending) event.preventDefault(); }}><form id="delete-account-form" className="dialog-content" noValidate aria-busy={view.attempted ? view.pending : undefined} onSubmit={(event) => { event.preventDefault(); void controller.confirm(); }}><div><h2 id="delete-account-title">Delete your account?</h2><p id="delete-account-copy">This deletes your account for good, with everything saved to it: settings, runs and progress, daily results, your friend list and your online races. You can’t undo it.</p></div><div className="account-fields"><label htmlFor="confirm-delete-input"><span>Type <strong>delete</strong> to confirm</span><input ref={input} id="confirm-delete-input" className="input" type="text" autoComplete="off" spellCheck={false} autoCapitalize="off" aria-describedby="delete-account-error" value={view.value} readOnly={view.pending} onChange={(event) => controller.edit(event.currentTarget.value)} /></label><p id="delete-account-error" className="field-error" role="alert">{view.error}</p><p id="delete-account-status" className="sr-only" role="status">{view.pending ? 'Deleting your account…' : ''}</p></div><div className="dialog-actions"><button id="cancel-delete-account" className="btn btn-ghost" type="button" disabled={view.pending} onClick={() => controller.close()}>Cancel</button><button id="confirm-delete-account" className="btn btn-danger" type="submit" disabled={view.pending || view.value !== 'delete'}>{view.pending ? 'Deleting…' : 'Delete account'}</button></div></form></dialog>;
}
