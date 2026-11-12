import { FriendsBoard } from './friends-board-view.js';
import type { FriendsBoardController } from './friends-board.js';
import { useSyncExternalStore } from 'react';
import type { OnlineRaceController } from './online-race.js';
import { OnlineRaceError, OnlineRacePeople, OnlineRaceAddFriend, OnlineRaceSetup, OnlineRaceRoom, OnlineRaceBack, preventChallengeRepeat } from './online-race-view.js';

export function ChallengeScreen({ onlineRace, friendsBoard }: { onlineRace: OnlineRaceController; friendsBoard: FriendsBoardController }) {
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
        <section id="daily-challenge" className="daily-challenge" aria-labelledby="daily-heading">
          <div className="daily-heading">
            <div><h2 id="daily-heading" tabIndex={-1}>Daily passage</h2><p id="daily-date" className="condition-copy"></p></div>
            <button id="start-daily" className="btn btn-primary" type="button">Start daily challenge</button>
          </div>
          <p id="daily-status" className="result-note" aria-live="polite"></p>
          <details id="daily-history-panel" hidden><summary>Your daily results</summary><div id="daily-history"></div></details>
        </section>

        <FriendsBoard controller={friendsBoard} />

        </section>

        <section id="challenge-local-view" className="challenge-view" aria-labelledby="local-heading" hidden={view.mode !== 'local'}>
          <OnlineRaceBack controller={onlineRace} />
          <h2 id="local-heading" tabIndex={-1}>One keyboard</h2>
        <div id="local-challenge">
        <form id="compete-setup" className="challenge-setup">
          <div className="player-field">
            <label htmlFor="player-one-name">Player 1</label>
            <input id="player-one-name" className="input" type="text" maxLength={24} placeholder="Name" autoComplete="off" />
          </div>
          <div className="player-field">
            <label htmlFor="player-two-name">Player 2</label>
            <input id="player-two-name" className="input" type="text" maxLength={24} placeholder="Name" autoComplete="off" />
          </div>
          <button id="start-local-race" className="btn btn-secondary" type="submit">Start</button>
        </form>

        <div id="race-stage" className="race-stage" hidden>
          <div className="race-stage-heading">
            <div>
              <h2><span id="race-player">Player one</span>’s turn</h2>
            </div>
          </div>
          <div id="race-progress" className="progress-track" role="progressbar" aria-label="Challenge progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={0}><span></span></div>
          <div className="race-typing-wrap">
            <div id="race-text-display" aria-hidden="true"></div>
            <textarea id="race-input" aria-label="Challenge typing input" aria-describedby="race-help race-accessible-passage" rows={1} spellCheck={false} autoCapitalize="off" autoComplete="off" autoCorrect="off"></textarea>
            <span id="race-accessible-passage" className="sr-only"></span>
          </div>
          <p id="race-help"><span className="key-hint">esc restarts.</span></p>
        </div>

        <div id="race-handoff" className="handoff-panel" hidden>
          <div id="handoff-veil" className="handoff-veil" aria-hidden="true"></div>
          <div className="handoff-copy">
            <h2>Pass the keyboard to <span id="handoff-name">player 2</span>.</h2>
            <button id="start-next-player" className="btn btn-primary" type="button">Reveal passage</button>
          </div>
        </div>

        <div id="race-leaderboard" className="race-leaderboard" hidden aria-live="polite">
          <div className="race-result-heading">
            <h2 id="race-winner">Two observed runs</h2>
            <button id="race-again" className="btn btn-secondary" type="button">Play again</button>
          </div>
          <div id="race-results" className="race-results"></div>
          <p>Not counted in your progress.</p>
        </div>
        </div>
        </section>
      </section>
  );
}
