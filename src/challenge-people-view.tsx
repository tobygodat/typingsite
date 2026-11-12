import { Component, createRef, useSyncExternalStore } from 'react';
import { flushSync } from 'react-dom';
import { lineParts, tallyLabel } from './challenge-people.js';
import type { PersonRow } from './challenge-people.js';
import { Copy } from './results-card.js';
import { createStore } from './store.js';

type LinkRow = { key: string; kind: 'link'; state: 'link'; name: string; line: null; tally: null };

type PeopleRow = PersonRow | LinkRow;

type ActionKind = 'join' | 'dismiss' | 'ghost' | 'race' | 'link';

interface PersonAction { kind: ActionKind; label: string; spoken: string; target: string | null }

interface PeopleView { rows: PeopleRow[]; now: number; busy: boolean }

function actions(row: PeopleRow): PersonAction[] {
  const person = 'detail' in row && row.detail ? `${row.name} (${row.detail})` : row.name;

  switch (row.state) {
    case 'invited': return [{ kind: 'join', label: 'Join', spoken: `Join ${person}’s race`, target: row.inviteId }, { kind: 'dismiss', label: 'Dismiss', spoken: `Dismiss ${person}’s invitation`, target: row.inviteId }];
    case 'ghost': return [{ kind: 'ghost', label: 'Race the ghost', spoken: `Race ${person}’s ghost`, target: row.challengeId }];
    case 'friend': return [{ kind: 'race', label: 'Race', spoken: `Race ${person}`, target: row.friendId }];
    case 'link': return [{ kind: 'link', label: 'Copy a race link', spoken: 'Copy a race link', target: '' }];
  }
}

export function createPeopleView() {
  const view = createStore<PeopleView>({ rows: [], now: Date.now(), busy: false });
  let action: (kind: ActionKind, target: string | null) => void = () => {};

  return {
    view,
    configure(next: typeof action) { action = next; },
    update(rows: PeopleRow[], now = Date.now()) { flushSync(() => view.publish({ ...view.getSnapshot(), rows, now })); },
    setBusy(busy: boolean) { const current = view.getSnapshot();

 if (current.busy !== busy) flushSync(() => view.publish({ ...current, busy })); },
    act(key: string, kind: ActionKind) {
      const current = view.getSnapshot();
      const row = current.rows.find((item) => item.key === key);

      if (!row || (current.busy && ['join', 'race', 'link'].includes(kind))) return;
      const selected = actions(row).find((item) => item.kind === kind);

      if (selected) action(kind, selected.target);
    },
  };
}

export type PeopleController = ReturnType<typeof createPeopleView>;

function look(row: PeopleRow, now: number) {
  return JSON.stringify([row.name, 'detail' in row ? row.detail : undefined, row.state, 'kind' in row ? row.kind : undefined, row.tally,
    'inviteId' in row ? row.inviteId : undefined, 'challengeId' in row ? row.challengeId : undefined, 'friendId' in row ? row.friendId : undefined,
    lineParts(row.line, now).map((part) => typeof part === 'string' ? part : [part.wpm, ('bare' in part ? part.bare : undefined)])]);
}

interface PersonProps { row: PeopleRow; now: number; busy: boolean; controller: PeopleController }

interface PersonState { signature: string; settled: boolean }

class PersonItem extends Component<PersonProps, PersonState> {
  state = { signature: look(this.props.row, this.props.now), settled: false };
  static getDerivedStateFromProps(props: PersonProps, state: PersonState) {
    const signature = look(props.row, props.now);

    return signature === state.signature ? null : { signature, settled: true };
  }
  render() {
    const { row, now, busy, controller } = this.props;
    const detail = 'detail' in row ? row.detail : null;
    const parts = lineParts(row.line, now).map((part) => typeof part === 'string' ? part : { kind: 'speed', wpm: part.wpm, bare: ('bare' in part ? part.bare : undefined) } satisfies import('./practice-session.js').SpeedPart);

    return <li className="people-row" tabIndex={-1} data-key={row.key} data-state={row.state} data-look={this.state.signature} data-settled={this.state.settled ? 'true' : undefined}>
      <div className="people-who"><p className="people-name">{row.name}{detail && <span className="people-detail"> · {detail}</span>}</p><p className="people-line">{row.state === 'link' ? 'anyone with the link joins' : <Copy parts={parts} />}</p></div>
      <div className="people-side">{row.tally && <p className="people-tally num"><span aria-hidden="true">{row.tally.mine}–{row.tally.theirs}</span><span className="sr-only">{tallyLabel(row.tally)}</span></p>}
        <div className="people-actions">{actions(row).map((item, index) => <button key={item.kind} type="button" className={index === 0 ? 'btn btn-secondary people-action' : 'btn btn-ghost people-quiet'} data-people-action={item.kind} data-people-key={row.key} data-accept-invite={item.kind === 'join' ? item.target : undefined} data-dismiss-invite={item.kind === 'dismiss' ? item.target : undefined} data-race-ghost={item.kind === 'ghost' ? item.target : undefined} data-race-friend={item.kind === 'race' ? item.target : undefined} data-race-link={item.kind === 'link' ? '' : undefined} aria-label={item.spoken !== item.label ? item.spoken : undefined} aria-disabled={busy && ['join', 'race', 'link'].includes(item.kind) ? 'true' : undefined} onClick={() => controller.act(row.key, item.kind)}>{item.label}</button>)}</div>
      </div>
    </li>;
  }
}

interface PeopleFocusOptions extends FocusOptions { focusVisible?: boolean }

interface FocusSnapshot { focused: HTMLElement; key: string | undefined; action: string | null; rowAt: number; visible: boolean }

interface ListProps { view: PeopleView; controller: PeopleController }

interface ListState { unused?: never }

class PeopleList extends Component<ListProps, ListState, FocusSnapshot | null> {
  list = createRef<HTMLUListElement>();
  getSnapshotBeforeUpdate(): FocusSnapshot | null {
    const list = this.list.current;
    const focused = document.activeElement;

    if (!list || !(focused instanceof HTMLElement) || !list.contains(focused)) return null;
    const row = focused.closest<HTMLElement>('.people-row');

    return { focused, key: row?.dataset.key, action: focused.matches('button') ? `${focused.dataset.peopleKey}|${focused.dataset.peopleAction}` : null, rowAt: row ? [...list.children].indexOf(row) : -1, visible: focused.matches(':focus-visible') };
  }
  componentDidUpdate(_props: Readonly<ListProps>, _state: Readonly<ListState>, snapshot: FocusSnapshot | null) {
    const list = this.list.current;

    if (!snapshot || !list || list.contains(document.activeElement)) return;
    const same = snapshot.action ? [...list.querySelectorAll('button')].find((button) => `${button.dataset.peopleKey}|${button.dataset.peopleAction}` === snapshot.action) : null;
    const person = [...list.querySelectorAll<HTMLElement>('.people-row')].find((row) => row.dataset.key === snapshot.key);
    const fallback = list.children[Math.min(snapshot.rowAt, list.children.length - 1)];
    const target = same || person || (fallback instanceof HTMLElement ? fallback : document.getElementById('quick-match-heading'));
    const options: PeopleFocusOptions = { preventScroll: true };

    if (snapshot.visible) options.focusVisible = true;
    target?.focus(options);
  }
  render() {
    const { view, controller } = this.props;

    return <ul ref={this.list} id="people-list" className="people-list" aria-label="People you race" hidden={!view.rows.length} onKeyDown={(event) => { if (event.key === ' ' && event.target instanceof HTMLElement && event.target.matches('.people-row')) event.preventDefault(); }}>{view.rows.map((row) => <PersonItem key={row.key} row={row} now={view.now} busy={view.busy} controller={controller} />)}</ul>;
  }
}

export function ChallengePeople({ controller }: { controller: PeopleController }) {
  const view = useSyncExternalStore(controller.view.subscribe, controller.view.getSnapshot, controller.view.getSnapshot);

  return <PeopleList view={view} controller={controller} />;
}
