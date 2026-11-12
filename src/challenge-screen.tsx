export function ChallengeScreen() {
  return (
<section id="compete-screen" className="screen" data-screen="compete" aria-labelledby="compete-heading" hidden>
        <h1 id="compete-heading" className="sr-only" tabIndex={-1}>Challenge</h1>
        <p id="online-error" className="field-error" role="alert"></p>

        <div id="challenge-people" className="people">
          <section id="quick-match" className="quick-match" aria-labelledby="quick-match-heading">
            <div className="quick-match-head">
              <h2 id="quick-match-heading" tabIndex={-1}>Quick match</h2>
              <p className="quick-match-rating num" data-quick-part="rating" hidden></p>
              <p className="quick-match-rating" data-guest="">Sign in to be matched.</p>
            </div>
            <button className="btn btn-primary quick-match-go" type="button" data-quick="toggle" data-quick-part="toggle">Find a race</button>
            <p className="online-copy quick-match-status" role="status" data-quick-part="status"></p>
            <div className="online-actions quick-match-lonely" data-quick-part="lonely" hidden>
              <button className="btn btn-ghost btn-sm" type="button" data-quick="keep">Keep waiting</button>
              <button className="btn btn-ghost btn-sm" type="button" data-quick="best" data-quick-part="best">Race your best run</button>
            </div>
          </section>
          <ul id="people-list" className="people-list" aria-label="People you race"></ul>
          <p id="people-status" className="online-copy people-status" role="status"></p>
          <div className="people-foot">
            <div className="people-foot-group">
              <button id="people-add" className="people-link" type="button" data-signed-in="">Add a friend</button>
              <button id="people-race-link" className="people-link" type="button" data-signed-in="">Copy a race link</button>
              <button id="people-setup" className="people-link people-setup-link" type="button" data-signed-in="">Race setup <span id="people-setup-conditions" className="people-conditions"></span></button>
              <button id="online-signin" className="people-link" type="button" data-guest="">Sign in to keep friends</button>
            </div>
            <div className="people-foot-group">
              <button id="open-daily" className="people-link" type="button">Daily passage</button>
              <button id="open-local" className="people-link" type="button">One keyboard</button>
            </div>
          </div>
        </div>

        <section id="people-add-view" className="challenge-view" aria-labelledby="people-add-heading" hidden>
          <button className="btn btn-ghost btn-sm challenge-back" type="button" data-challenge-back="" aria-label="Back to challenge">Back</button>
          <h2 id="people-add-heading" tabIndex={-1}>Add a friend</h2>
          <form id="online-setup" className="online-setup">
            <div className="player-field">
              <label htmlFor="online-invite-email">Their account email</label>
              <input id="online-invite-email" className="input" type="email" maxLength={254} required autoComplete="off" placeholder="name@example.com" />
            </div>
            <div className="online-setup-actions">
              <button id="add-friend" className="btn btn-primary" type="submit">Add friend</button>
              <button id="create-online-race" className="btn btn-ghost" type="button">Race once</button>
            </div>
          </form>
          <ul id="online-friend-list" className="online-friend-list" aria-label="Your friends"></ul>
        </section>

        <section id="people-setup-view" className="challenge-view" aria-labelledby="people-setup-heading" hidden>
          <button className="btn btn-ghost btn-sm challenge-back" type="button" data-challenge-back="" aria-label="Back to challenge">Back</button>
          <h2 id="people-setup-heading" tabIndex={-1}>Race setup</h2>
          <div className="player-field online-name-field">
            <label htmlFor="online-name">Your race name</label>
            <input id="online-name" className="input" type="text" maxLength={24} autoComplete="nickname" placeholder="Name" />
          </div>
          <div id="online-options" className="online-options" role="group" aria-label="Race options"></div>
          <div className="online-actions">
            <button id="online-setup-done" className="btn btn-primary" type="button">Done</button>
            <button id="online-customize-reset" className="btn btn-ghost" type="button" hidden>Match practice</button>
          </div>
        </section>

        <div id="online-challenge">
          <form id="online-guest-join" className="online-join" hidden>
            <h2>You’re invited to race.</h2>
            <div className="player-field"><label htmlFor="online-guest-name">Your race name</label><input id="online-guest-name" className="input" type="text" maxLength={24} required autoComplete="nickname" placeholder="Name" /></div>
            <div className="online-actions"><button id="join-online-race" className="btn btn-primary" type="submit">Join race</button><button id="dismiss-race-invite" className="btn btn-ghost" type="button">Cancel</button></div>
          </form>
          <section id="online-room" className="online-room" aria-labelledby="online-room-heading" hidden>
            <div className="online-section-heading"><h2 id="online-room-heading">Your race</h2><button id="online-leave" className="btn btn-ghost btn-sm" type="button">Leave race</button></div>
            <p id="online-room-conditions" className="condition-copy"></p>
            <p id="online-room-status" className="online-copy" role="status"></p>
            <p id="online-rating-change" className="online-copy" role="status" hidden></p>
            <div id="online-rank-card" className="rank-card-slot" aria-hidden="true" hidden></div>
            <template id="rank-card-template">
              <div className="rank-card">
                <canvas className="rc-wind"></canvas>
                <div className="rc-body">
                  <p className="rc-label" data-rc="label" data-rc-clear="" data-rc-text=""></p>
                  <div className="rc-emblem" data-rc="emblem" data-rc-clear="">
                    <svg viewBox="0 0 132 132" focusable="false">
                      <defs><linearGradient gradientUnits="userSpaceOnUse" x1="14" y1="6" x2="118" y2="126"><stop className="rc-stop-a" offset="0" /><stop className="rc-stop-b" offset="1" /></linearGradient></defs>
                      <polygon className="rc-hull" points="66,6 118,36 118,96 66,126 14,96 14,36" strokeWidth="4" data-rc-stroke="" />
                      <g className="rc-mark" data-rc="mark" fill="none" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" data-rc-stroke=""></g>
                      <text className="rc-step" data-rc="step" x="66" y="118" textAnchor="middle" fontSize="13"></text>
                    </svg>
                  </div>
                  <p className="rc-rank" data-rc="rank" data-rc-clear="" data-rc-text=""></p>
                  <p className="rc-from" data-rc="from" data-rc-clear="" data-rc-text=""></p>
                  <p className="rc-nums" data-rc-clear="" data-rc-text=""><span className="rc-rating num" data-rc="rating"></span><span className="rc-delta num" data-rc="delta"></span></p>
                  <p className="rc-count" data-rc="count" data-rc-clear="" data-rc-text=""></p>
                  <div className="rc-bar" data-rc="bar" data-rc-clear=""><span className="rc-fill"></span><span className="rc-change"></span></div>
                  <p className="rc-ends" data-rc="ends" data-rc-clear="" data-rc-text=""><span></span><span></span></p>
                  <p className="rc-why" data-rc="why" data-rc-clear="" data-rc-text=""></p>
                </div>
              </div>
            </template>
            <p id="online-connection" className="online-copy" role="status"></p>
            <p id="online-account-invite-status" className="online-copy" role="status" hidden></p>
            <div id="online-share" className="online-share" hidden>
              <label htmlFor="online-guest-link">Guest invitation link</label>
              <div className="online-link-row"><input id="online-guest-link" className="input" type="text" readOnly /><button id="copy-race-link" className="btn btn-secondary" type="button">Copy link</button></div>
              <p id="online-invite-sent" className="online-copy"></p>
            </div>
            <div id="online-players" className="online-players"></div>
            <button id="online-ready" className="btn btn-primary" type="button">Ready to race</button>
            <div id="online-stage" hidden>
              <p id="online-countdown" className="online-countdown num" role="status"></p>
              <p id="online-timer" className="panel-label num"></p>
              <div className="online-typing-wrap">
                <div id="online-text-display" aria-hidden="true"></div>
                <textarea id="online-input" aria-label="Online race typing input" aria-describedby="online-help online-accessible-passage" rows={1} spellCheck={false} autoCapitalize="off" autoComplete="off" autoCorrect="off" disabled></textarea>
                <span id="online-accessible-passage" className="sr-only"></span>
              </div>
              <p id="online-help" className="online-copy">Paste and key repeat are off.</p>
            </div>
            <section id="online-results" className="race-duel" hidden aria-label="Race results">
              <div className="duel-scores">
                <div id="online-duel-mine" className="duel-side">
                  <h3 className="duel-name">You</h3>
                  <p className="duel-speed"><strong className="duel-wpm num" data-bare=""></strong><span className="duel-unit" data-speed-unit="">wpm</span></p>
                  <p className="duel-accuracy num"></p>
                  <div className="duel-choice"><button id="online-rematch" className="btn btn-primary duel-rematch" type="button" aria-pressed="false"><svg className="duel-check" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" /></svg>Rematch</button></div>
                </div>
                <div className="duel-middle">
                  <p id="online-tally" className="duel-tally num" hidden><span></span><span aria-hidden="true">–</span><span></span></p>
                  <p id="online-starting" className="duel-starting" role="status" hidden>Starting</p>
                </div>
                <div id="online-duel-theirs" className="duel-side">
                  <h3 className="duel-name"></h3>
                  <p className="duel-speed"><strong className="duel-wpm num" data-bare=""></strong><span className="duel-unit" data-speed-unit="">wpm</span></p>
                  <p className="duel-accuracy num"></p>
                  <div className="duel-choice"><p id="online-their-rematch" className="duel-their-rematch" role="status"><svg className="duel-check" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" /></svg><span></span></p></div>
                </div>
              </div>
              <div id="online-review" className="duel-review" hidden>
                <div className="segmented duel-toggle" role="group" aria-label="Race view">
                  <button id="online-show-graph" type="button" aria-pressed="true">Graph</button>
                  <button id="online-show-replay" type="button" aria-pressed="false">Replay</button>
                </div>
                <div id="online-duel-graph" className="duel-graph speed-graph" role="img"></div>
                <div id="online-duel-replay" className="duel-replay" hidden>
                  <div className="duel-replay-wrap"><div id="online-replay-display" aria-hidden="true"></div></div>
                  <div className="duel-replay-controls">
                    <button id="online-replay-toggle" className="btn btn-secondary" type="button">Play</button>
                    <button id="online-replay-speed" className="btn btn-ghost" type="button" aria-label="Playback speed 1×">1×</button>
                    <button id="online-replay-restart" className="btn btn-ghost" type="button">Restart</button>
                  </div>
                </div>
              </div>
              <div id="online-review-wait" className="duel-review duel-review-wait" hidden><p id="online-review-note" className="duel-review-note"></p></div>
            </section>
            <div id="online-after" className="online-after" hidden>
              <div className="online-actions">
                <button id="online-befriend" className="btn btn-ghost" type="button" hidden>Add to friends</button>
              </div>
            </div>
          </section>
        </div>

        <section id="challenge-daily-view" className="challenge-view" aria-label="Daily passage" hidden>
          <button className="btn btn-ghost btn-sm challenge-back" type="button" data-challenge-back="" aria-label="Back to challenge">Back</button>
        <section id="daily-challenge" className="daily-challenge" aria-labelledby="daily-heading">
          <div className="daily-heading">
            <div><h2 id="daily-heading" tabIndex={-1}>Daily passage</h2><p id="daily-date" className="condition-copy"></p></div>
            <button id="start-daily" className="btn btn-primary" type="button">Start daily challenge</button>
          </div>
          <p id="daily-status" className="result-note" aria-live="polite"></p>
          <details id="daily-history-panel" hidden><summary>Your daily results</summary><div id="daily-history"></div></details>
        </section>

        <section id="friends-board" className="friends-board" aria-labelledby="friends-board-heading">
          <div className="online-section-heading">
            <h2 id="friends-board-heading" tabIndex={-1}>Friends board</h2>
            <button id="refresh-friends-board" className="btn btn-ghost btn-sm" type="button" hidden>Refresh</button>
          </div>
          <div id="friends-board-guest" className="friends-board-guest">
            <button id="friends-board-signin" className="btn btn-secondary" type="button">Sign in</button>
          </div>
          <div id="friends-board-share" className="friends-board-share" hidden>
            <label className="compact-switch" htmlFor="share-board">
              <input id="share-board" className="switch" type="checkbox" />
              <span>share on friends board</span>
            </label>
            <p id="friends-board-off" className="friends-board-off">Share to see friends’ rows. Only friends who added you back see yours.</p>
          </div>
          <p id="friends-board-status" className="online-copy" role="status"></p>
          <div id="friends-board-lists" className="friends-board-lists" hidden>
            <section className="board-column" aria-labelledby="board-daily-heading">
              <h3 id="board-daily-heading">Today’s daily</h3>
              <p id="board-daily-meta" className="condition-copy"></p>
              <ol id="board-daily" className="board-list" role="list"></ol>
            </section>
            <section className="board-column" aria-labelledby="board-week-heading">
              <h3 id="board-week-heading">This week’s practice</h3>
              <ol id="board-week" className="board-list" role="list"></ol>
            </section>
            <section className="board-column board-bests" aria-labelledby="board-bests-heading">
              <h3 id="board-bests-heading">Bests</h3>
              <div id="board-shape-field" className="filter-field board-shape">
                <select id="board-shape" className="input select" aria-label="Test conditions"></select>
              </div>
              <p id="board-bests-meta" className="condition-copy"></p>
              <ol id="board-bests" className="board-list" role="list"></ol>
              <p id="board-bests-none" className="friends-board-note" hidden>No bests yet.</p>
            </section>
          </div>
          <div id="friends-board-empty" className="friends-board-empty" hidden>
            <p>Nobody else yet. Friends appear once you’ve added each other.</p>
            <button id="friends-board-online" className="btn btn-secondary btn-sm" type="button">Add a friend</button>
          </div>
        </section>

        </section>

        <section id="challenge-local-view" className="challenge-view" aria-labelledby="local-heading" hidden>
          <button className="btn btn-ghost btn-sm challenge-back" type="button" data-challenge-back="" aria-label="Back to challenge">Back</button>
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
