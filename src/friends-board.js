// The friends board on the Challenge screen: today's daily result and this week's practice time for
// you and the people you chose. Sharing is opt-in and off by default: only an account that shares sees
// the board, and it sees only mutual friends (each on the other's list) who share too. The service never
// returns an account id or email; rows carry the name on your own list.
// The numbers are a read-only view of each account's own synced profile row: every profile save writes
// a summary of exactly the copy it saves into the row's `board` column, stamped with the save
// (src/account.js), and the service shows it only while it describes that exact row. So the board shows
// what the row holds, as Progress does, and nothing here keeps clears, clocks or a queue of its own. The
// numbers are reported by browsers, so they are friendly and unverified. Guests have no row.
import { request, freshSession, loadSession, AuthError } from './account.js';
import { conditionKey } from './typing.js';
import { dailyPassage, validRun } from './insights.js';

const DAY_MS = 86400000;
// The service shows nothing outside these, so they are never written.
const MAX_WPM = 400;
const MAX_ATTEMPTS = 1000;
const MAX_RUNS = 10000;
const $ = (id) => document.getElementById(id);

// The summary's shape. A row whose summary is older than this build's is rewritten from the row's own
// data on the next load (src/app.js), so a part added later reaches rows saved before it.
export const BOARD_V = 1;

export const utcDay = (date = new Date()) => date.toISOString().slice(0, 10);

// Monday 00:00 UTC of the week holding `date`, as YYYY-MM-DD.
export function weekStart(date = new Date()) {
  const midnight = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  return utcDay(new Date(midnight - ((date.getUTCDay() + 6) % 7) * DAY_MS));
}

// Which daily a result belongs to: its conditions (corpus and metric version included) and its passage.
// A reader compares only results whose version matches its own, so two builds never share one ranking.
export const dailyVersion = (dailyKey, date = new Date()) => `${dailyKey}|${dailyPassage(date).textVersion}`;

// What an account shows about itself. The daily result is today's best completed attempt at the
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

// The profile row's `board` column: the summary of the runs in the copy being written, and `at`, that
// write's `updated_at`. The service shows it only while the row's `updated_at` is still `at`, so a
// write that leaves it out (an older build) hides it rather than letting it describe another copy.
export const boardColumn = (runs, dailyKey, at) => ({ v: BOARD_V, at, ...boardSummary(runs, dailyKey) });

// Whether a profile row's summary describes that row, in this build's shape.
export const boardCurrent = (row) => Boolean(row?.board?.at) && Date.parse(row.board.at) === Date.parse(row.updated_at)
  && row.board.v >= BOARD_V;

// When to read the board again for the next UTC day: `nextDay` seconds after the reply arrived. The
// service counts them from when it built the reply, so the time the reply took to arrive can only make
// this later than its midnight, never earlier, and this device's clock setting doesn't matter.
export const nextRead = (receivedAt, reply) => (Number.isFinite(reply?.nextDay) ? receivedAt + reply.nextDay * 1000 : null);

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

// Whether the account shares is the service's to say: its membership is the only record, and every board
// reply says. This device keeps what it last read (or last chose) only to show the switch: true, false, or
// null when it has never read the board for this account. It is never synced, so one device can't put
// sharing back on for another. Its tabs share it.
const sharingKey = (session) => `stilltype-board-sharing:${session.user.id}`;
function knownSharing(session) {
  try {
    const value = localStorage.getItem(sharingKey(session));
    return value === '1' ? true : value === '0' ? false : null;
  } catch { return null; }
}
function rememberSharing(session, value) {
  try {
    if (value === null) localStorage.removeItem(sharingKey(session));
    else localStorage.setItem(sharingKey(session), value ? '1' : '0');
  } catch {}
}
// An opt-out the service hasn't confirmed yet, kept on this device across reloads until it has. Any tab
// of the device sends it, before any other board request; the service answers a repeat as done. Until
// then this device's profile saves write no summary (src/app.js), so it shows nothing new.
const optOutKey = (session) => `stilltype-board-optout:${session.user.id}`;
export function optOutPending(session) {
  try { return localStorage.getItem(optOutKey(session)) !== null; } catch { return false; }
}
function rememberOptOut(session, pending) {
  try {
    if (pending) localStorage.setItem(optOutKey(session), '1');
    else localStorage.removeItem(optOutKey(session));
  } catch {}
}
const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

async function call(session, action) {
  // Background polls may have rotated the refresh token; the newest stored copy for this account wins.
  const stored = loadSession();
  const active = await freshSession(stored?.user?.id === session.user.id ? stored : session);
  try {
    return await request('/rest/v1/rpc/friends_board', { method: 'POST', token: active.access_token, body: { p_action: action, p_data: {} } });
  } catch (error) {
    if (error.status === 404 || /schema cache|could not find.*function/i.test(error.message)) {
      throw new AuthError('The friends board is being set up. Please try again shortly.');
    }
    throw error;
  }
}
// No numbers travel: the service reads them from each account's own profile row.
export const readBoard = (session) => call(session, 'board');
export const startSharing = (session) => call(session, 'share');
export const stopSharing = (session) => call(session, 'unshare');

export function createFriendsBoard({ getSession, dailyKey, signIn, openOnline }) {
  let visible = false;
  // Whether this account shares, as this device last knew it (see knownSharing); null until it knows.
  let sharing = getSession() ? knownSharing(getSession()) : null;
  // Signed out: this device stops keeping whether the account shares.
  let closed = false;
  const isSharing = () => sharing === true;
  function setSharing(value) {
    sharing = value;
    const session = getSession();
    if (session && !closed) rememberSharing(session, value);
  }
  let loading = false;
  let board = null;
  let generation = 0;
  // When to read again for the next UTC day (see nextRead), from the last board received. A read that
  // fails leaves it, so the next check tries again.
  let rollAt = 0;
  // A quiet line for the board when sharing was turned off on another device.
  let note = '';
  // Bumped by each switch of the sharing setting here, so a reply that crossed one doesn't count.
  let toggles = 0;
  // The switch stays on while turning sharing on is still on its way.
  let turningOn = false;
  // Sharing was turned off on this device (in this tab or another) but the service hasn't confirmed it
  // yet: no sharing state from the service is accepted, and the opt-out is sent again before any other
  // board request. Kept across reloads.
  let unsharing = Boolean(getSession() && optOutPending(getSession()));

  // A board the service sent.
  function took(result) {
    board = result;
    rollAt = nextRead(Date.now(), result) ?? rollAt;
  }
  // The account doesn't share (any more). A tab that thought it shared says so in one line; one that
  // didn't know just knows now.
  function notSharing() {
    if (sharing) note = 'Sharing was turned off on another device.';
    setSharing(false);
  }
  // Every reply says whether this account shares, and that is what this tab goes by: another device may
  // have turned it on or off. A reply that crossed a switch here, or came while an opt-out made on this
  // device is unconfirmed, doesn't count. Learning that the account shares never shares anything itself:
  // only the switch sends 'share'.
  function learn(result, seq) {
    if (typeof result?.sharing !== 'boolean' || seq !== toggles || unsharing) return;
    if (!result.sharing) notSharing();
    else if (!sharing) {
      setSharing(true);
      note = '';
    }
  }

  // The switch's requests go one at a time, in order, so the service keeps the last choice made here.
  let switching = Promise.resolve();
  const inTurn = (task) => {
    const next = switching.catch(() => {}).then(task);
    switching = next;
    return next;
  };
  // The opt-out, sent now. Once the service confirms it, it is settled on this device, unless the switch
  // here has moved since it was asked for.
  async function unshareNow(session, seq = toggles) {
    const result = await stopSharing(session);
    if (seq === toggles) {
      unsharing = false;
      rememberOptOut(session, false);
      notSharing();
      note = '';
      took(result);
    }
    return result;
  }
  function removeRow(session) {
    const seq = toggles;
    return inTurn(() => unshareNow(session, seq));
  }
  // Sharing was turned off on this device and the service hasn't confirmed it.
  function optedOut() {
    unsharing = true;
    turningOn = false;
    if (sharing) sharing = false;
    board = null;
  }
  // An opt-out made in another tab, re-read before any board request here: this tab stops too, and sends
  // it with that request. True while one is unconfirmed.
  function optingOut(session) {
    if (!unsharing && optOutPending(session)) {
      optedOut();
      if (visible) render();
    }
    return unsharing;
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

  // What the switch shows: what this device knows, or on while turning sharing on is on its way.
  const switchedOn = () => (isSharing() && !unsharing) || turningOn;

  function render(status = '') {
    const signedIn = Boolean(getSession());
    const shared = signedIn && isSharing() && !unsharing;
    $('friends-board-guest').hidden = signedIn;
    $('refresh-friends-board').hidden = !signedIn;
    $('friends-board-share').hidden = !signedIn;
    $('share-board').checked = switchedOn();
    // Not sharing, you see nobody else's row either: the board says so beside the switch. Until this
    // device has read the board once it can't say either way, so it says nothing.
    $('friends-board-off').hidden = !signedIn || switchedOn() || sharing === null;
    // A live region: written only when the words change, so nothing is announced twice.
    const text = signedIn ? status || (!shared && !turningOn ? note : '') : '';
    if ($('friends-board-status').textContent !== text) $('friends-board-status').textContent = text;
    // A daily result from another build (another passage, corpus or scoring) is not compared; its row says so.
    const version = board?.date && dailyVersion(dailyKey(), new Date(`${board.date}T00:00:00Z`));
    const rows = shared && board?.sharing && board.rows
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

  // Reads the board; it never writes numbers. An unconfirmed opt-out goes first, and its reply is the
  // board. A quiet read (after a profile save, the day check, or one this tab makes by itself) shows no
  // loading line and leaves the status alone if it fails: only opening the board or Refresh reports that.
  // aria-disabled, not disabled, while loading: a disabled button would drop keyboard focus.
  async function refresh({ manual = false, quiet = false } = {}) {
    const session = getSession();
    if (!session) { render(); return; }
    const current = ++generation;
    const seq = toggles;
    loading = true;
    $('refresh-friends-board').setAttribute('aria-disabled', 'true');
    if (!quiet) render(board ? '' : 'Loading the board…');
    try {
      const result = optingOut(session) ? await removeRow(session) : await readBoard(session);
      if (current !== generation || seq !== toggles) return;
      learn(result, seq);
      took(result);
      render(manual ? 'Updated.' : '');
    } catch (failure) {
      if (current !== generation || seq !== toggles || quiet) return;
      render(failure.message || 'The friends board is unavailable. Try again.');
    } finally {
      if (current === generation) { loading = false; $('refresh-friends-board').removeAttribute('aria-disabled'); }
    }
  }

  // The switch on the board, and its palette command: the only way this device shares or stops. Turning
  // sharing on makes this account a member, and your row shows whatever your profile row holds. Turning
  // it off takes you off the board, retrying (resume, the next board request in any tab, or the next
  // load) if that fails. Focus stays where it was.
  async function setShare(on) {
    const session = getSession();
    if (!session) { render(); return; }
    if (on === sharing && !turningOn && !unsharing) { render(); return; }
    const seq = ++toggles;
    if (on) {
      turningOn = true;
      note = '';
      render('Turning sharing on…');
      try {
        // An opt-out still kept on this device goes first, and stays kept until the service confirms it,
        // so a share that never gets through leaves the account as the switch then shows: off.
        const result = await inTurn(async () => {
          if (optOutPending(session)) await unshareNow(session, seq);
          return startSharing(session);
        });
        if (seq !== toggles) return;
        turningOn = false;
        unsharing = false;
        setSharing(true);
        took(result);
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
      await removeRow(session);
      if (seq !== toggles) return;
      render('Your row is off the board.');
    } catch (failure) {
      if (seq !== toggles) return;
      // Another tab may have sent it meanwhile, and settled it.
      unsharing = optOutPending(session);
      render(unsharing ? `${failure.message || 'The board is unavailable.'} Your row comes off once the board can be reached.` : 'Your row is off the board.');
    }
  }

  // Turning sharing off here: the opt-out is kept until the service confirms it.
  function stopHere(session) {
    rememberOptOut(session, true);
    setSharing(false);
    optedOut();
  }

  // Another tab of this browser changed what this device keeps: an opt-out (made, or settled), or
  // whether the account shares.
  function onStorage(event) {
    const session = getSession();
    if (!session || closed || !event.key) return;
    if (event.key === optOutKey(session)) {
      if (event.newValue) optingOut(session);
      else if (unsharing) {
        // Settled there: off the board now, unless that tab turned sharing back on.
        unsharing = false;
        sharing = knownSharing(session);
      }
    } else if (event.key === sharingKey(session)) {
      if (unsharing || turningOn) return;
      const value = knownSharing(session);
      if (value === sharing) return;
      sharing = value;
      note = '';
      if (value && visible) {
        // Turned on there: the switch shows it at once, and the board reads again to show the rows.
        board = null;
        render();
        refresh({ quiet: true });
        return;
      }
    } else return;
    if (visible) render();
  }

  $('refresh-friends-board').addEventListener('click', () => { if (!loading) refresh({ manual: true }); });
  $('share-board').addEventListener('change', (event) => setShare(event.target.checked));
  $('friends-board-signin').addEventListener('click', signIn);
  $('friends-board-online').addEventListener('click', openOnline);
  addEventListener('storage', onStorage);
  render();

  return {
    setShare,
    // After the account check (and when the browser is back online): an unconfirmed opt-out goes out. A
    // device that has never read the board for this account reads it once, quietly, to learn whether it
    // shares; one that knows learns of changes elsewhere from its next board request.
    resume() {
      const session = getSession();
      if (!session) return;
      if (optingOut(session)) removeRow(session).then(() => { if (visible) refresh({ quiet: true }); }, () => {});
      else if (sharing === null && !turningOn && !loading) refresh({ quiet: true });
    },
    // A profile save (or a repair of its summary) reached the account: an open board reads it, quietly.
    pushed() { if (visible && getSession()) refresh({ quiet: true }); },
    // What the switch shows: true or false, or null while this device doesn't know yet.
    get sharing() {
      if (!getSession()) return null;
      return !turningOn && !unsharing && sharing === null ? null : switchedOn();
    },
    // Signing out: what this device knew of the account's sharing goes with it. An opt-out still
    // unconfirmed stays, and goes out the next time the account signs in here.
    signOut() {
      const session = getSession();
      if (session) rememberSharing(session, null);
      closed = true;
    },
    // Switching to the board and arriving on the screen can both ask at once; one request answers both.
    show() { if (visible && loading) return; visible = true; refresh(); },
    hide() { visible = false; },
    // A board left open across 00:00 UTC on the service's clock (and so into Monday's new week) reads
    // again once the day has turned (see nextRead), from the app's periodic check or when the tab comes
    // back; a hidden tab waits for its return. Quietly: no loading line, no "Updated.", no failure line
    // (a failed read is tried again at the next check), and focus stays put.
    rollover() { if (visible && !loading && !document.hidden && getSession() && Date.now() >= rollAt) refresh({ quiet: true }); },
  };
}
