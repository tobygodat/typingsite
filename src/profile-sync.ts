import * as account from './account.js';
import { emptyProfile, normalizeProfile } from './profile.js';
import { isRecord } from './domain-values.js';
import type { AccountSession } from './account-session.js';
import type { LearningStore } from './learning-store.js';
import type { HydratedProfile } from './profile-types.js';
import type { SyncedProfile } from './profile-copy.js';

export type ProfileHolds = Parameters<typeof account.joinHolds>[0];

type CloudRow = Awaited<ReturnType<typeof account.fetchCloudProfile>>;

type BoardWriter = NonNullable<NonNullable<Parameters<typeof account.insertCloudProfile>[2]>['board']>;

interface SyncPorts {
  running(): boolean;
  showMerged(): void;
  resetListedRuns(): void;
  boardFor(profile: SyncedProfile<HydratedProfile>): BoardWriter;
  boardPushed(): void;
  boardResume(): void;
  repairBoard(cloud: NonNullable<CloudRow>): void;
  adoptProfile(profile: SyncedProfile<HydratedProfile>): void;
  legacyPreferences(): void;
  clearCountsUnsaved(): void;
}

interface ProfileSyncState { syncTimer: number; cloudChecked: boolean; unsynced: boolean; localEdits: number; lastCloudAt: string | null; cacheText: string | null; lastPull: number; cacheWaiting: boolean; signedOutElsewhere: boolean; pendingSignOut: string | null; sentText: string | null; storageAvailable: boolean; heldClears: ProfileHolds }

interface PushOptions { cloud?: CloudRow }

const PULL_INTERVAL_MS = 15000;

export function createProfileSync(learning: LearningStore, accounts: AccountSession) {
  let ports: SyncPorts | null = null;
  let disposed = false;

  const state: ProfileSyncState = { syncTimer: 0, cloudChecked: false, unsynced: false, localEdits: 0, lastCloudAt: null,
    cacheText: null, lastPull: 0, cacheWaiting: false, signedOutElsewhere: false, pendingSignOut: null,
    sentText: null, storageAvailable: true, heldClears: {} };

  let pushQueue: Promise<unknown> = Promise.resolve();
  const session = () => accounts.session;
  const signedInAs = (userId: string) => !disposed && !state.signedOutElsewhere && session()?.user.id === userId && account.loadSession()?.user.id === userId;
  const later = (callback: () => void, delay = 0) => window.setTimeout(() => { if (!disposed) callback(); }, delay);
  const showMerged = () => { if (!disposed) ports?.showMerged(); };

  function loadProfile() {
    const active = session();

    if (!active) return emptyProfile();
    state.cacheText = account.loadCachedProfileText(active.user.id);

    try { const data: unknown = JSON.parse(state.cacheText ?? 'null');

 return normalizeProfile(data); }
    catch { return emptyProfile(); }
  }

  function absorb(data: unknown) {
    if (!isRecord(data) || data.version !== 2) return false;
    const before = account.syncSignature(learning.profile);
    const result = account.mergeAndHold(state.heldClears, learning.profile, normalizeProfile(data));
    learning.profile = result.merged;
    state.heldClears = result.holds;
    const changed = account.syncSignature(learning.profile) !== before;

    if (changed) ports?.resetListedRuns();

    return changed;
  }

  function storeLocally() {
    const active = session();

    if (!active || disposed) return false;
    const userId = active.user.id;
    const stored = account.loadCachedProfileText(userId);
    const current = account.loadSession()?.user.id;

    if ((current && current !== userId) || (stored === null && state.cacheText !== null)) return false;

    if (state.signedOutElsewhere || account.signedOut(userId)) return false;

    if (stored && stored !== state.cacheText) {
      try { const data: unknown = JSON.parse(stored); absorb(data); later(showMerged); } catch {}
    }

    const text = JSON.stringify(account.storedCopy(learning.profile));
    const saved = account.cacheProfileText(userId, text);

    if (saved) state.cacheText = text;

    return saved;
  }

  function commitPreferences(chosen: string[] = []) {
    const json = JSON.stringify(learning.preferences);

    if (json === learning.livePreferences && !chosen.length) return;
    const before: unknown = JSON.parse(learning.livePreferences);

    if (!isRecord(before)) throw new Error('Effective preference snapshot is not an object');
    const edited = Object.keys(learning.preferences).filter((key) => (key === 'keybindings' ? JSON.stringify(learning.preferences[key]) !== JSON.stringify(before[key]) : learning.preferences[key] !== before[key]) || chosen.includes(key));
    const stamps = learning.profile.preferencesAt || {};
    learning.profile.preferences = { ...learning.profile.preferences, ...Object.fromEntries(edited.map((key) => [key, learning.preferences[key]])) };
    learning.profile.preferencesAt = { ...stamps, ...Object.fromEntries(edited.map((key) => [key, account.stampAfter(typeof stamps[key] === 'string' ? stamps[key] : undefined)])) };
    learning.livePreferences = json;
  }

  function saveProfile() {
    ports?.clearCountsUnsaved();
    commitPreferences();
    account.capHistory(learning.profile);

    if (!session() || state.signedOutElsewhere) return true;
    state.unsynced = true;
    state.localEdits += 1;

    if (state.cloudChecked) {
      account.stampProfile(learning.profile);
      clearTimeout(state.syncTimer);
      state.syncTimer = later(pushWhenIdle, 1500);
    }

    state.storageAvailable = storeLocally();

    return state.storageAvailable;
  }

  function absorbCache() {
    state.cacheWaiting = false;
    const active = session();

    if (!active || !signedInAs(active.user.id)) return false;
    const text = account.loadCachedProfileText(active.user.id);

    if (!text || text === state.cacheText) return false;

    try {
      const data: unknown = JSON.parse(text);
      const changed = absorb(data);
      const own = state.cacheText;
      state.cacheText = text;

      if (isRecord(data) && data.version === 2 && !account.sameProfile(learning.profile, normalizeProfile(data)) && !storeLocally()) state.cacheText = own;

      return changed;
    } catch { return false; }
  }

  function noteCloudAt(updatedAt: string | null | undefined) {
    if (updatedAt && !(Date.parse(state.lastCloudAt ?? '') >= Date.parse(updatedAt))) state.lastCloudAt = updatedAt;
  }

  function pushWhenIdle() {
    if (ports?.running()) { state.syncTimer = later(pushWhenIdle, 1500);

 return; }

    void pushProfile();
  }

  function pushProfile(options: PushOptions = {}) {
    clearTimeout(state.syncTimer);
    state.syncTimer = 0;
    const run = pushQueue.then(() => pushOnce(options));
    pushQueue = run.catch(() => {});

    return run;
  }

  async function pushOnce({ cloud: known }: PushOptions) {
    const initial = session();

    if (!initial || disposed) return false;

    if (!state.unsynced) { accounts.sync('synced'); ports?.boardPushed();

 return true; }

    const userId = initial.user.id;

    if (!signedInAs(userId)) return false;

    try {
      accounts.session = await accounts.fresh();

      if (!signedInAs(userId)) return false;
      let cloud = known;

      for (let tries = 0; tries < 3; tries += 1) {
        const active = session();

        if (!active) return false;

        if (cloud === undefined) {
          cloud = await account.fetchCloudProfile(active);

          if (!signedInAs(userId)) return false;
        }

        const edits = state.localEdits;
        const theirs = cloud && isRecord(cloud.data) && cloud.data.version === 2 ? normalizeProfile(cloud.data) : null;
        const { merged, holds: pushHolds } = theirs ? account.mergeAndHold(state.heldClears, learning.profile, theirs) : { merged: learning.profile, holds: state.heldClears };
        let written: string | null;
        const board = ports?.boardFor(merged);

        if (theirs && account.sameRow(merged, theirs)) written = cloud?.updated_at ?? null;
        else if (cloud) written = await account.updateCloudProfile(active, merged, cloud.updated_at, { board });
        else written = await account.insertCloudProfile(active, merged, { board });

        if (!signedInAs(userId)) return false;

        if (written) {
          state.heldClears = account.joinHolds(state.heldClears, pushHolds);
          noteCloudAt(written);
          ports?.boardPushed();
          absorb(merged);
          const kept = storeLocally();

          if (edits === state.localEdits && account.sameProfile(learning.profile, merged)) {
            state.unsynced = false;
            state.sentText = kept ? state.cacheText : null;
          } else if (!state.syncTimer) state.syncTimer = later(pushWhenIdle, 1500);
          showMerged();
          accounts.sync(state.unsynced ? 'syncing' : 'synced');

          return !state.unsynced;
        }

        cloud = undefined;
      }

      accounts.sync('offline');

      return false;
    } catch { if (!disposed) accounts.sync(account.loadSession() ? 'offline' : 'expired');

 return false; }
  }

  async function pullProfile({ force = false } = {}) {
    const initial = session();

    if (!initial || !state.cloudChecked || ports?.running() || disposed) return;

    if (!force && Date.now() - state.lastPull < PULL_INTERVAL_MS) return;
    state.lastPull = Date.now();

    if (state.unsynced) { await pushProfile();

 return; }

    const userId = initial.user.id;

    if (!signedInAs(userId)) return;

    try {
      const active = await accounts.fresh();

      if (!active) return;
      accounts.session = active;

      if (!signedInAs(userId)) return;
      const cloud = await account.fetchCloudProfile(active);

      if (!cloud || !signedInAs(userId)) return;

      if (absorb(cloud.data)) { storeLocally(); showMerged(); }

      noteCloudAt(cloud.updated_at);

      if (state.unsynced || !account.sameRow(learning.profile, normalizeProfile(cloud.data))) { state.unsynced = true; await pushProfile({ cloud }); }
      else accounts.sync('synced');
    } catch { if (!disposed) accounts.sync(account.loadSession() ? 'offline' : 'expired'); }
  }

  async function syncOnLoad() {
    const initial = session();

    if (!initial || disposed) return;
    const userId = initial.user.id;

    try {
      const active = await accounts.fresh();

      if (!active) return;
      accounts.session = active;
      const cloud = await account.fetchCloudProfile(active);

      if (state.cloudChecked || !signedInAs(userId)) return;
      state.cloudChecked = true;
      state.lastPull = Date.now();

      if (!cloud) {
        const legacy = account.takeLegacyProfile();

        if (isRecord(legacy) && legacy.version === 2) {
          learning.profile = account.mergeProfiles(learning.profile, normalizeProfile(legacy));
          ports?.legacyPreferences();
        }

        saveProfile();
        await pushProfile();

        if (isRecord(legacy) && legacy.version === 2) ports?.adoptProfile(learning.profile);
      } else {
        absorb(cloud.data);
        noteCloudAt(cloud.updated_at);
        storeLocally();
        showMerged();

        if (state.unsynced || !account.sameRow(learning.profile, normalizeProfile(cloud.data))) { state.unsynced = true; await pushProfile({ cloud }); }
        else { accounts.sync('synced'); ports?.repairBoard(cloud); }
      }

      ports?.boardResume();
    } catch { if (!disposed) accounts.sync(account.loadSession() ? 'offline' : 'expired'); }
  }

  return {
    state, loadProfile, absorb, storeLocally, commitPreferences, saveProfile, absorbCache, noteCloudAt, signedInAs, pushWhenIdle, pushProfile, pullProfile, syncOnLoad,
    configure(next: SyncPorts) { ports = next; },
    saveChoice(...keys: string[]) { commitPreferences(keys);

 return saveProfile(); },
    dispose() { disposed = true; clearTimeout(state.syncTimer); },
  };
}

export type ProfileSync = ReturnType<typeof createProfileSync>;
