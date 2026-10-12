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
import { comparableKind, dailyPassage, validRun } from './insights.js';

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

// How many of the latest days and weeks a summary keeps: the service shows the one that is its own
// today (or this week), so two cover a reader on either side of a midnight.
const PERIODS = 2;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
// The latest PERIODS keys of a map of periods, newest first.
const latest = (periods) => [...periods.keys()].sort().reverse().slice(0, PERIODS);

// What an account shows about itself, from its runs alone. Each run counts in its own day and week, by
// its own record, as the Daily panel and Progress count it: a daily by the UTC date it was played for,
// practice by when it was run. So no device's clock, the writer's included, decides which day or week
// a run belongs to. `days` holds, for each of the latest dates with a daily, the best completed attempt
// at the daily conditions on a physical keyboard, with the number of completed attempts beside it;
// `weeks` holds, for each of the latest weeks (Monday 00:00 UTC) with a run, the time (the runs' time
// summed, then floored to whole completed seconds, never rounded up) and number of completed,
// uninterrupted runs. Custom-text runs count in neither: Progress counts none of them, so the
// board leaves out every kind that is never compared (see comparableKind). They are kept on their own
// small budget, so practice time stays counted from the profile's newest 1,000 comparable runs.
export function boardSummary(runs, dailyKey) {
  const dailies = new Map();
  const weeks = new Map();
  for (const run of runs) {
    if (!validRun(run) || !comparableKind(run.kind)) continue;
    if (run.kind === 'daily' && DATE.test(run.challengeDate ?? '') && conditionKey(run.conditions) === dailyKey && run.score?.wpm <= MAX_WPM) {
      if (!dailies.has(run.challengeDate)) dailies.set(run.challengeDate, []);
      dailies.get(run.challengeDate).push(run);
    }
    const at = run.at ? Date.parse(run.at) : NaN;
    if (Number.isNaN(at)) continue;
    const start = weekStart(new Date(at));
    const week = weeks.get(start) || { ms: 0, runs: 0 };
    week.ms += Math.max(0, Number(run.elapsedMs) || 0);
    week.runs += 1;
    weeks.set(start, week);
  }
  return {
    days: Object.fromEntries(latest(dailies).map((day) => {
      const attempts = dailies.get(day);
      const best = [...attempts].sort((a, b) => b.score.wpm - a.score.wpm || b.score.accuracy - a.score.accuracy)[0];
      return [day, { version: dailyVersion(dailyKey, new Date(`${day}T00:00:00Z`)), wpm: best.score.wpm, accuracy: best.score.accuracy,
        attempts: Math.min(attempts.length, MAX_ATTEMPTS) }];
    })),
    weeks: Object.fromEntries(latest(weeks).map((start) => [start, {
      seconds: Math.min(Math.floor(weeks.get(start).ms / 1000), 7 * DAY_MS / 1000), runs: Math.min(weeks.get(start).runs, MAX_RUNS) }])),
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
// this later than its midnight, never earlier, and this device's clock setting doesn't matter. It is
// kept on both this device's clock (`wall`) and the page's monotonic clock (`mono`), and the read is
// due once either has passed: setting the clock back while the board is open can't hold the read
// back, and a monotonic clock that pauses while the device sleeps can't either. A read that comes early
// is harmless: it shows the same day, with a new `nextDay`.
export const nextRead = (reply, wall = Date.now(), mono = performance.now()) => (Number.isFinite(reply?.nextDay)
  ? { wall: wall + reply.nextDay * 1000, mono: mono + reply.nextDay * 1000 } : null);
export const readDue = (at, wall = Date.now(), mono = performance.now()) => !at || wall >= at.wall || mono >= at.mono;

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
// null when it has never read the board for this account, with the sharing version of the reply that said
// so (see versionOf), or none while an opt-out made here is unconfirmed. It is never synced, so one device
// can't put sharing back on for another. Its tabs share it, both parts in one value ('1' or '0', then
// ':' and the version), so a tab that adopts what another tab read adopts the version that goes with it.
// A value without a version (kept by an earlier build) has none; anything else is nothing known.
export const sharingValue = (value, version) => `${value ? 1 : 0}${Number.isSafeInteger(version) && version >= 0 ? `:${version}` : ''}`;
export function readSharing(value) {
  const kept = /^([01])(?::(\d{1,16}))?$/.exec(typeof value === 'string' ? value : '');
  const version = kept?.[2] === undefined ? null : Number(kept[2]);
  return kept && (version === null || Number.isSafeInteger(version)) ? { sharing: kept[1] === '1', version } : { sharing: null, version: null };
}
const sharingKey = (session) => `stilltype-board-sharing:${session.user.id}`;
function knownSharing(session) {
  try { return readSharing(localStorage.getItem(sharingKey(session))); } catch { return readSharing(null); }
}
function rememberSharing(session, value, version = null) {
  try {
    if (value === null) localStorage.removeItem(sharingKey(session));
    else localStorage.setItem(sharingKey(session), sharingValue(value, version));
  } catch {}
}
// An opt-out the service hasn't confirmed yet, kept on this device across reloads until it has. Any tab
// of the device sends it, before any other board request. Until then this device's profile saves write
// no summary (src/app.js), so it shows nothing new. Each opt-out is kept under its own id, and a
// confirmation settles only the one it was sent for: a reply that arrives after sharing was turned back
// on and off again can't drop the newer opt-out. The id goes with it, so when its reply was lost and it
// is sent again, the service answers the repeat as done without moving the sharing version a second
// time, and a share sent after it counts.
const optOutKey = (session) => `stilltype-board-optout:${session.user.id}`;
function optOutId(session) {
  try { return localStorage.getItem(optOutKey(session)); } catch { return null; }
}
export const optOutPending = (session) => optOutId(session) !== null;
function rememberOptOut(session) {
  try { localStorage.setItem(optOutKey(session), `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`); } catch {}
}
function settleOptOut(session, id) {
  try { if (localStorage.getItem(optOutKey(session)) === id) localStorage.removeItem(optOutKey(session)); } catch {}
}
const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;
const OFF = 'Your row is off the board.';
const PENDING = 'Your row comes off once the board can be reached.';
const ELSEWHERE = 'Sharing was turned off on another device.';

// Every reply carries the account's sharing version: how many shares and opt-outs the service has
// applied. A share is sent with the one its device last read, and counts only if sharing hasn't changed
// since, so a share that arrives late can't undo a newer opt-out from another device. Null when a reply
// has none.
export const versionOf = (reply) => (Number.isSafeInteger(reply?.sharingVersion) && reply.sharingVersion >= 0 ? reply.sharingVersion : null);

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
// No numbers travel: the service reads them from each account's own profile row. A share carries only
// the sharing version it is based on (see versionOf), and an opt-out only the id it is kept under here
// (none when none is kept: the service then takes it as a new one).
export const readBoard = (session) => call(session, 'board');
export const startSharing = (session, version) => call(session, 'share', { version });
export const stopSharing = (session, id = null) => call(session, 'unshare', id ? { id } : {});

export function createFriendsBoard({ getSession, dailyKey, signIn, openOnline, onShared = () => {} }) {
  let visible = false;
  // Whether this account shares, as this device last knew it (see knownSharing); null until it knows.
  const known = getSession() ? knownSharing(getSession()) : { sharing: null, version: null };
  let sharing = known.sharing;
  // The sharing version that went with it (see versionOf): the newest this tab has taken, or null.
  let latest = known.version;
  // Signed out: this device stops keeping whether the account shares.
  let closed = false;
  const isSharing = () => sharing === true;
  // `at` is the sharing version of the reply that said so, kept beside it for this device's other tabs.
  function setSharing(value, at = null) {
    sharing = value;
    if (at !== null) latest = at;
    const session = getSession();
    if (session && !closed) rememberSharing(session, value, at);
  }
  // What this browser's tabs keep (see knownSharing).
  const keptHere = () => (getSession() && !closed ? knownSharing(getSession()) : { sharing: null, version: null });
  // The newest sharing version this browser holds: the one this tab took last, or the one its tabs keep.
  function held() {
    const kept = keptHere().version;
    return latest === null ? kept : kept === null ? latest : Math.max(latest, kept);
  }
  // Sharing state only moves forward. A reply's state counts only if its version is newer than any this
  // browser holds: a slow reply, answered before another tab (or device) changed sharing and arriving
  // after this browser learned of that change, changes neither the switch nor what the tabs keep, and
  // one at the same version changes nothing. This tab then goes by what its tabs keep, if that is newer
  // than what it took itself (it follows none while its own change is on its way). True when it counted.
  function adoptReply(result) {
    const at = versionOf(result);
    const newest = held();
    if (typeof result?.sharing === 'boolean' && (newest === null || (at !== null && at > newest))) {
      setSharing(result.sharing, at);
      return true;
    }
    const kept = keptHere();
    if (kept.sharing !== null && kept.version !== null && (latest === null || kept.version > latest)) {
      sharing = kept.sharing;
      latest = kept.version;
      if (!sharesWaiting) version = kept.version;
    }
    return false;
  }
  let loading = false;
  let board = null;
  let generation = 0;
  // When to read again for the next UTC day (see nextRead), from the last board received. A read that
  // fails leaves it, so the next check tries again.
  let rollAt = null;
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
  // The sharing version a share from this tab is sent with (see versionOf): the one in the last board
  // this tab took, or that another tab of this browser read and this tab adopted with its sharing state
  // (see adopt), which is what its switch showed when it moved. While a share from this tab is waiting
  // to go, nothing but this tab's own changes ahead of it moves it, one step each (see stepped): a board
  // taken or adopted meanwhile may hold an opt-out made after the switch moved. Null until this browser
  // has read one: a share then reads the board first, so none is sent blind.
  let version = known.version;
  // How many shares from this tab are waiting to go, or on their way.
  let sharesWaiting = 0;

  // A board the service sent. One older than what this browser holds is not shown (see adoptReply), and
  // the version a share is sent with never goes back.
  function took(result) {
    const at = versionOf(result);
    const newest = held();
    if (at !== null && newest !== null && at < newest) return;
    board = result;
    rollAt = nextRead(result) ?? rollAt;
    if (!sharesWaiting && at !== null && (version === null || at > version)) version = at;
  }
  // The reply to this tab's own change: one step past the version it knew means nothing else came in
  // between, so the version after it is known too. Anything more stays unknown until this tab takes a
  // board, and a share sent meanwhile is refused rather than counting a change this tab never showed.
  function stepped(result) {
    if (version !== null && versionOf(result) === version + 1) version += 1;
  }
  // Every reply says whether this account shares, and that is what this tab goes by: another device may
  // have turned it on or off. A reply that crossed a switch here, or came while an opt-out made on this
  // device is unconfirmed, doesn't count, and nor does one older than what this browser holds (see
  // adoptReply). A tab that thought it shared and learns it doesn't says so in one line; one that didn't
  // know just knows now. Learning that the account shares never shares anything itself: only the switch
  // sends 'share'.
  function learn(result, seq) {
    if (typeof result?.sharing !== 'boolean' || seq !== toggles || unsharing) return;
    const was = sharing;
    if (!adoptReply(result)) {
      // What another tab kept, taken instead: that tab says what changed.
      if (sharing !== was) note = '';
      return;
    }
    if (!result.sharing && was) note = ELSEWHERE;
    else if (result.sharing && !was) note = '';
  }

  // The switch's requests go one at a time, in order, so the service keeps the last choice made here.
  let switching = Promise.resolve();
  const inTurn = (task) => {
    const next = switching.catch(() => {}).then(task);
    switching = next;
    return next;
  };
  // The opt-out, sent now with the id it is kept under. Once the service confirms it, that opt-out is
  // settled on this device. This tab is off the board then, unless its switch has moved since, or a newer
  // opt-out is still kept. What it now knows is kept before the opt-out is settled, so the other tabs,
  // which adopt it once that happens, adopt this reply's version with it.
  async function unshareNow(session, seq = toggles) {
    const id = optOutId(session);
    const result = await stopSharing(session, id);
    stepped(result);
    const newest = optOutId(session);
    if (seq === toggles && (newest === null || newest === id)) {
      unsharing = false;
      adoptReply(result);
      note = '';
      took(result);
    }
    settleOptOut(session, id);
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

  // The status line last asked for, kept when another tab's change re-renders the board.
  let shown = '';
  function render(status = '') {
    shown = status;
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
  // sharing on makes this account a member, and your row shows whatever your profile row holds, unless
  // sharing was turned off elsewhere since this browser last read it: then the service refuses, and the
  // switch stays off and says so. Turning it off takes you off the board, retrying (resume, the next
  // board request in any tab, or the next load) if that fails. Focus stays where it was.
  async function setShare(on) {
    const session = getSession();
    if (!session) { render(); return; }
    if (on === sharing && !turningOn && !unsharing) { render(); return; }
    const seq = ++toggles;
    if (on) {
      turningOn = true;
      note = '';
      render('Turning sharing on…');
      // An opt-out kept on this device from before this switch goes first, and stays kept until the
      // service confirms it, so a share that never gets through leaves the account as the switch then
      // shows: off. One made after it (switching off again, here or in another tab) goes after it.
      const kept = optOutId(session);
      sharesWaiting += 1;
      try {
        const result = await inTurn(async () => {
          const off = kept !== null && optOutId(session) === kept ? await unshareNow(session, seq) : null;
          // Never blind: a tab that has read no version reads it now (that opt-out's reply is such a read).
          if (version === null) version = versionOf(off ?? await readBoard(session));
          const reply = await startSharing(session, version);
          // A refused share moved nothing.
          if (reply?.sharing) stepped(reply);
          return reply;
        }).finally(() => { sharesWaiting -= 1; });
        if (seq !== toggles) return;
        turningOn = false;
        // What the reply says, unless this browser already holds newer (see adoptReply).
        adoptReply(result);
        if (sharing !== true) {
          // Refused: sharing was turned off elsewhere after this browser last read it. It stays off.
          unsharing = optOutPending(session);
          note = ELSEWHERE;
          took(result);
          render();
          return;
        }
        unsharing = false;
        took(result);
        render();
        // Saves made while an opt-out was unconfirmed wrote no summary: the app writes one from the row.
        onShared();
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
      // Off, unless an opt-out made since (in another tab) is still on its way.
      render(unsharing ? PENDING : OFF);
    } catch (failure) {
      if (seq !== toggles) return;
      // Another tab may have sent it meanwhile, and settled it.
      unsharing = optOutPending(session);
      render(unsharing ? `${failure.message || 'The board is unavailable.'} ${PENDING}` : OFF);
    }
  }

  // Turning sharing off here: the opt-out is kept until the service confirms it.
  function stopHere(session) {
    rememberOptOut(session);
    setSharing(false);
    optedOut();
  }

  // What another tab of this browser read: this tab shows it, and a share from here goes with its
  // version, since that is the state this tab's switch then shows. Not while a share from this tab is
  // waiting to go (see version). One no newer than what this tab took changes nothing (see adoptReply).
  // True when it counted.
  function adopt(kept) {
    if (kept.version !== null && latest !== null && kept.version <= latest) return false;
    sharing = kept.sharing;
    if (kept.version !== null) latest = kept.version;
    if (!sharesWaiting) version = kept.version;
    return true;
  }
  // Another tab of this browser changed what this device keeps: an opt-out (made, or settled), or
  // whether the account shares.
  function onStorage(event) {
    const session = getSession();
    if (!session || closed || !event.key) return;
    if (event.key === optOutKey(session)) {
      if (event.newValue) optingOut(session);
      else if (unsharing) {
        // Settled there: off the board now, unless that tab turned sharing back on. A line here that
        // said it was still on its way says which.
        unsharing = false;
        adopt(knownSharing(session));
        if (shown.endsWith(PENDING)) shown = sharing ? '' : OFF;
      }
    } else if (event.key === sharingKey(session)) {
      if (unsharing || turningOn) return;
      const kept = knownSharing(session);
      const value = kept.sharing;
      const changed = value !== sharing;
      if (!adopt(kept) || !changed) return;
      note = '';
      if (value && visible) {
        // Turned on there: the switch shows it at once, and the board reads again to show the rows.
        board = null;
        render();
        refresh({ quiet: true });
        return;
      }
    } else return;
    // The status line stays: a change made in another tab doesn't take back what this one said.
    if (visible) render(shown);
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
    rollover() { if (visible && !loading && !document.hidden && getSession() && readDue(rollAt)) refresh({ quiet: true }); },
  };
}
