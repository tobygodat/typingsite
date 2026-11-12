import { flushSync } from 'react-dom';
import * as account from './account.js';
import type { Session } from './network.js';
import { replaceAccountLifetime, WorkCancelled } from './async-runtime.js';
import { createStore } from './store.js';

export type SyncState = 'guest' | 'syncing' | 'synced' | 'offline' | 'expired';

export const SYNC_COPY: Record<SyncState, string> = { guest: 'Guest · nothing is saved', syncing: 'Syncing…', synced: 'Saved to your account', offline: 'Saved here · syncs when online', expired: 'Session ended · sign in to sync' };

export type AccountMode = 'create' | 'signin';

interface AccountView { email: string; signedIn: boolean; sync: SyncState; googleBusy: boolean }

interface AuthView { mode: AccountMode; busy: boolean; error: string; confirm: string | null }

interface AccountHost { open(): void; close(): void; focusEmail(): void; focusDone(): void; closeMenu(): void; dialogOpen(): boolean }

interface AccountCallbacks { beforeOpen(): void; enter(session: Session): Promise<void>; signOut(): void; exportData(): void; deleteAccount(): void; toast(message: string): void }

const identityOf = (session: Session | null) => session ? `${session.user.id}:${session.signInId || ''}` : null;

export function createAccountSession() {
  let session = account.loadSession();
  let activeIdentity: string | null | undefined;
  let identityEpoch = 0;
  let disposed = false;
  let host: AccountHost | null = null;
  let callbacks: AccountCallbacks | null = null;
  let feedbackTimer = 0;
  const feedback = createStore({ message: '', tone: 'problem', visible: false });
  const view = createStore<AccountView>({ email: '', signedIn: false, sync: 'guest', googleBusy: false });
  const auth = createStore<AuthView>({ mode: 'create', busy: false, error: '', confirm: null });
  const publish = (next: AuthView) => { if (!disposed) flushSync(() => auth.publish(next)); };

  async function replaceIdentity(value: Session | null) {
    const next = identityOf(value);

    if (activeIdentity === next) return;
    activeIdentity = next;
    identityEpoch += 1;
    await replaceAccountLifetime(next);
  }

  async function fresh() {
    const epoch = identityEpoch;
    const result = await account.freshSession(session);

    if (disposed || epoch !== identityEpoch) throw new WorkCancelled('Account changed.');
    await replaceIdentity(result);

    if (disposed || activeIdentity !== identityOf(result)) throw new WorkCancelled('Account changed.');

    return result;
  }

  function open(mode: AccountMode) {
    callbacks?.beforeOpen();
    host?.closeMenu();
    publish({ ...auth.getSnapshot(), mode, error: '', confirm: null });
    host?.open();
    host?.focusEmail();
  }

  return {
    view, auth, feedback, replaceIdentity, fresh, open,
    notify(message: string, tone = 'problem') {
      flushSync(() => feedback.publish({ message, tone, visible: true }));
      clearTimeout(feedbackTimer);
      feedbackTimer = window.setTimeout(() => { if (!disposed) flushSync(() => feedback.publish({ ...feedback.getSnapshot(), visible: false })); }, 5000);
    },
    get session() { return session; },
    set session(next: Session | null) { session = next; },
    configure(next: AccountCallbacks) { callbacks = next; },
    attach(next: AccountHost) { host = next;

 return () => { if (host === next) host = null; }; },
    render() { flushSync(() => view.publish({ ...view.getSnapshot(), signedIn: Boolean(session), email: session?.user.email ?? '', sync: session ? 'syncing' : 'guest' })); },
    sync(sync: SyncState) { flushSync(() => view.publish({ ...view.getSnapshot(), sync })); },
    closeMenu() { host?.closeMenu(); },
    close() { host?.close(); },
    switchMode() { open(auth.getSnapshot().mode === 'create' ? 'signin' : 'create'); },
    signOut() { callbacks?.signOut(); },
    exportData() { callbacks?.exportData(); },
    deleteAccount() { callbacks?.deleteAccount(); },
    async submit(email: string, password: string) {
      email = email.trim();

      if (!email || !password) { publish({ ...auth.getSnapshot(), error: 'Enter an email and a password.' });

 return; }

      publish({ ...auth.getSnapshot(), busy: true, error: '' });

      try {
        if (auth.getSnapshot().mode === 'create') {
          const result = await account.signUp(email, password, `${location.origin}/`);

          if (disposed) return;

          if ('confirm' in result) {
            publish({ ...auth.getSnapshot(), confirm: email });
            host?.focusDone();

            return;
          }

          await callbacks?.enter(result.session);
        } else {
          const signedIn = await account.signIn(email, password);

          if (!disposed) await callbacks?.enter(signedIn);
        }
      } catch (error) { publish({ ...auth.getSnapshot(), error: error instanceof Error ? error.message : String(error) }); }
      finally { publish({ ...auth.getSnapshot(), busy: false }); }
    },
    async google() {
      host?.closeMenu();
      flushSync(() => view.publish({ ...view.getSnapshot(), googleBusy: true }));

      try { await account.startGoogleSignIn(`${location.origin}/`); }
      catch (error) {
        if (disposed) return;
        flushSync(() => view.publish({ ...view.getSnapshot(), googleBusy: false }));
        const message = error instanceof Error ? error.message : String(error);

        if (host?.dialogOpen()) publish({ ...auth.getSnapshot(), error: message });
        else callbacks?.toast(message);
      }
    },
    dispose() { disposed = true; identityEpoch += 1; clearTimeout(feedbackTimer); },
  };
}

export type AccountSession = ReturnType<typeof createAccountSession>;
