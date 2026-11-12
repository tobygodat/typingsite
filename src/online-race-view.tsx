import { raceSetupText } from './race-options.js';
import { Component, createRef, useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import type { CSSProperties, KeyboardEvent } from 'react';
import type { OnlineRaceController } from './online-race.js';
import { roomStatus } from './online-race.js';
import type { Friend, RacePlayer, RaceRoom } from './multiplayer.js';
import { QuickMatch } from './quick-match-view.js';
import { ChallengePeople } from './challenge-people-view.js';
import { RankCard } from './rank-card.js';
import { RaceReview } from './race-review.js';
import { cardOutcome, ratingResult } from './quick-match.js';
import { raceOutcome, rematchControls, tallyView } from './race-result.js';
import { formatSpeed, unitText } from './units.js';
import { LENGTHS } from './lengths.js';

interface Props { controller: OnlineRaceController }

const useOnline = (controller: OnlineRaceController) => useSyncExternalStore(controller.subscribeView, controller.getSnapshot, controller.getSnapshot);

export function preventChallengeRepeat(event: KeyboardEvent<HTMLElement>) {
  if (event.repeat && (event.key === 'Enter' || event.key === ' ') && event.target instanceof Element
    && event.target.closest('button, a[href], summary')) event.preventDefault();
}

export function OnlineRaceError({ controller }: Props) {
  const view = useOnline(controller);

  return <p id="online-error" className="field-error" role="alert">{view.error}</p>;
}

export function OnlineRacePeople({ controller }: Props) {
  const view = useOnline(controller);
  const people = view.controllers?.people;
  const peopleView = useSyncExternalStore(people?.view.subscribe ?? noSubscription, people?.view.getSnapshot ?? emptyPeople, people?.view.getSnapshot ?? emptyPeople);
  const hasLinkRow = peopleView.rows.some((row) => row.state === 'link');

  return <div id="challenge-people" className="people" hidden={view.mode !== 'people' || Boolean(view.room || view.joining)} onKeyDown={preventChallengeRepeat}>
    {view.controllers && <><QuickMatch controller={view.controllers.quick} /><ChallengePeople controller={view.controllers.people} /></>}
    <p id="people-status" className="online-copy people-status" role="status">{view.peopleStatus}</p>
    <div className="people-foot"><div className="people-foot-group">
      <button id="people-add" className="people-link" type="button" data-signed-in="" hidden={!view.signedIn} onClick={() => controller.show('add', { focus: true })}>Add a friend</button>
      <button id="people-race-link" className="people-link" type="button" data-signed-in="" hidden={!view.signedIn || hasLinkRow} aria-disabled={view.busy || undefined} onClick={controller.raceLink}>Copy a race link</button>
      <button id="people-setup" className="people-link people-setup-link" type="button" data-signed-in="" hidden={!view.signedIn} onClick={() => controller.show('setup', { focus: true })}>Race setup <span id="people-setup-conditions" className="people-conditions">{view.setupText}</span></button>
      <button id="online-signin" className="people-link" type="button" data-guest="" hidden={view.signedIn} onClick={controller.signIn}>Sign in to keep friends</button>
    </div><div className="people-foot-group">
      <button id="open-daily" className="people-link" type="button" onClick={() => controller.show('daily', { focus: true })}>Daily passage</button>
      <button id="open-local" className="people-link" type="button" onClick={() => controller.show('local', { focus: true })}>One keyboard</button>
    </div></div>
  </div>;
}

const noSubscription = () => () => {};
const emptyPeopleView: ReturnType<import('./challenge-people-view.js').PeopleController['view']['getSnapshot']> = { rows: [], now: 0, busy: false };
const emptyPeople = () => emptyPeopleView;

export function OnlineRaceBack({ controller }: Props) {
  return <button className="btn btn-ghost btn-sm challenge-back" type="button" data-challenge-back="" aria-label="Back to challenge" onClick={() => controller.show('people', { focus: true })}>Back</button>;
}

export function OnlineRaceAddFriend({ controller }: Props) {
  const view = useOnline(controller);
  const email = useRef<HTMLInputElement>(null);

  return <section id="people-add-view" className="challenge-view" aria-labelledby="people-add-heading" hidden={view.mode !== 'add'} onKeyDown={preventChallengeRepeat}>
    <OnlineRaceBack controller={controller} /><h2 id="people-add-heading" tabIndex={-1}>Add a friend</h2>
    <form id="online-setup" className="online-setup" onSubmit={(event) => { event.preventDefault(); void controller.addFriend(); }}>
      <div className="player-field"><label htmlFor="online-invite-email">Their account email</label><input ref={email} id="online-invite-email" className="input" type="email" maxLength={254} required autoComplete="off" placeholder="name@example.com" value={view.email} onChange={(event) => controller.setEmail(event.target.value)} /></div>
      <div className="online-setup-actions"><button id="add-friend" className="btn btn-primary" type="submit" aria-disabled={view.changingFriends || undefined}>Add friend</button><button id="create-online-race" className="btn btn-ghost" type="button" aria-disabled={view.busy || undefined} onClick={() => { if (email.current?.reportValidity()) controller.raceOnce(); }}>Race once</button></div>
    </form>
    <FriendList controller={controller} friends={view.friends} busy={view.changingFriends} />
  </section>;
}

interface FriendsProps extends Props { friends: readonly Friend[]; busy: boolean }

interface FriendFocus { id: string | undefined; visible: boolean }

class FriendList extends Component<FriendsProps, { unused?: never }, FriendFocus | null> {
  list = createRef<HTMLUListElement>();
  getSnapshotBeforeUpdate(): FriendFocus | null {
    const focused = document.activeElement;

    return focused instanceof HTMLButtonElement && this.list.current?.contains(focused)
      ? { id: focused.dataset.removeFriend, visible: focused.matches(':focus-visible') } : null;
  }
  componentDidUpdate(_props: Readonly<FriendsProps>, _state: Readonly<{ unused?: never }>, previous: FriendFocus | null) {
    if (!previous || this.list.current?.contains(document.activeElement)) return;
    const same = [...(this.list.current?.querySelectorAll<HTMLButtonElement>('[data-remove-friend]') ?? [])].find((button) => button.dataset.removeFriend === previous.id);
    const options = { preventScroll: true, focusVisible: previous.visible };
    (same ?? document.getElementById('online-invite-email'))?.focus(options);
  }
  render() {
    const { controller, friends, busy } = this.props;

    return <ul ref={this.list} id="online-friend-list" className="online-friend-list" aria-label="Your friends">{friends.map((friend) => <li key={friend.id} className="online-friend-row">
      <div className="online-friend-name"><strong>{friend.name}</strong>{friend.email && <span>{friend.email}</span>}</div>
      <button type="button" className="btn btn-ghost btn-sm" data-remove-friend={friend.id} aria-label={`Remove ${friend.name} from friends`} aria-disabled={busy || undefined} onClick={() => { void controller.removeFriend(friend.id); }}>Remove</button>
    </li>)}</ul>;
  }
}

export function OnlineRaceSetup({ controller }: Props) {
  const view = useOnline(controller);
  const modes = useRef<HTMLDivElement>(null);
  const lengths = useRef<HTMLDivElement>(null);
  const setup = view.setup;
  const spec = setup.mode === 'quote' ? null : LENGTHS[setup.mode];
  useLayoutEffect(() => {
    if (modes.current) controller.updateGlide(modes.current);

    if (spec && lengths.current) controller.updateGlide(lengths.current);
  }, [controller, setup, spec]);

  return <section id="people-setup-view" className="challenge-view" aria-labelledby="people-setup-heading" hidden={view.mode !== 'setup'} onKeyDown={preventChallengeRepeat}>
    <OnlineRaceBack controller={controller} /><h2 id="people-setup-heading" tabIndex={-1}>Race setup</h2>
    <div className="player-field online-name-field"><label htmlFor="online-name">Your race name</label><input id="online-name" className="input" type="text" maxLength={24} autoComplete="nickname" placeholder="Name" value={view.name} onChange={(event) => controller.setName(event.target.value)} /></div>
    <div id="online-options" className="online-options" role="group" aria-label="Race options">
      <div ref={modes} className="segmented glide mode-options" role="group" aria-label="Race mode" data-race-modes="" data-glide="pressed"><span className="glide-pill" aria-hidden="true"></span>{(['time', 'words', 'quote'] satisfies Array<typeof setup.mode>).map((mode) => <button key={mode} type="button" className={setup.mode === mode ? 'is-active' : undefined} data-mode={mode} aria-pressed={setup.mode === mode} onClick={() => controller.setMode(mode)}>{mode}</button>)}</div>
      <div ref={lengths} className="segmented compact glide" role="group" aria-label="Race length" data-race-lengths="" hidden={!spec} data-glide="pressed"><span className="glide-pill" aria-hidden="true"></span>{spec?.presets.map((length) => <button key={length} type="button" data-length={length} className={setup[spec.key] === length ? 'is-active' : undefined} aria-label={`${length} ${spec.unit}`} aria-pressed={setup[spec.key] === length} onClick={() => controller.setLength(length)}>{length}</button>)}</div>
      <label className="compact-switch" data-race-punctuation="" hidden={setup.mode === 'quote'}><input className="switch" type="checkbox" checked={Boolean(setup.punctuation)} onChange={(event) => controller.setPunctuation(event.target.checked)} /><span>punctuation</span></label>
    </div>
    <div className="online-actions"><button id="online-setup-done" className="btn btn-primary" type="button" onClick={() => controller.show('people', { focus: true })}>Done</button><button id="online-customize-reset" className="btn btn-ghost" type="button" hidden={!view.resetSetup} onClick={controller.matchPractice}>Match practice</button></div>
  </section>;
}

interface ProgressStyle extends CSSProperties { '--progress': number }

function PlayerRow({ room, slot }: { room: RaceRoom; slot: number }) {
  const player = room.players?.find((value) => value.slot === slot);
  const progress = Math.max(0, Math.min(100, player?.progress || 0));
  const style: ProgressStyle = { '--progress': progress / 100 };

  const state = !player ? 'not joined' : player.left ? 'left' : player.finished ? 'finished' : room.status === 'waiting'
    ? player.ready ? 'ready' : room.rematchOf && !player.connected && slot !== room.selfSlot ? 'invited' : 'not ready' : `${Math.round(player.progress || 0)}% complete`;

  return <div className="online-player-row" data-player-slot={slot}><strong>{player ? `${player.name}${slot === room.selfSlot ? ' (you)' : ''}` : 'Waiting for a player'}</strong><span>{state}</span><div className="progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress)} aria-label={`${player?.name || `Player ${slot}`} race progress`}><span style={style}></span></div></div>;
}

function Score({ player, outcome, mine, children }: { player: RacePlayer; outcome: string; mine?: boolean; children: React.ReactNode }) {
  return <div id={mine ? 'online-duel-mine' : 'online-duel-theirs'} className="duel-side" data-outcome={outcome}>
    <h3 className="duel-name">{mine ? 'You' : player.name}</h3><p className="duel-speed"><strong className="duel-wpm num" data-bare="" data-wpm={player.wpm || 0}>{formatSpeed(player.wpm || 0, { bare: true })}</strong><span className="duel-unit" data-speed-unit="">{unitText('{unit}')}</span></p>
    <p className="duel-accuracy num">{outcome !== 'unchecked' ? `${player.accuracy ?? 100}%` : player.left ? 'left' : 'not checked'}</p><div className="duel-choice">{children}</div>
  </div>;
}

const Check = () => <svg className="duel-check" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" /></svg>;

function Results({ controller, room }: Props & { room: RaceRoom }) {
  const view = useOnline(controller);
  const me = room.players?.find((player) => player.slot === room.selfSlot);
  const opponent = room.players?.find((player) => player.slot !== room.selfSlot);

  if (!me || !opponent) return <section id="online-results" className="race-duel" hidden aria-label="Race results" />;
  const mine = room.quick ? cardOutcome(me) : raceOutcome(me, opponent);
  const theirs = room.quick ? cardOutcome(opponent) : raceOutcome(opponent, me);
  const tally = me.account && opponent.account ? tallyView(room.tally, mine === 'won' ? 'won' : theirs === 'won' ? 'lost' : 'tied') : null;
  const controls = rematchControls(me, opponent);

  return <section id="online-results" className="race-duel" hidden={room.status !== 'finished'} aria-label="Race results">
    <div className="duel-scores"><Score player={me} outcome={mine} mine><button id="online-rematch" className="btn btn-primary duel-rematch" type="button" data-state={controls.mine} aria-pressed={controls.mine === 'chosen'} aria-disabled={view.busy || controls.mine === 'inactive' || undefined} onClick={controller.rematch}><Check />Rematch</button></Score>
      <div className="duel-middle"><p id="online-tally" className="duel-tally num" hidden={!tally} aria-label={tally ? `You ${tally.mine}, ${opponent.name} ${tally.theirs}` : undefined}><span className={tally?.raised === 'mine' ? 'is-raised' : undefined}>{tally?.mine}</span><span aria-hidden="true">–</span><span className={tally?.raised === 'theirs' ? 'is-raised' : undefined}>{tally?.theirs}</span></p><p id="online-starting" className="duel-starting" role="status" hidden={!controls.starting}>Starting</p></div>
      <Score player={opponent} outcome={theirs}><p id="online-their-rematch" className="duel-their-rematch" role="status" data-state={controls.theirs} aria-label={controls.theirs === 'left' ? `${opponent.name} left` : `${opponent.name} ${controls.theirs === 'chosen' ? 'picked' : 'hasn’t picked'} Rematch`}><Check /><span>{controls.theirs === 'left' ? 'left' : 'Rematch'}</span></p></Score>
    </div>
    {view.controllers && <RaceReview controller={view.controllers.review} />}
    <div id="online-review-wait" className="duel-review duel-review-wait" hidden={!view.reviewNote} data-state={view.reviewState}><p id="online-review-note" className="duel-review-note">{view.reviewNote}</p></div>
  </section>;
}

export function OnlineRaceRoom({ controller }: Props) {
  const view = useOnline(controller);
  const input = useRef<HTMLTextAreaElement>(null);
  const display = useRef<HTMLDivElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (input.current && display.current && wrap.current) return controller.attach({ input: input.current, display: display.current, wrap: wrap.current });
  }, [controller]);
  const room = view.room;
  const me = room?.players?.find((player) => player.slot === room.selfSlot);
  const opponent = room?.players?.find((player) => player.slot !== room.selfSlot);
  const closed = Boolean(room && (room.status === 'finished' || room.status === 'cancelled' || room.status === 'expired'));
  const result = room?.quick ? ratingResult(room.rating, opponent?.name) : null;
  const carded = Boolean(result && result.kind !== 'unrated');

  const canAdd = closed && Boolean(opponent && view.signedIn && opponent.account && !opponent.friend && !view.befriended)
    && !(room?.selfSlot === 1 && room.inviteKind === 'account' && !room.quick);

  return <div id="online-challenge" hidden={view.mode !== 'people' || !(room || view.joining)} onKeyDown={preventChallengeRepeat}>
    <form id="online-guest-join" className="online-join" hidden={!view.joining} onSubmit={(event) => { event.preventDefault(); controller.joinGuest(); }}>
      <h2>You’re invited to race.</h2><div className="player-field"><label htmlFor="online-guest-name">Your race name</label><input id="online-guest-name" className="input" type="text" maxLength={24} required autoComplete="nickname" placeholder="Name" value={view.guestName} onChange={(event) => controller.setGuestName(event.target.value)} /></div>
      <div className="online-actions"><button id="join-online-race" className="btn btn-primary" type="submit" aria-disabled={view.busy || undefined}>Join race</button><button id="dismiss-race-invite" className="btn btn-ghost" type="button" onClick={controller.dismissGuest}>Cancel</button></div>
    </form>
    <section id="online-room" className="online-room" aria-labelledby="online-room-heading" hidden={!room}>
      <div className="online-section-heading"><h2 id="online-room-heading">Your race</h2><button id="online-leave" className="btn btn-ghost btn-sm" type="button" aria-disabled={view.busy || undefined} onClick={controller.close}>{closed ? 'Close race' : 'Leave race'}</button></div>
      <p id="online-room-conditions" className="condition-copy">{room?.conditions?.mode ? raceSetupText(room.conditions) : ''}</p><p id="online-room-status" className="online-copy" role="status">{room ? roomStatus(room, view.finishRequested) : ''}</p>
      <p id="online-rating-change" className={`online-copy${carded ? ' sr-only' : ''}`} role="status" hidden={!result}>{result?.sentence || ''}</p>
      {view.controllers && <RankCard controller={view.controllers.rankCard} />}
      <p id="online-connection" className="online-copy" role="status">{view.connection}</p><p id="online-account-invite-status" className="online-copy" role="status" hidden={!view.accountInvite}>{view.accountInvite}</p>
      <div id="online-share" className="online-share" hidden={!view.shareLink}><label htmlFor="online-guest-link">Guest invitation link</label><div className="online-link-row"><input id="online-guest-link" className="input" type="text" readOnly value={view.shareLink} /><button id="copy-race-link" className="btn btn-secondary" type="button" onClick={() => { void controller.copyLink(); }}>Copy link</button></div><p id="online-invite-sent" className="online-copy">{view.inviteSent}</p></div>
      <div id="online-players" className="online-players" hidden={room?.status === 'finished'}>{room && [1, 2].map((slot) => <PlayerRow key={slot} room={room} slot={slot} />)}</div>
      <button id="online-ready" className="btn btn-primary" type="button" hidden={room?.status !== 'waiting'} aria-disabled={view.busy || undefined} onClick={controller.ready}>{me?.ready ? 'Not ready' : 'Ready to race'}</button>
      <div id="online-stage" hidden={room?.status !== 'countdown' && room?.status !== 'racing'}><p id="online-countdown" className="online-countdown num" role="status">{view.countdown}</p><p id="online-timer" className="panel-label num">{view.timer}</p>
        <div ref={wrap} className="online-typing-wrap"><div ref={display} id="online-text-display" aria-hidden="true"></div><textarea ref={input} id="online-input" aria-label="Online race typing input" aria-describedby="online-help online-accessible-passage" rows={1} spellCheck={false} autoCapitalize="off" autoComplete="off" autoCorrect="off" disabled></textarea><span id="online-accessible-passage" className="sr-only">{view.passage}</span></div>
        <p id="online-help" className="online-copy">{view.help}</p>
      </div>
      {room && <Results controller={controller} room={room} />}
      <div id="online-after" className="online-after" hidden={!canAdd}><div className="online-actions"><button id="online-befriend" className="btn btn-ghost" type="button" hidden={!canAdd} aria-disabled={view.changingFriends || undefined} onClick={() => { void controller.befriend(); }}>Add {opponent?.name} to friends</button></div></div>
    </section>
  </div>;
}

