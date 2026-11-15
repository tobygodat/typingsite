import { useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import type { OnlineRaceController } from './online-race.js';
import type { PeopleController } from './challenge-people-view.js';
import type { DailyChallengeController } from './daily-challenge.js';

interface TileProps { id: string; icon: ReactNode; name: string; line: string; hidden?: boolean; busy?: boolean; onPress(): void }

// A tile is one button: an icon, a name and one short line, so what it does reads before its words do.
function Tile({ id, icon, name, line, hidden = false, busy = false, onPress }: TileProps) {
  return <button id={id} className="tile" type="button" hidden={hidden} aria-disabled={busy || undefined} onClick={onPress}>
    <span className="tile-icon" aria-hidden="true">{icon}</span>
    <span className="tile-name">{name}</span>
    <span className="tile-line">{line}</span>
  </button>;
}

const Glyph = ({ children }: { children: ReactNode }) => <svg viewBox="0 0 16 16">{children}</svg>;
const LINK = <Glyph><path d="M6.8 9.2a2.6 2.6 0 0 0 3.7 0l2-2a2.6 2.6 0 0 0-3.7-3.7l-.7.7" /><path d="M9.2 6.8a2.6 2.6 0 0 0-3.7 0l-2 2a2.6 2.6 0 0 0 3.7 3.7l.7-.7" /></Glyph>;
const CALENDAR = <Glyph><rect x="2.5" y="3.5" width="11" height="10" rx="2" /><path d="M2.5 6.5h11M5.5 2v3M10.5 2v3" /></Glyph>;
const KEYBOARD = <Glyph><rect x="1.5" y="4" width="13" height="8" rx="2" /><path d="M4 6.7h.01M6.6 6.7h.01M9.4 6.7h.01M12 6.7h.01M5 9.4h6" /></Glyph>;

const noSubscription = () => () => {};
const emptyPeopleView: ReturnType<PeopleController['view']['getSnapshot']> = { rows: [], now: 0, busy: false };
const emptyPeople = () => emptyPeopleView;

// Race by link makes the race when pressed, so it has no link to show before then. While the friends panel shows
// the "A friend" row, whose action is the same, the tile steps aside.
export function ChallengeTiles({ controller, daily }: { controller: OnlineRaceController; daily: DailyChallengeController }) {
  const view = useSyncExternalStore(controller.subscribeView, controller.getSnapshot, controller.getSnapshot);
  const people = view.controllers?.people;
  const peopleView = useSyncExternalStore(people?.view.subscribe ?? noSubscription, people?.view.getSnapshot ?? emptyPeople, people?.view.getSnapshot ?? emptyPeople);
  const dailyView = useSyncExternalStore(daily.view.subscribe, daily.view.getSnapshot, daily.view.getSnapshot);
  const hasLinkRow = peopleView.rows.some((row) => row.state === 'link');

  return <div className="challenge-tiles">
    <Tile id="people-race-link" icon={LINK} name="Race by link" line="no account needed" hidden={!view.signedIn || hasLinkRow} busy={view.busy} onPress={controller.raceLink} />
    <Tile id="open-daily" icon={CALENDAR} name="Daily passage" line={dailyView.tile} onPress={() => controller.show('daily', { focus: true })} />
    <Tile id="open-local" icon={KEYBOARD} name="One keyboard" line="take turns" onPress={() => controller.show('local', { focus: true })} />
  </div>;
}
