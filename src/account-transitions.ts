import * as account from './account.js';
import { pageLifetime } from './async-runtime.js';
import { isRecord } from './domain-values.js';
import { normalizeProfile } from './profile.js';
import type { AccountSession } from './account-session.js';
import type { ProfileSync } from './profile-sync.js';
import type { OnlineRaceController } from './online-race.js';
import type { InboxController } from './inbox.js';
import type { FriendsBoardController } from './friends-board.js';
import type { Session } from './network.js';

interface TransitionPorts { running(): boolean; reload(): void }

export function createAccountTransitions(accounts: AccountSession, sync: ProfileSync, onlineRace: OnlineRaceController,
  inbox: InboxController, friendsBoard: FriendsBoardController, ports: TransitionPorts) {
  function requireSession() {
    const session = accounts.session;

    if (!session) throw new Error('Account transition requires a signed-in session');

    return session;
  }

  async function enterAccount(newSession: Session) {
    await accounts.replaceIdentity(newSession);
    account.clearSignedOut(newSession.user.id);

    try {
      const cloud = await account.fetchCloudProfile(newSession);
      const cached = account.loadCachedProfile(newSession.user.id);

      if (isRecord(cloud?.data) && cloud.data.version === 2) {
        account.cacheProfile(newSession.user.id, isRecord(cached) && cached.version === 2
          ? account.mergeSynced(normalizeProfile(cached), normalizeProfile(cloud.data))
          : cloud.data);
      }
    } catch {}

    ports.reload();
  }

  async function signOutAccount() {
    accounts.closeMenu();
    const userId = requireSession().user.id;
    // What this ends is the account's sign-in on the device as it stands now. That may be newer than this
    // tab's: a guest tab may have signed in to the account since, with no sign-out between. Every tab of the
    // account then signs out, as tabs that share one sign-in do.
    const stored = account.loadSession();

    if (!sync.state.signedOutElsewhere && stored?.user.id === userId) accounts.session = stored;
    const ending = requireSession();

    // Another tab signed out, or in as someone else, before this sign-out (this tab has followed:
    // followSessionElsewhere), or signed out or in as anyone (the same account included) while it waits on
    // the network: this sign-out stops here, and the tab starts again as the device now is. Whatever the
    // device holds (another session included) stays.
    // Checked again after every wait; account.signOut checks the stored session once more.
    const overtaken = () => {
      const now = account.loadSession();

      if (!sync.state.signedOutElsewhere && (!now || account.sameSignIn(now, ending))) return false;

      // Followed: after hearing the cache removed, for a sign-out elsewhere that sent everything (finishFollow).
      if (sync.state.pendingSignOut === null) ports.reload();

      return true;
    };

    if (overtaken()) return;
    await onlineRace?.leave();

    if (overtaken()) return;
    inbox?.forget();
    friendsBoard?.signOut();
    // Every tab signed in here shares the device cache, and another tab's latest save may not have reached
    // the account yet (its push still waiting, or failing). So the cache is merged and pushed before it
    // goes; the push reads the row and writes only what the row lacks. A second round covers a save that
    // lands during the first. If the account can't be reached, or the cache changes again, the cache stays
    // and goes up the next time this account signs in here.
    let synced = false;

    for (let round = 0; round < 2 && !synced; round += 1) {
      sync.absorbCache();
      sync.state.unsynced = true;
      synced = await sync.pushProfile({ lifetime: pageLifetime() });

      if (overtaken()) return;

      // Unreachable (requests time out, see account.request) or refused: another round would only wait again.
      if (!synced && accounts.view.getSnapshot().sync !== 'syncing') break;
    }

    // The cache goes only if it still holds what the last push sent, checked as it is removed.
    await account.signOut(accounts.session, { sentText: synced ? sync.state.sentText : null });
    await accounts.replaceIdentity(null);
    ports.reload();
  }


  function followSessionElsewhere(event: StorageEvent) {
    const userId = requireSession().user.id;
    const current = account.loadSession()?.user.id;

    const signedOut = event.key === null
      || (event.key === account.signedOutKey(userId) && event.newValue !== null)
      || (event.key === account.profileKey(userId) && event.newValue === null)
      || (event.key === account.SESSION_KEY && (current ? current !== userId : account.signedOut(userId)));

    if (!signedOut) return false;
    sync.state.signedOutElsewhere = true;
    void accounts.replaceIdentity(null);
    // What this device knew of the account's board sharing goes with the sign-out, as in the tab that signed out.
    friendsBoard?.signOut();
    window.clearTimeout(sync.state.syncTimer);
    sync.state.syncTimer = 0;
    // A sign-out that sent everything removes the cache next: this tab waits to hear it (finishFollow).
    const sent = event.key === account.signedOutKey(userId) ? sentStamp(event.newValue) : null;

    if (sent !== null) sync.state.pendingSignOut = sent;
    else if (!ports.running()) ports.reload();

    return true;
  }

  function sentStamp(markerText: string | null) {
    try {
      const marker: unknown = JSON.parse(markerText ?? 'null');

      return isRecord(marker) && typeof marker.sent === 'string' ? marker.sent : null;
    } catch {
      return null;
    }
  }

  // The rest of following a sign-out that sent everything (pendingSignOut). The signing-out tab can't yet
  // see a save made here, or in another tab, just before it removed the cache: the removal names the copy
  // it removed (oldValue), and one that isn't the copy sent goes back for the next sign-in
  // (account.restoreUnsent), together with what this tab last saved, or took in holding all it saved
  // (cacheText; see absorbCache). Never this tab's memory: a run finished after hearing of the sign-out,
  // or still in progress, stays out. Only storage changes, so this happens mid-run too; the tab then starts
  // again as the device now is once no run is in progress. A cleared storage, or the marker removed
  // without the cache, finishes with nothing to put back.
  function finishFollow(event: StorageEvent) {
    const userId = requireSession().user.id;
    const cacheRemoved = event.key === account.profileKey(userId) && event.newValue === null;
    const finished = cacheRemoved || event.key === null || (event.key === account.signedOutKey(userId) && event.newValue === null);

    if (!finished || sync.state.pendingSignOut === null) return;

    if (cacheRemoved) account.restoreUnsent(userId, event.oldValue, sync.state.pendingSignOut, sync.state.cacheText);
    sync.state.pendingSignOut = null;

    if (!ports.running()) ports.reload();
  }


  return { enterAccount, signOutAccount, followSessionElsewhere, finishFollow };
}
