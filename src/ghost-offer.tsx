import { accountLifetime } from './async-runtime.js';
import { useRef, useSyncExternalStore } from 'react';
import { flushSync } from 'react-dom';
import { sameSignIn } from './account.js';
import { CHALLENGE_DAYS, challengePayload, sendChallenge } from './ghost-race.js';
import { listFriends } from './multiplayer.js';
import type { Friend } from './network-race.js';
import type { AccountSession } from './account-session.js';
import type { OnlineRaceController } from './online-race.js';
import type { CompletedAttempt } from './typing.js';
import { createStore } from './store.js';

interface OfferView {
  visible: boolean; open: boolean; name: string; selected: string; friends: readonly Friend[];
  loading: boolean; empty: boolean; formVisible: boolean; selectDisabled: boolean; sendDisabled: boolean; status: string; error: string;
}

export function createGhostOffer(accounts: AccountSession, onlineRace: OnlineRaceController) {
  const view = createStore<OfferView>({ visible: false, open: false, name: '', selected: '', friends: [], loading: false,
    empty: false, formVisible: true, selectDisabled: false, sendDisabled: false, status: '', error: '' });

  let offerRun: CompletedAttempt | null = null;
  let sentTo = new Set<string>();
  let requests = new Map<string, string>();
  let sending: CompletedAttempt | null = null;
  let friendsRequest: object | null = null;
  let friends: readonly Friend[] = [];
  let disposed = false;
  const busy = () => Boolean(offerRun) && sending === offerRun;
  const publish = (patch: Partial<OfferView>) => { if (!disposed) flushSync(() => view.publish({ ...view.getSnapshot(), ...patch })); };

  function render(completed: CompletedAttempt | null = offerRun) {
    if (completed !== offerRun) {
      offerRun = completed;
      sentTo = new Set();
      requests = new Map();
      friendsRequest = null;
      publish({ open: false, status: '', error: '' });
    }

    publish({ visible: Boolean(accounts.session && challengePayload(offerRun)) });
  }

  function racerName() {
    const name = onlineRace.getSnapshot().name.trim();

    if (name) return name;
    const session = accounts.session;

    if (!session) return '';
    const email = session.user.email;

    if (email === undefined) throw new TypeError('An account name requires its email');

    return email.split('@')[0]?.slice(0, 24) || '';
  }

  async function loadFriends() {
    const session = accounts.session;
    const owner = accountLifetime();
    const current = view.getSnapshot();
    publish({ name: current.name || racerName(), loading: !friends.length, selectDisabled: true, sendDisabled: true });
    const request = friendsRequest = {};
    let next = friends;
    let failure = '';

    try { next = await listFriends(session); }
    catch (error) { failure = error instanceof Error ? error.message : String(error); }

    if (disposed || friendsRequest !== request || accountLifetime() !== owner || !sameSignIn(accounts.session, session)) return;
    friends = next;
    const empty = !friends.length;
    const prior = view.getSnapshot().selected;
    const selected = friends.some((friend) => friend.id === prior) ? prior : friends[0]?.id ?? '';
    publish({ friends, selected, loading: false, error: failure, empty: empty && !failure, formVisible: !empty,
      selectDisabled: empty, sendDisabled: empty || busy() });
  }

  async function send(focusName: () => void) {
    if (disposed) return;
    const payload = challengePayload(offerRun);
    const current = view.getSnapshot();
    const friend = friends.find((value) => value.id === current.selected);
    const name = current.name.trim();
    const session = accounts.session;
    const owner = accountLifetime();
    publish({ error: '' });

    if (!payload || !friend || !session || busy()) return;

    if (!name) {
      publish({ error: 'Enter the name your friend will see.' });
      focusName();

      return;
    }

    if (sentTo.has(friend.id)) { publish({ status: `Already sent to ${friend.name}.` });

      return; }

    const run = offerRun;
    let requestId = requests.get(friend.id);

    if (!requestId) { requestId = crypto.randomUUID(); requests.set(friend.id, requestId); }

    sending = run;
    publish({ sendDisabled: true, status: `Sending to ${friend.name}…` });

    try {
      await sendChallenge(session, { friendId: friend.id, displayName: name, payload, requestId });

      if (disposed || run !== offerRun || accountLifetime() !== owner || !sameSignIn(accounts.session, session)) return;
      sentTo.add(friend.id);
      publish({ status: `Sent to ${friend.name}. ${friend.email ? `If ${friend.email} has an account, they` : 'They'} have ${CHALLENGE_DAYS} days to race it, and the result arrives in your inbox.` });
    } catch (error) {
      if (disposed || run !== offerRun || accountLifetime() !== owner || !sameSignIn(accounts.session, session)) return;
      publish({ status: '', error: error instanceof Error ? error.message : String(error) });
    } finally {
      if (sending === run) sending = null;

      if (run === offerRun && accountLifetime() === owner && sameSignIn(accounts.session, session)) publish({ sendDisabled: false });
    }
  }

  return {
    view, render, send,
    toggle(open: boolean) {
      if (disposed) return;
      publish({ open });

      if (open && accounts.session) void loadFriends();
    },
    name(name: string) { publish({ name }); },
    select(selected: string) { publish({ selected }); },
    addFriend() { if (!disposed) onlineRace.openAdd(); },
    dispose() { disposed = true; friendsRequest = null; },
  };
}

export function GhostOffer({ controller }: { controller: ReturnType<typeof createGhostOffer> }) {
  const view = useSyncExternalStore(controller.view.subscribe, controller.view.getSnapshot, controller.view.getSnapshot);
  const name = useRef<HTMLInputElement>(null);

  return <details id="ghost-offer" className="manual-panel ghost-offer" hidden={!view.visible} open={view.open} onToggle={(event) => controller.toggle(event.currentTarget.open)}><summary>Challenge a friend with this run</summary><p className="ghost-offer-copy">They race your keystrokes on this text within 7 days.</p><div id="ghost-offer-empty" hidden={!view.empty}><p className="ghost-offer-copy">Your friend list is empty.</p><button id="ghost-offer-friends" className="btn btn-ghost btn-sm" type="button" onClick={() => controller.addFriend()}>Add a friend</button></div><form id="ghost-offer-form" className="ghost-offer-form" noValidate hidden={!view.formVisible} onSubmit={(event) => { event.preventDefault(); void controller.send(() => name.current?.focus()); }}><label className="filter-field" htmlFor="ghost-friend">Friend<select id="ghost-friend" className="input" disabled={view.selectDisabled} value={view.selected} onChange={(event) => controller.select(event.currentTarget.value)}>{view.loading ? <option value="">Loading friends…</option> : view.friends.map((friend) => <option key={friend.id} value={friend.id}>{friend.email ? `${friend.name} (${friend.email})` : friend.name}</option>)}</select></label><label className="filter-field" htmlFor="ghost-name">Name they see<input ref={name} id="ghost-name" className="input" type="text" maxLength={24} autoComplete="nickname" placeholder="Name" value={view.name} onChange={(event) => controller.name(event.currentTarget.value)} /></label><button id="send-ghost" className="btn btn-secondary" type="submit" disabled={view.sendDisabled}>Send challenge</button></form><p id="ghost-offer-status" className="result-note" role="status">{view.status}</p><p id="ghost-offer-error" className="field-error" role="alert">{view.error}</p></details>;
}
