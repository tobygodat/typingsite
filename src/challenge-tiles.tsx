import { useSyncExternalStore } from 'react';
import type { OnlineRaceController } from './online-race.js';
import type { PeopleController } from './challenge-people-view.js';
import type { DailyChallengeController } from './daily-challenge.js';

interface TileProps { id: string; name: string; line: string; hidden?: boolean; busy?: boolean; onPress(): void }

// A tile is one button: a name and one short line.
function Tile({ id, name, line, hidden = false, busy = false, onPress }: TileProps) {
  return <button id={id} className="tile" type="button" hidden={hidden} aria-disabled={busy || undefined} onClick={onPress}>
    <span className="tile-name">{name}</span>
    <span className="tile-line">{line}</span>
  </button>;
}

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
    <Tile id="people-race-link" name="Race by link" line="no account needed" hidden={!view.signedIn || hasLinkRow} busy={view.busy} onPress={controller.raceLink} />
    <Tile id="open-daily" name="Daily passage" line={dailyView.tile} onPress={() => controller.show('daily', { focus: true })} />
    <Tile id="open-local" name="One keyboard" line="take turns" onPress={() => controller.show('local', { focus: true })} />
  </div>;
}
