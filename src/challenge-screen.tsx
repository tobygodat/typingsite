import { DailyChallenge } from './daily-challenge.js';
import type { DailyChallengeController } from './daily-challenge.js';
import { LocalRace } from './local-race.js';
import type { LocalRaceController } from './local-race.js';
import { FriendsBoard } from './friends-board-view.js';
import type { FriendsBoardController } from './friends-board.js';
import { useSyncExternalStore } from 'react';
import type { OnlineRaceController } from './online-race.js';
import { OnlineRaceError, OnlineRacePeople, OnlineRaceAddFriend, OnlineRaceSetup, OnlineRaceRoom, OnlineRaceBack, preventChallengeRepeat } from './online-race-view.js';

export function ChallengeScreen({ onlineRace, friendsBoard, local, daily }: { daily: DailyChallengeController; local: LocalRaceController; onlineRace: OnlineRaceController; friendsBoard: FriendsBoardController }) {
  const view = useSyncExternalStore(onlineRace.subscribeView, onlineRace.getSnapshot, onlineRace.getSnapshot);

  return (
<section id="compete-screen" className="screen" data-screen="compete" aria-labelledby="compete-heading" hidden onKeyDown={preventChallengeRepeat}>
        <h1 id="compete-heading" className="sr-only" tabIndex={-1}>Challenge</h1>
        <OnlineRaceError controller={onlineRace} />
        <OnlineRacePeople controller={onlineRace} />
        <OnlineRaceAddFriend controller={onlineRace} />
        <OnlineRaceSetup controller={onlineRace} />
        <OnlineRaceRoom controller={onlineRace} />

        <section id="challenge-daily-view" className="challenge-view" aria-label="Daily passage" hidden={view.mode !== 'daily'}>
          <OnlineRaceBack controller={onlineRace} />
        <DailyChallenge controller={daily} />

        <FriendsBoard controller={friendsBoard} />

        </section>

        <section id="challenge-local-view" className="challenge-view" aria-labelledby="local-heading" hidden={view.mode !== 'local'}>
          <OnlineRaceBack controller={onlineRace} />
          <h2 id="local-heading" tabIndex={-1}>One keyboard</h2>
        <LocalRace controller={local} />
        </section>
      </section>
  );
}
