import { useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import { SYNC_COPY } from './account-session.js';
import type { AccountSession } from './account-session.js';

export function AccountMenu({ controller }: { controller: AccountSession }) {
  const view = useSyncExternalStore(controller.view.subscribe, controller.view.getSnapshot, controller.view.getSnapshot);

  return <details id="account" className="account" data-state={view.signedIn ? 'member' : 'guest'} data-sync={view.sync}><summary id="account-trigger" className="corner-trigger account-trigger" aria-label={view.signedIn ? `Account, signed in as ${view.email}` : 'Account, guest mode'}><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8.5" r="3.5" /><path d="M5 20c.9-3.5 3.6-5.5 7-5.5s6.1 2 7 5.5" /></svg></summary><div className="corner-popover"><div id="account-guest" className="account-section" hidden={view.signedIn}><p className="account-lede">Guest mode: nothing is kept once you leave.</p><div className="account-actions"><button id="account-create" className="btn btn-primary" type="button" onClick={() => controller.open('create')}>Create account</button><button id="account-google" className="btn btn-secondary" type="button" disabled={view.googleBusy} onClick={() => { void controller.google(); }}>Sign in with Google</button><button id="account-signin" className="btn btn-ghost btn-sm" type="button" onClick={() => controller.open('signin')}>Sign in with email</button></div></div><div id="account-member" className="account-section" hidden={!view.signedIn}><p id="account-email" className="account-email">{view.email}</p><p className="account-sync status" role="status"><span className="status-dot" aria-hidden="true"></span><span id="account-sync">{SYNC_COPY[view.sync]}</span></p><div className="account-actions account-member-actions"><button id="account-signout" className="btn btn-ghost btn-sm" type="button" onClick={() => controller.signOut()}>Sign out</button><button id="account-export" className="btn btn-ghost btn-sm" type="button" onClick={() => controller.exportData()}>Export my data</button><button id="account-delete" className="btn btn-ghost btn-sm danger-text" type="button" onClick={() => controller.deleteAccount()}>Delete my account</button></div></div></div></details>;
}

export function AccountDialog({ controller }: { controller: AccountSession }) {
  const view = useSyncExternalStore(controller.auth.subscribe, controller.auth.getSnapshot, controller.auth.getSnapshot);
  const dialog = useRef<HTMLDialogElement>(null);
  const email = useRef<HTMLInputElement>(null);
  const password = useRef<HTMLInputElement>(null);
  const done = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => controller.attach({
    open() { if (!dialog.current?.open) dialog.current?.showModal(); },
    close() { dialog.current?.close(); },
    focusEmail() { email.current?.focus(); },
    focusDone() { done.current?.focus(); },
    closeMenu() { const menu = document.querySelector<HTMLDetailsElement>('#account');

 if (menu) menu.open = false; },
    dialogOpen() { return Boolean(dialog.current?.open); },
  }), [controller]);
  const creating = view.mode === 'create';

  return <dialog ref={dialog} id="account-dialog" aria-labelledby="account-dialog-title"><form id="account-form" className="dialog-content" noValidate hidden={view.confirm !== null} onSubmit={(event) => { event.preventDefault(); void controller.submit(email.current?.value ?? '', password.current?.value ?? ''); }}><div><h2 id="account-dialog-title">{creating ? 'Create an account' : 'Sign in'}</h2><p id="account-dialog-copy" hidden={!creating}>{creating ? 'Keep your settings and runs on any device.' : ''}</p></div><button id="account-dialog-google" className="btn btn-secondary" type="button" onClick={() => { void controller.google(); }}>Sign in with Google</button><p className="account-or" aria-hidden="true"><span>or with email</span></p><div className="account-fields"><label htmlFor="account-email-input">Email<input ref={email} id="account-email-input" className="input" type="email" autoComplete="email" spellCheck={false} autoCapitalize="off" aria-describedby="account-error" /></label><label htmlFor="account-password">Password<input ref={password} id="account-password" className="input" type="password" autoComplete={creating ? 'new-password' : 'current-password'} aria-describedby="account-error" /></label><p id="account-error" className="field-error" role="alert">{view.error}</p></div><div className="dialog-actions account-dialog-actions"><button id="account-switch" className="btn btn-ghost btn-sm" type="button" onClick={() => controller.switchMode()}>{creating ? 'Sign in instead' : 'Create one instead'}</button><span className="account-dialog-end"><button id="account-cancel" className="btn btn-ghost" type="button" onClick={() => controller.close()}>Cancel</button><button id="account-submit" className="btn btn-primary" type="submit" disabled={view.busy}>{creating ? 'Create account' : 'Sign in'}</button></span></div></form><div id="account-confirm" className="dialog-content" hidden={view.confirm === null}><div><h2>Check your email.</h2><p>We sent a confirmation link to <strong id="account-confirm-email">{view.confirm}</strong>. Open it in this browser to finish signing in.</p></div><div className="dialog-actions"><button ref={done} id="account-confirm-done" className="btn btn-primary" type="button" onClick={() => controller.close()}>Done</button></div></div></dialog>;
}

export function AccountSaved({ controller }: { controller?: AccountSession }) {
  if (!controller) return <p id="settings-saved">Guest settings last for this tab.</p>;

  return <Saved controller={controller} />;
}

function Saved({ controller }: { controller: AccountSession }) {
  const view = useSyncExternalStore(controller.view.subscribe, controller.view.getSnapshot, controller.view.getSnapshot);

  return <p id="settings-saved">{!view.signedIn ? 'Guest settings last for this tab.' : view.sync === 'synced' ? 'Settings saved to your account.' : 'Settings saved here, waiting to sync.'}</p>;
}

export function AccountGuestNote({ controller }: { controller: AccountSession }) {
  const view = useSyncExternalStore(controller.view.subscribe, controller.view.getSnapshot, controller.view.getSnapshot);

  return <span id="guest-note" className="guest-note" hidden={view.signedIn}>guest · runs aren’t saved</span>;
}
