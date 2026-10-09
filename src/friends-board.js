// The friends board on the Challenge screen: today's daily result and this week's practice time for
// you and the people you chose. The service shows a row only to mutual friends (each on the other's
// list) and never returns an account id or email; rows carry the name on your own list. Each browser
// publishes its own owner's summary, so the numbers are friendly and unverified. Guests publish nothing.
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
export const publishSummary = (session, summary, { replace = false } = {}) => call(session, replace ? 'replace' : 'publish', summary);

export function createFriendsBoard({ getSession, canPublish, runs, dailyKey, isRunning, signIn, openOnline }) {
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
  // That change includes a history clear or undo, so it replaces the stored summary instead of adding to it.
  let replacing = false;
  // The UTC day, by this browser's clock, of the last read. A new week always begins with a new day.
  let readDay = '';
  const summary = () => boardSummary(runs(), dailyKey());

  // Writes go one at a time, in order. One asked for while another is in flight waits for it to settle,
  // then sends the summary as it is by then; an unchanged publish is skipped, so queued changes collapse
  // into one write, and a clear or undo among them makes it a replace. So an earlier publish from this tab
  // can never reach the service after its clear or undo and bring the cleared numbers back.
  let writes = Promise.resolve();
  function publishChange(session) {
    const write = writes.catch(() => {}).then(() => sendChange(session));
    writes = write;
    return write;
  }

  // The service's reply, or null when a publish is unchanged. A replace is always sent: another tab or
  // device may have raised the stored summary since this one last sent the same numbers, and a clear or
  // undo must still set it to exactly this tab's. A failure leaves the change pending.
  async function sendChange(session) {
    const value = summary();
    const key = JSON.stringify(value);
    const replace = replacing;
    pending = false;
    replacing = false;
    if (key === published && !replace) return null;
    try {
      const result = await publishSummary(session, value, { replace });
      published = key;
      return result;
    } catch (error) {
      pending = true;
      replacing ||= replace;
      throw error;
    }
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
    $('friends-board-guest').hidden = signedIn;
    $('refresh-friends-board').hidden = !signedIn;
    $('friends-board-status').textContent = signedIn ? status : '';
    // A daily result from another build (another passage, corpus or scoring) is not compared; its row says so.
    const version = board?.date && dailyVersion(dailyKey(), new Date(`${board.date}T00:00:00Z`));
    const rows = signedIn && board?.rows
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
  // device's is safe to send. If the publish fails, the board is still read. aria-disabled, not
  // disabled, while loading: a disabled button would drop keyboard focus.
  async function refresh({ manual = false } = {}) {
    const session = getSession();
    if (!session) { render(); return; }
    readDay = utcDay();
    const current = ++generation;
    loading = true;
    $('refresh-friends-board').setAttribute('aria-disabled', 'true');
    render(board ? '' : 'Loading the board…');
    try {
      const result = (canPublish() && await publishChange(session).catch(() => null)) || await readBoard(session);
      if (current !== generation) return;
      board = result;
      render(manual ? 'Updated.' : '');
    } catch (failure) {
      if (current !== generation) return;
      render(failure.message || 'The friends board is unavailable. Try again.');
    } finally {
      if (current === generation) { loading = false; $('refresh-friends-board').removeAttribute('aria-disabled'); }
    }
  }

  // After a run, or a clear or an undo (replace). Nothing is sent mid-run. A change sent before the account
  // check, or one that failed, stays pending until resume() (the check, or the browser coming back online).
  function schedulePublish({ replace = false } = {}) {
    pending = true;
    if (replace) replacing = true;
    clearTimeout(publishTimer);
    publishTimer = setTimeout(async () => {
      const session = getSession();
      if (!session || !canPublish()) return;
      if (isRunning()) { schedulePublish(); return; }
      try {
        const result = await publishChange(session);
        if (!result) return;
        board = result;
        if (visible) render();
      } catch {}
    }, 1500);
  }

  $('refresh-friends-board').addEventListener('click', () => { if (!loading) refresh({ manual: true }); });
  $('friends-board-signin').addEventListener('click', signIn);
  $('friends-board-online').addEventListener('click', openOnline);
  render();

  return {
    schedulePublish,
    resume() { if (pending) schedulePublish(); },
    // Switching to the board and arriving on the screen can both ask at once; one request answers both.
    show() { if (visible && loading) return; visible = true; refresh(); },
    hide() { visible = false; },
    // A board left open across 00:00 UTC (and so into Monday's new week) reads again once per new day,
    // from the app's periodic check or when the tab comes back; a hidden tab waits for its return.
    // Quietly: no "Updated.", and focus stays put. It sends only what opening the board would.
    rollover() { if (visible && !loading && !document.hidden && getSession() && readDay !== utcDay()) refresh(); },
  };
}
