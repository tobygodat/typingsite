// The friends board on the Challenge screen: today's daily result and this week's practice time for
// you and the people you chose. Sharing is opt-in and off by default: only an account that shares sees
// the board, and it sees only mutual friends (each on the other's list) who share too. The service never
// returns an account id or email; rows carry the name on your own list. Each browser publishes its own
// owner's summary, so the numbers are friendly and unverified. Guests publish nothing.
import { request, freshSession, loadSession, AuthError } from './account.js';
import { conditionKey } from './typing.js';
import { dailyPassage, validRun } from './insights.js';

const DAY_MS = 86400000;
// The service refuses anything outside these, so they never travel.
const MAX_WPM = 400;
const MAX_ATTEMPTS = 1000;
const MAX_RUNS = 10000;
const $ = (id) => document.getElementById(id);

export const utcDay = (date = new Date()) => date.toISOString().slice(0, 10);

// Monday 00:00 UTC of the week holding `date`, as YYYY-MM-DD.
export function weekStart(date = new Date()) {
  const midnight = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  return utcDay(new Date(midnight - ((date.getUTCDay() + 6) % 7) * DAY_MS));
}

// Which daily a result belongs to: its conditions (corpus and metric version included) and its passage.
// A reader compares only results whose version matches its own, so two builds never share one ranking.
export const dailyVersion = (dailyKey, date = new Date()) => `${dailyKey}|${dailyPassage(date).textVersion}`;

// What an account publishes about itself. The daily result is today's best completed attempt at the
// daily conditions on a physical keyboard, as the Daily panel counts it, with the number of completed
// attempts beside it. Practice time is every completed, uninterrupted run since Monday 00:00 UTC.
export function boardSummary(runs, dailyKey, date = new Date()) {
  const day = utcDay(date);
  const start = weekStart(date);
  const from = Date.parse(`${start}T00:00:00Z`);
  const daily = runs.filter((run) => run.kind === 'daily' && validRun(run) && run.challengeDate === day
    && conditionKey(run.conditions) === dailyKey && run.score?.wpm <= MAX_WPM);
  const best = [...daily].sort((a, b) => b.score.wpm - a.score.wpm || b.score.accuracy - a.score.accuracy)[0];
  const week = runs.filter((run) => validRun(run) && run.at && Date.parse(run.at) >= from && Date.parse(run.at) < from + 7 * DAY_MS);
  const ms = week.reduce((sum, run) => sum + Math.max(0, Number(run.elapsedMs) || 0), 0);
  return {
    daily: best ? { date: day, version: dailyVersion(dailyKey, date), wpm: best.score.wpm, accuracy: best.score.accuracy, attempts: Math.min(daily.length, MAX_ATTEMPTS) } : null,
    week: { start, seconds: Math.min(Math.round(ms / 1000), 7 * DAY_MS / 1000), runs: Math.min(week.length, MAX_RUNS) },
  };
}

// Runs from `since` on (the time of the latest clear, as the service holds it), or all of them when there is none.
export function runsSince(runs, since) {
  const from = since ? Date.parse(since) : Number.NaN;
  return Number.isNaN(from) ? runs : runs.filter((run) => run.at && Date.parse(run.at) >= from);
}

// Under a minute in seconds, then minutes: one decimal below ten, whole above. Never rounded up.
export function practiceTime(seconds) {
  if (!seconds) return { value: '0', unit: 'min' };
  if (seconds < 60) return { value: String(seconds), unit: 's' };
  const minutes = seconds / 60;
  return { value: minutes < 10 ? (Math.floor(minutes * 10) / 10).toFixed(1) : String(Math.floor(minutes)), unit: 'min' };
}

const label = (row) => (row.self ? 'You' : row.name || 'Friend');
// Level rows list you first, then by name.
const byName = (a, b) => Number(Boolean(b.self)) - Number(Boolean(a.self)) || label(a).localeCompare(label(b));

// Highest daily wpm first (accuracy breaks a tie, as on race results); nobody yet goes last.
export function dailyOrder(rows) {
  return [...rows].sort((a, b) => Number(Boolean(b.daily)) - Number(Boolean(a.daily))
    || (b.daily?.wpm ?? 0) - (a.daily?.wpm ?? 0) || (b.daily?.accuracy ?? 0) - (a.daily?.accuracy ?? 0) || byName(a, b));
}

export function weekOrder(rows) {
  return [...rows].sort((a, b) => (b.week?.seconds ?? -1) - (a.week?.seconds ?? -1) || byName(a, b));
}

const newId = () => crypto.randomUUID();
// An opt-out the service hasn't confirmed yet, kept on this device across reloads until it has.
const optOutKey = (session) => `stilltype-board-optout:${session.user.id}`;
function optOutPending(session) {
  try { return localStorage.getItem(optOutKey(session)) === '1'; } catch { return false; }
}
function rememberOptOut(session, pending) {
  try {
    if (pending) localStorage.setItem(optOutKey(session), '1');
    else localStorage.removeItem(optOutKey(session));
  } catch {}
}
const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

async function call(session, action, data = {}) {
  // Background polls may have rotated the refresh token; the newest stored copy for this account wins.
  const stored = loadSession();
  const active = await freshSession(stored?.user?.id === session.user.id ? stored : session);
  try {
    return await request('/rest/v1/rpc/friends_board', { method: 'POST', token: active.access_token, body: { p_action: action, p_data: data } });
  } catch (error) {
    if (error.status === 404 || /schema cache|could not find.*function/i.test(error.message)) {
      throw new AuthError('The friends board is being set up. Please try again shortly.');
    }
    throw error;
  }
}
export const readBoard = (session) => call(session, 'board');
// Publishing folds the summary into the stored one, keeping whatever another tab or device of the
// account sent that this one lacks. Replacing (after a history clear or its undo) can lower it.
// Publishing and sharing name the latest history clear this tab knows; the service refuses them,
// changing nothing, if it holds another, and its reply names that clear and when it happened. A clear
// sends its own id and the time it happened here; an undo names the clear it undoes.
export const publishSummary = (session, summary, { replace = false } = {}) => call(session, replace ? 'replace' : 'publish', summary);
// Turning sharing on shares this summary (or folds it into the row another device shares); publishing
// and replacing never turn it on. Turning it off leaves only a marker with no numbers.
export const shareSummary = (session, summary) => call(session, 'share', summary);
export const stopSharing = (session) => call(session, 'unshare');

export function createFriendsBoard({ getSession, canPublish, isSharing, setSharing, runs, dailyKey, isRunning, signIn, openOnline, onUndoRefused = () => {} }) {
  let visible = false;
  let loading = false;
  let board = null;
  let generation = 0;
  // The last summary the service accepted in this tab, so an unchanged publish is not sent again.
  let published = '';
  let publishTimer = 0;
  // A run, clear or undo in this tab that the service has not accepted yet; it goes out after the
  // account check, on the next board read, and when the browser comes back online.
  let pending = false;
  // That change includes a history clear ('clear') or its undo ('undo'), so it replaces the stored
  // summary instead of adding to it.
  let replacing = false;
  // The latest history clear on any device, { id, from }, as the service's replies name it. Summaries
  // count only runs from its time on, so a tab that missed a clear elsewhere can't bring cleared runs back.
  let known = null;
  // This tab's own latest clear, { id, from } stamped when it happened here, while the service may still
  // hold it (an undo names it), and the clear before it, whose runs an undo sends again.
  let mine = null;
  let before = null;
  // A quiet line for the board when sharing was turned off on another device.
  let note = '';
  // Bumped by each switch of the sharing setting here, so a reply that crossed one doesn't count.
  let toggles = 0;
  // The switch stays on while turning sharing on is still on its way.
  let turningOn = false;
  // Sharing was turned off here but the service hasn't confirmed it yet: nothing is published, no sharing
  // state from the service is accepted, and the opt-out is sent again before any other board request.
  // Kept across reloads.
  let unsharing = Boolean(getSession() && optOutPending(getSession()));
  // The switch's setting made before the account check: it waits for the check and then applies to the
  // profile the check settles on, which may say otherwise.
  let held = null;
  // The UTC day, by this browser's clock, of the last board received. A new week always begins with a
  // new day. A read that fails leaves it, so the next check tries again.
  let readDay = '';
  const summary = (since = known?.from) => boardSummary(runsSince(runs(), since), dailyKey());
  // Every reply names this account's latest clear.
  function seen(result) {
    if (result && 'clear' in result) known = result.clear;
    return result;
  }

  // Writes go one at a time, in order. One asked for while another is in flight waits for it to settle,
  // then sends the summary as it is by then; an unchanged publish is skipped, so queued changes collapse
  // into one write, and a clear or undo among them makes it a replace. So an earlier publish from this tab
  // can never reach the service after its clear or undo and bring the cleared numbers back.
  let writes = Promise.resolve();
  function enqueue(task) {
    const write = writes.catch(() => {}).then(task);
    writes = write;
    return write;
  }
  const publishChange = (session) => enqueue(() => sendChange(session));
  // Only while sharing, and only after the account check (before it, resume() sends the summary).
  const publishIfSharing = (session) => (canPublish() && isSharing() && !unsharing ? publishChange(session).catch(() => null) : null);

  // Stops publishing at once.
  function forget() {
    clearTimeout(publishTimer);
    pending = false;
    replacing = false;
    published = '';
    mine = null;
  }
  // The row's removal waits behind any write already on its way. Once the service confirms it, the
  // opt-out is settled here too, unless the switch has moved again since.
  async function removeRow(session) {
    const seq = toggles;
    const result = seen(await enqueue(() => stopSharing(session)));
    if (seq === toggles) {
      unsharing = false;
      rememberOptOut(session, false);
      if (isSharing()) setSharing(false);
    }
    return result;
  }

  // The service knows whether this account shares: another device may have turned it on or off. A
  // reply that crossed a switch here, or came while removing the row is unconfirmed, doesn't count.
  // True when it turned sharing on in this tab, whose summary is then due (now, or after the check).
  function learn(result, seq) {
    if (typeof result?.sharing !== 'boolean' || seq !== toggles || unsharing || held !== null || result.sharing === isSharing()) return false;
    if (!result.sharing) { stoppedElsewhere(); return false; }
    setSharing(true);
    note = '';
    pending = true;
    return true;
  }
  // Sharing was turned off on another device: this tab stops too, and the board says so in one line.
  function stoppedElsewhere() {
    setSharing(false);
    forget();
    note = 'Sharing was turned off on another device.';
  }

  // The service's reply, or null when a publish is unchanged. A replace is always sent: another tab or
  // device may have raised the stored summary since this one last sent the same numbers, and a clear or
  // undo must still set it to exactly this tab's. A clear sends the runs since it happened here, however
  // late it goes out; an undo names that clear and sends the restored runs since the one before. A
  // failure leaves the change pending. Refused, the tab has learned what it missed: sharing off
  // elsewhere, so it stops; or a newer clear elsewhere (which an undo can't reverse, and then says so
  // where it was made), so it sends what is due now, once: its runs since that clear, or a clear of its
  // own queued meanwhile.
  async function sendChange(session, retried = false) {
    if (!isSharing() || unsharing) { forget(); return null; }
    // A clear or undo always has its clear; without one there is nothing to replace, only to publish.
    if (replacing && !mine) replacing = false;
    const mode = replacing;
    // The clear this write is about. A newer clear made while it is on its way is not this write's to settle.
    const sent = mode ? mine : null;
    const value = mode === 'undo' ? { ...summary(before ? before.from : null), undo: mine.id }
      : mode === 'clear' ? { ...summary(mine.from), clear: mine } : { ...summary(), clear: known?.id ?? null };
    const key = JSON.stringify(value);
    pending = false;
    replacing = false;
    if (key === published && !mode) return null;
    let result;
    try {
      result = seen(await publishSummary(session, value, { replace: Boolean(mode) }));
    } catch (error) {
      pending = true;
      replacing ||= mode;
      throw error;
    }
    if (sent && mine === sent && (mode === 'undo' || result?.refused)) mine = null;
    if (result?.refused) {
      if (!result.sharing) { stoppedElsewhere(); return result; }
      if (mode === 'undo') onUndoRefused();
      if (!retried) return sendChange(session, true);
      return result;
    }
    published = key;
    return result;
  }

  function row(entry, value, unit, detail) {
    const item = document.createElement('li');
    item.className = 'board-row';
    if (entry.self) item.dataset.self = 'true';
    const name = document.createElement('span');
    name.className = 'board-name';
    name.textContent = label(entry);
    const measure = document.createElement('span');
    measure.className = 'board-value';
    const number = document.createElement('strong');
    number.className = 'num';
    number.textContent = value;
    measure.append(number);
    if (unit) {
      const suffix = document.createElement('span');
      suffix.className = 'board-unit';
      suffix.textContent = unit;
      measure.append(' ', suffix);
    }
    const note = document.createElement('span');
    note.className = 'board-detail num';
    note.textContent = detail;
    // The spaces keep the row reading as words ("Lin 78 wpm 96% accuracy"); a grid ignores them.
    item.append(name, ' ', measure, ' ', note);
    return item;
  }

  function render(status = '') {
    const signedIn = Boolean(getSession());
    const sharing = signedIn && isSharing() && !unsharing;
    $('friends-board-guest').hidden = signedIn;
    $('refresh-friends-board').hidden = !signedIn;
    $('friends-board-share').hidden = !signedIn;
    $('share-board').checked = held ?? (sharing || turningOn);
    // Not sharing, you see nobody else's row either: the board says so beside the switch.
    $('friends-board-off').hidden = !signedIn || (held ?? (sharing || turningOn));
    $('friends-board-status').textContent = signedIn ? status || (!sharing && !turningOn ? note : '') : '';
    // A daily result from another build (another passage, corpus or scoring) is not compared; its row says so.
    const version = board?.date && dailyVersion(dailyKey(), new Date(`${board.date}T00:00:00Z`));
    const rows = sharing && board?.sharing && board.rows
      ? board.rows.map((entry) => (entry.daily && entry.daily.version !== version ? { ...entry, daily: null, otherVersion: true } : entry))
      : null;
    $('friends-board-lists').hidden = !rows;
    $('friends-board-empty').hidden = !rows || rows.some((entry) => !entry.self);
    if (!rows) return;
    $('board-daily-meta').textContent = `${board.date} · best completed attempt · physical keyboard`;
    $('board-week-meta').textContent = `since monday ${board.weekStart}, 00:00 utc · completed runs`;
    $('board-daily').replaceChildren(...dailyOrder(rows).map((entry) => (entry.daily
      ? row(entry, String(entry.daily.wpm), 'wpm', `${entry.daily.accuracy}% accuracy · ${entry.daily.attempts === 1 ? '1 attempt' : `best of ${entry.daily.attempts}`}`)
      : row(entry, '—', '', entry.otherVersion ? 'another version of the daily · not compared' : 'no completed attempt yet'))));
    $('board-week').replaceChildren(...weekOrder(rows).map((entry) => {
      if (!entry.week) return row(entry, '—', '', 'nothing yet this week');
      const time = practiceTime(entry.week.seconds);
      return row(entry, time.value, time.unit, plural(entry.week.runs, 'run'));
    }));
  }

  // Opening the board sends this tab's summary first whenever it differs from the last one sent here,
  // history loaded from the account included, so your own row is current. The service folds a publish
  // into the stored summary (the better daily, the larger week), so a copy older than another tab's or
  // device's is safe to send. If the publish fails, the board is still read. Before the account check
  // the board is only read, and the summary is sent once the check has settled this tab's copy (resume).
  // aria-disabled, not disabled, while loading: a disabled button would drop keyboard focus.
  async function refresh({ manual = false } = {}) {
    const session = getSession();
    if (!session) { render(); return; }
    const day = utcDay();
    if (!canPublish() && isSharing()) pending = true;
    const current = ++generation;
    const seq = toggles;
    loading = true;
    $('refresh-friends-board').setAttribute('aria-disabled', 'true');
    render(board ? '' : 'Loading the board…');
    try {
      if (unsharing) await removeRow(session);
      let result = (await publishIfSharing(session)) || seen(await readBoard(session));
      // Sharing was turned on elsewhere: this tab's history goes out too.
      if (learn(result, seq)) result = (await publishIfSharing(session)) || result;
      if (current !== generation || seq !== toggles) return;
      board = result;
      readDay = day;
      render(manual ? 'Updated.' : '');
    } catch (failure) {
      if (current !== generation || seq !== toggles) return;
      render(failure.message || 'The friends board is unavailable. Try again.');
    } finally {
      if (current === generation) { loading = false; $('refresh-friends-board').removeAttribute('aria-disabled'); }
    }
  }

  // After a run, or a clear or an undo (replace). Nothing is sent mid-run. A change sent before the account
  // check, or one that failed, stays pending until resume() (the check, or the browser coming back online).
  // Nothing at all while sharing is off.
  function schedulePublish({ replace } = {}) {
    if (!isSharing() || unsharing) return;
    pending = true;
    if (replace === 'clear') {
      // The clear's identity: an id, and the time it happened here, kept however late it goes out.
      if (replacing !== 'clear') before = known;
      mine = { id: newId(), from: new Date().toISOString() };
      replacing = 'clear';
    } else if (replace === 'undo') {
      // A clear that never left this tab and its undo cancel out; the restored summary goes as usual.
      // A clear the board no longer holds (a newer one overtook it) can't be undone there.
      if (replacing === 'clear') { replacing = false; mine = null; } else if (mine) replacing = 'undo'; else setTimeout(onUndoRefused);
    }
    clearTimeout(publishTimer);
    publishTimer = setTimeout(async () => {
      const session = getSession();
      if (!session || !canPublish() || !isSharing()) return;
      if (isRunning()) { schedulePublish(); return; }
      const seq = toggles;
      try {
        const result = await publishChange(session);
        if (!result || seq !== toggles) return;
        learn(result, seq);
        board = result;
        if (visible) render();
      } catch {}
    }, 1500);
  }

  // The switch on the board, and its palette command. Turning sharing on sends this tab's summary and
  // takes effect once the service has it; before the account check it waits for the check (resume), so
  // it sends the checked summary and holds against the profile the check adopts. Turning it off stops
  // publishing at once and removes your row, retrying (resume, the next board read, or the next load) if
  // that fails. Focus stays where it was.
  async function setShare(on, { force = false } = {}) {
    const session = getSession();
    if (!session) { render(); return; }
    if (!canPublish()) {
      held = on;
      if (!on) stopHere(session);
      render(on ? 'Turning sharing on…' : '');
      if (!on) removeRow(session).then(() => render(), () => {});
      return;
    }
    if (!force && on === isSharing() && !turningOn && !unsharing) { render(); return; }
    const seq = ++toggles;
    if (on) {
      turningOn = true;
      unsharing = false;
      rememberOptOut(session, false);
      note = '';
      render('Turning sharing on…');
      try {
        const result = await enqueue(async () => {
          // A clear this tab missed refuses the first try; the second sends the runs since then.
          let reply = null;
          for (let attempt = 0; attempt < 2 && (!reply || reply.refused); attempt += 1) {
            const value = { ...summary(), clear: known?.id ?? null };
            reply = seen(await shareSummary(session, value));
            if (!reply?.refused) published = JSON.stringify(value);
          }
          pending = false;
          replacing = false;
          return reply;
        });
        if (seq !== toggles) return;
        turningOn = false;
        if (result?.refused) { render('Sharing couldn’t be turned on. Try again.'); return; }
        setSharing(true);
        board = result;
        render();
      } catch (failure) {
        if (seq !== toggles) return;
        turningOn = false;
        render(failure.message || 'Sharing couldn’t be turned on. Try again.');
      }
      return;
    }
    stopHere(session);
    render();
    try {
      const result = await removeRow(session);
      if (seq !== toggles) return;
      board = result;
      render('Your row is off the board.');
    } catch (failure) {
      if (seq !== toggles) return;
      unsharing = true;
      render(`${failure.message || 'The board is unavailable.'} Your row comes off once the board can be reached.`);
    }
  }

  // Turning sharing off: nothing more is published, and the opt-out is kept until the service confirms it.
  function stopHere(session) {
    turningOn = false;
    setSharing(false);
    forget();
    unsharing = true;
    rememberOptOut(session, true);
    board = null;
  }

  $('refresh-friends-board').addEventListener('click', () => { if (!loading) refresh({ manual: true }); });
  $('share-board').addEventListener('change', (event) => setShare(event.target.checked));
  $('friends-board-signin').addEventListener('click', signIn);
  $('friends-board-online').addEventListener('click', openOnline);
  render();

  return {
    schedulePublish,
    setShare,
    // After the account check (and when the browser is back online): a switch made before the check
    // now applies to the profile it settled on, and an unconfirmed opt-out goes out first.
    resume() {
      const session = getSession();
      if (held !== null && session) {
        const on = held;
        held = null;
        if (on) setShare(true, { force: true });
        else if (isSharing()) setSharing(false);
      }
      if (unsharing && session) removeRow(session).then(() => { if (visible) refresh(); }, () => {});
      if (pending) schedulePublish();
    },
    // Switching to the board and arriving on the screen can both ask at once; one request answers both.
    show() { if (visible && loading) return; visible = true; refresh(); },
    hide() { visible = false; },
    // A board left open across 00:00 UTC (and so into Monday's new week) reads again once per new day,
    // from the app's periodic check or when the tab comes back; a hidden tab waits for its return.
    // Quietly: no "Updated.", and focus stays put. It sends only what opening the board would.
    rollover() { if (visible && !loading && !document.hidden && getSession() && readDay !== utcDay()) refresh(); },
  };
}
