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

// Runs from `since` on, or all of them when there is none. `since` is the latest clear's time as the
// service holds it; `offset` (the service's clock minus this device's) puts the runs' own times on the
// service's clock first, so neither clock being off lets a run before the clear count.
export function runsSince(runs, since, offset = 0) {
  const from = since ? Date.parse(since) : Number.NaN;
  return Number.isNaN(from) ? runs : runs.filter((run) => run.at && Date.parse(run.at) + offset >= from);
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

// Ids for history clears: random UUIDs (the service checks the shape). randomUUID needs a secure
// context, which plain http on a LAN address is not, so getRandomValues stands in for it there.
export function newId(source = globalThis.crypto) {
  if (typeof source?.randomUUID === 'function') return source.randomUUID();
  const bytes = source.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
// Whether the account shares is the service's to say: its row is the only record, and every board reply
// says. This device keeps what it last read (or last chose) only to show the switch and to know when to
// publish before the next read: true, false, or null when it has never read the board for this account.
// It is never synced, so one device can't put sharing back on for another. Its tabs share it.
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
// of the device sends it; the service answers a repeat as done.
const optOutKey = (session) => `stilltype-board-optout:${session.user.id}`;
function optOutPending(session) {
  try { return localStorage.getItem(optOutKey(session)) !== null; } catch { return false; }
}
function rememberOptOut(session, pending) {
  try {
    if (pending) localStorage.setItem(optOutKey(session), '1');
    else localStorage.removeItem(optOutKey(session));
  } catch {}
}
// Clears and undos the service hasn't confirmed yet, kept on this device across reloads until it has: one
// record per clear (its undo shares its id). Only the tab that made a clear writes its record; any tab
// may send any record, since the service answers a repeat as done, and the tab that gets the service's
// answer removes it.
const replacePrefix = (session) => `stilltype-board-replace:${session.user.id}:`;
function storedReplaces(session) {
  try {
    return Object.keys(localStorage).filter((key) => key.startsWith(replacePrefix(session))).map((key) => {
      const text = localStorage.getItem(key);
      try { return { key, text, record: JSON.parse(text) }; } catch { return null; }
    }).filter((entry) => entry?.record?.replacing && entry.record.mine?.id);
  } catch { return []; }
}
function rememberReplace(key, record) {
  try {
    if (record) localStorage.setItem(key, JSON.stringify(record));
    else localStorage.removeItem(key);
  } catch {}
}
// Removes a record the service has answered, unless its tab has moved on since it was read (from a clear
// to its undo), which is then still to be sent.
function settleReplace(key, text) {
  try { if (localStorage.getItem(key) === text) localStorage.removeItem(key); } catch {}
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
// sends its own id and the time it happened here; an undo names the clear it undoes and the clear before
// it that its runs count from.
export const publishSummary = (session, summary, { replace = false } = {}) => call(session, replace ? 'replace' : 'publish', summary);
// Turning sharing on shares this summary (or folds it into the row another device shares); publishing
// and replacing never turn it on. Turning it off leaves only a marker with no numbers.
export const shareSummary = (session, summary) => call(session, 'share', summary);
export const stopSharing = (session) => call(session, 'unshare');

export function createFriendsBoard({ getSession, canPublish, runs, dailyKey, isRunning, signIn, openOnline, onUndoRefused = () => {} }) {
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
  // The last summary the service accepted in this tab, so an unchanged publish is not sent again.
  let published = '';
  let publishTimer = 0;
  // A run, clear or undo in this tab that the service has not accepted yet; it goes out after the
  // account check, on the next board read, and when the browser comes back online.
  let pending = false;
  // That change includes a history clear ('clear'), its undo ('undo'), or both ('clear+undo': a clear
  // not yet confirmed and then undone, sent in turn since the first may have arrived after all), so it
  // replaces the stored summary instead of adding to it. A clear or undo is kept whatever this tab
  // believes about sharing (another device may have turned it on), until a reply settles it.
  let replacing = false;
  // The latest history clear on any device, { id, from }, as the service's replies name it, its time on
  // the service's clock. Summaries count only runs from then on, so a tab that missed a clear elsewhere
  // can't bring cleared runs back.
  let known = null;
  // The service's clock minus this device's, from the latest reply.
  let offset = 0;
  // This tab's own latest clear, { id, at } with `at` by this device's clock, while the service may still
  // hold it (an undo names it), and the clear before it, whose runs an undo sends again: the latest this
  // tab knew when it cleared, then the one the service names while this tab's clear is the latest.
  // Another tab's clear never takes their place.
  let mine = null;
  let before = null;
  // A quiet line for the board when sharing was turned off on another device.
  let note = '';
  // Bumped by each switch of the sharing setting here, so a reply that crossed one doesn't count.
  let toggles = 0;
  // The switch stays on while turning sharing on is still on its way.
  let turningOn = false;
  // Sharing was turned off on this device (in this tab or another) but the service hasn't confirmed it
  // yet: nothing is published, no sharing state from the service is accepted, and the opt-out is sent
  // again before any other board request. Kept across reloads. A clear or undo made meanwhile is kept:
  // the opt-out landing makes it moot, and turning sharing back on sends it.
  let unsharing = Boolean(getSession() && optOutPending(getSession()));
  // The switch's setting made before the account check: it waits for the check and then applies.
  let held = null;
  // The UTC day, on the service's clock, of the last board received. A new week always begins with a
  // new day. A read that fails leaves it, so the next check tries again.
  let readDay = '';
  const serviceDay = () => utcDay(new Date(Date.now() + offset));
  const summary = (since = known?.from) => boardSummary(runsSince(runs(), since, offset), dailyKey());
  // Every reply names this account's latest clear, the clear before it and the service's time.
  function seen(result) {
    if (result?.now) offset = Date.parse(result.now) - Date.now();
    if (result && 'clear' in result) known = result.clear;
    // While this tab's own clear is the latest, the clear before it is the one the service would put back.
    if (mine && result?.clear?.id === mine.id && 'undo' in result) before = result.undo;
    return result;
  }
  // A board the service sent, and the day it is for.
  function took(result) {
    board = result;
    if (result?.date) readDay = result.date;
  }
  // The record of this tab's own clear or undo still to be sent: written while there is one, removed once
  // it is settled.
  let keptKey = null;
  function keep() {
    const session = getSession();
    if (!session) return;
    const key = replacing && mine ? replacePrefix(session) + mine.id : null;
    if (keptKey && keptKey !== key) rememberReplace(keptKey, null);
    if (key) rememberReplace(key, { replacing, mine, before });
    keptKey = key;
  }
  // Records kept on this device that aren't this tab's own clear (another tab's, or one an earlier load
  // left), oldest first.
  const othersPending = (session) => storedReplaces(session).filter(({ key }) => key !== keptKey)
    .sort((a, b) => Date.parse(a.record.mine.at) - Date.parse(b.record.mine.at));

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
  // Something for the service: an opt-out to send, this tab's summary while sharing, a clear or undo.
  const due = (session) => unsharing || isSharing() || Boolean(replacing && mine) || othersPending(session).length > 0;
  // Only after the account check (before it, resume() sends the summary).
  const publishIfDue = (session) => (canPublish() && due(session) ? publishChange(session).catch(() => null) : null);

  // Stops publishing at once and forgets what was still to be sent.
  function forget() {
    clearTimeout(publishTimer);
    pending = false;
    replacing = false;
    published = '';
    mine = null;
    keep();
  }
  // Stops publishing runs; a clear or undo is kept.
  function pause() {
    clearTimeout(publishTimer);
    published = '';
    pending = Boolean(replacing && mine);
  }
  // The account doesn't share (any more): nothing kept on this device for the board is due. A tab that
  // thought it shared says so in one line; one that didn't know just knows now.
  function notSharing() {
    if (sharing) note = 'Sharing was turned off on another device.';
    setSharing(false);
    forget();
    const session = getSession();
    if (session) for (const { key } of storedReplaces(session)) rememberReplace(key, null);
  }

  // The opt-out, sent now: from the queue (removeRow), or first thing in a write. Once the service
  // confirms it, it is settled on this device, unless the switch here has moved since it was asked for.
  async function unshareNow(session, seq = toggles) {
    const result = seen(await stopSharing(session));
    if (seq === toggles) {
      unsharing = false;
      rememberOptOut(session, false);
      // With the row a marker, every clear or undo kept is moot.
      notSharing();
      note = '';
      took(result);
    }
    return result;
  }
  // The row's removal waits behind any write already on its way.
  function removeRow(session) {
    const seq = toggles;
    return enqueue(() => unshareNow(session, seq));
  }
  // Sharing was turned off on this device and the service hasn't confirmed it: no more publishing here.
  function optedOut() {
    unsharing = true;
    turningOn = false;
    if (sharing) sharing = false;
    pause();
    board = null;
  }
  // An opt-out made in another tab, re-read before anything is published or sent here: this tab stops
  // too, and sends it with its next board request. True while one is unconfirmed.
  function optingOut(session) {
    if (!unsharing && optOutPending(session)) {
      optedOut();
      if (visible) render();
    }
    return unsharing;
  }

  // Every reply says whether this account shares, and that is what this tab goes by: another device may
  // have turned it on or off. A reply that crossed a switch here, or came while an opt-out made on this
  // device is unconfirmed, doesn't count. Learning that the account shares never shares anything itself:
  // only the switch sends 'share'. This tab then publishes into the row that is already there, which an
  // opt-out still on its way from another device turns into a marker when it lands. True when it turned
  // sharing on in this tab, whose summary is then due (now, or after the check).
  function learn(result, seq) {
    if (typeof result?.sharing !== 'boolean' || seq !== toggles || unsharing || held !== null) return false;
    if (!result.sharing) { notSharing(); return false; }
    if (sharing) return false;
    setSharing(true);
    note = '';
    pending = true;
    return true;
  }

  // The clears and undos kept by other tabs or an earlier load, sent before this tab's own writes, oldest
  // first and each as this tab would send its own: a clear with the runs since it happened, an undo with
  // the runs since the clear before it. A failure leaves them kept. False when a reply said the account
  // doesn't share, which settles everything.
  async function sendOthers(session, seq) {
    for (const { key, text, record } of othersPending(session)) {
      const { id, at } = record.mine;
      let base = record.before;
      let result = null;
      if (record.replacing !== 'undo') {
        result = seen(await publishSummary(session, { ...boardSummary(runsSince(runs(), at), dailyKey()),
          clear: { id, at, sent: new Date().toISOString() } }, { replace: true }));
        if (result?.clear?.id === id && 'undo' in result) base = result.undo;
      }
      if (record.replacing !== 'clear' && !(result?.refused && !result.sharing)) {
        // Counted from another clear before it than the service holds, it goes again from that one.
        for (let attempt = 0; attempt < 2; attempt += 1) {
          result = seen(await publishSummary(session, { ...summary(base ? base.from : null), undo: id, before: base?.id ?? null }, { replace: true }));
          if (!result?.refused || !result.sharing || result.clear?.id !== id) break;
          base = result.undo;
        }
      }
      settleReplace(key, text);
      if (result?.refused && !result.sharing) { notSharing(); return false; }
      if (!sharing && result?.sharing && seq === toggles && !unsharing && held === null) {
        setSharing(true);
        note = '';
      }
    }
    return true;
  }

  // The service's reply, or null when nothing of this tab's went out. An opt-out on this device goes
  // first, and nothing else until it lands; then what other tabs left. A replace is always sent: another
  // tab or device may have raised the stored summary since this one last sent the same numbers, and a
  // clear or undo must still set it to exactly this tab's. A clear sends the runs since it happened
  // here, however late it goes out; an undo names that clear and the clear before it, and sends the
  // restored runs since that one. A clear or undo goes out even while this tab doesn't know the account
  // shares: the service refuses it, changing nothing, if it doesn't, and taken, it says the account does.
  // A failure leaves the change pending. Refused, the tab has learned what it missed: sharing off, so it
  // stops; or a newer clear elsewhere (which an undo can't reverse, and then says so where it was made),
  // so it sends what is due now, once: its runs since that clear, or a clear of its own queued meanwhile;
  // or another clear before its own than it counted from, so its undo goes again from that one.
  async function sendChange(session, retried = false) {
    if (optingOut(session)) {
      await unshareNow(session);
      return null;
    }
    const seq = toggles;
    if (!(await sendOthers(session, seq))) return null;
    // A clear or undo always has its clear; without one there is nothing to replace, only to publish.
    if (replacing && !mine) replacing = false;
    if (!isSharing() && !replacing) { forget(); return null; }
    const mode = replacing;
    // The clear this write is about. A newer clear made while it is on its way is not this write's to settle.
    const sent = mode ? mine : null;
    // A clear sends the runs since it happened here (this device's clock on both sides) and its times as
    // this device reads them; the service turns them into its own.
    const value = mode === 'undo' ? { ...summary(before ? before.from : null), undo: mine.id, before: before?.id ?? null }
      : mode ? { ...boardSummary(runsSince(runs(), mine.at), dailyKey()), clear: { id: mine.id, at: mine.at, sent: new Date().toISOString() } }
        : { ...summary(), clear: known?.id ?? null };
    const key = JSON.stringify(value);
    pending = false;
    replacing = false;
    if (key === published && !mode) return null;
    let result;
    try {
      result = seen(await publishSummary(session, value, { replace: Boolean(mode) }));
    } catch (error) {
      pending = true;
      // A clear that didn't get through goes again, then an undo of it made while it was on its way.
      if (mode && mode !== 'undo' && mine === sent && replacing === 'undo') replacing = 'clear+undo';
      else replacing ||= mode;
      keep();
      throw error;
    }
    const ours = Boolean(sent) && mine === sent;
    if (result?.refused) {
      if (!result.sharing) { notSharing(); return result; }
      // An undo of the clear that is still the latest, counted from another clear before it than the one
      // the service holds: the reply names that one (see seen), so the undo goes again, once.
      if (mode === 'undo' && ours && result.clear?.id === sent.id && !retried) {
        replacing = 'undo';
        pending = true;
        keep();
        return sendChange(session, true);
      }
      if (ours) mine = null;
      if (mode === 'undo' && result.clear?.id !== sent.id) onUndoRefused();
      keep();
      if (!retried) return sendChange(session, true);
      return result;
    }
    if (ours && mode === 'undo') mine = null;
    // Taken while this tab didn't know the account shares: now it does.
    if (!sharing && result?.sharing && seq === toggles && !unsharing && held === null) {
      setSharing(true);
      note = '';
    }
    // The clear is in; the undo that followed it goes next.
    if (mode === 'clear+undo' && ours && !replacing) { replacing = 'undo'; keep(); return sendChange(session, retried); }
    keep();
    published = key;
    // A clear the service already had (its reply was lost on the way back) and that a newer clear has
    // overtaken since: answered as done, so the runs since the newer one go out now.
    if (mode === 'clear' && result?.clear?.id !== sent.id && !retried) return sendChange(session, true);
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

  // What the switch shows: a choice made before the account check, then what this device knows.
  const switchedOn = () => held ?? ((isSharing() && !unsharing) || turningOn);

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

  // Opening the board sends this tab's summary first whenever it differs from the last one sent here,
  // history loaded from the account included, so your own row is current. The service folds a publish
  // into the stored summary (the better daily, the larger week), so a copy older than another tab's or
  // device's is safe to send. If the publish fails, the board is still read. Before the account check
  // the board is only read, and the summary is sent once the check has settled this tab's copy (resume).
  // A quiet read (the day check, or one this tab makes by itself) shows no loading line and leaves the
  // status alone if it fails: only opening the board or Refresh reports that.
  // aria-disabled, not disabled, while loading: a disabled button would drop keyboard focus.
  async function refresh({ manual = false, quiet = false } = {}) {
    const session = getSession();
    if (!session) { render(); return; }
    if (!canPublish() && isSharing()) pending = true;
    const current = ++generation;
    const seq = toggles;
    loading = true;
    $('refresh-friends-board').setAttribute('aria-disabled', 'true');
    if (!quiet) render(board ? '' : 'Loading the board…');
    try {
      if (optingOut(session)) await removeRow(session);
      let result = (await publishIfDue(session)) || seen(await readBoard(session));
      // Sharing was turned on elsewhere: this tab's history goes out too.
      if (learn(result, seq)) result = (await publishIfDue(session)) || result;
      if (current !== generation || seq !== toggles) return;
      took(result);
      readDay ||= serviceDay();
      render(manual ? 'Updated.' : '');
    } catch (failure) {
      if (current !== generation || seq !== toggles || quiet) return;
      render(failure.message || 'The friends board is unavailable. Try again.');
    } finally {
      if (current === generation) { loading = false; $('refresh-friends-board').removeAttribute('aria-disabled'); }
    }
  }

  // After a run, or a clear or an undo (replace). Nothing is sent mid-run. A change sent before the account
  // check, or one that failed, stays pending until resume() (the check, or the browser coming back online).
  // A run sends nothing while sharing is off (an opt-out still unconfirmed goes instead); a clear or undo
  // is kept whatever this tab believes, and the service settles it.
  function schedulePublish({ replace } = {}) {
    const session = getSession();
    if (!session || closed) return;
    optingOut(session);
    if (!replace && !due(session)) return;
    pending = true;
    if (replace === 'clear') {
      // The clear's identity: an id, and the time it happened here, kept however late it goes out.
      if (replacing !== 'clear' && replacing !== 'clear+undo') before = known;
      mine = { id: newId(), at: new Date().toISOString() };
      replacing = 'clear';
    } else if (replace === 'undo') {
      // A clear not yet confirmed goes first and its undo after (a clear repeated is answered as done).
      // A clear the board no longer holds (a newer one overtook it) can't be undone there.
      if (replacing === 'clear') replacing = 'clear+undo';
      else if (mine) replacing = 'undo';
      else if (isSharing() && !unsharing) setTimeout(onUndoRefused);
    }
    if (replace) keep();
    clearTimeout(publishTimer);
    publishTimer = setTimeout(async () => {
      const session = getSession();
      if (!session || !canPublish() || !due(session)) return;
      if (isRunning()) { schedulePublish(); return; }
      const seq = toggles;
      try {
        const result = await publishChange(session);
        if (!result || seq !== toggles) return;
        learn(result, seq);
        took(result);
        if (visible) render();
      } catch {}
    }, 1500);
  }

  // The switch on the board, and its palette command: the only way this device shares or stops. Turning
  // sharing on sends this tab's summary and takes effect once the service has it, followed by a clear or
  // undo kept meanwhile; before the account check it waits for the check (resume), so it sends the
  // checked summary. Turning it off stops publishing at once and removes your row, retrying (resume, the
  // next board request in any tab, or the next load) if that fails. Focus stays where it was.
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
    if (!force && on === sharing && !turningOn && !unsharing) { render(); return; }
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
          if (reply?.refused) return { reply, taken: false };
          // Clears and undos kept while sharing was off here go now, so the row is the cleared one.
          if ((replacing && mine) || othersPending(session).length) {
            pending = true;
            try { reply = (await sendChange(session)) || reply; } catch {}
          }
          return { reply, taken: true };
        });
        if (seq !== toggles) return;
        turningOn = false;
        if (!result.taken) { render('Sharing couldn’t be turned on. Try again.'); return; }
        setSharing(true);
        took(result.reply);
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
      unsharing = true;
      render(`${failure.message || 'The board is unavailable.'} Your row comes off once the board can be reached.`);
    }
  }

  // Turning sharing off here: nothing more is published, and the opt-out is kept until the service
  // confirms it.
  function stopHere(session) {
    rememberOptOut(session, true);
    setSharing(false);
    optedOut();
  }

  // Another tab of this browser changed what this device keeps: an opt-out (made, or settled), whether the
  // account shares, or a clear or undo still to be sent.
  let pickUp = 0;
  function onStorage(event) {
    const session = getSession();
    if (!session || closed || !event.key) return;
    if (event.key === optOutKey(session)) {
      if (event.newValue) optingOut(session);
      else if (unsharing) {
        // Settled there: the row is a marker now, unless that tab turned sharing back on.
        unsharing = false;
        sharing = knownSharing(session);
      }
    } else if (event.key === sharingKey(session)) {
      if (unsharing || held !== null || turningOn) return;
      const value = knownSharing(session);
      if (value === sharing) return;
      sharing = value;
      note = '';
      if (!value) pause();
      else if (visible) {
        // Turned on there: this board reads again, so it shows the rows.
        board = null;
        refresh({ quiet: true });
        return;
      }
    } else if (event.key.startsWith(replacePrefix(session))) {
      // Another tab's clear or undo: if it is still kept a little later (that tab may have closed), it
      // goes from here too.
      if (event.newValue) {
        clearTimeout(pickUp);
        pickUp = setTimeout(() => { if (canPublish() && othersPending(session).length) publishChange(session).catch(() => {}); }, 5000);
      }
      return;
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
    schedulePublish,
    setShare,
    // After the account check (and when the browser is back online): sharing turned on before the check
    // now goes out with the checked summary, and an unconfirmed opt-out goes out first, then any clear or
    // undo this device kept. A device that has never read the board for this account reads it once,
    // quietly, to learn whether it shares (and so publish what it has); one that knows learns of changes
    // elsewhere from its next board request.
    resume() {
      const session = getSession();
      if (!session) return;
      if (held !== null) {
        const on = held;
        held = null;
        if (on) setShare(true, { force: true });
      }
      if (optingOut(session)) removeRow(session).then(() => { if (visible) refresh({ quiet: true }); }, () => {});
      else if (sharing === null && !turningOn && !loading) refresh({ quiet: true });
      if (pending || othersPending(session).length) schedulePublish();
    },
    // What the switch shows: true or false, or null while this device doesn't know yet.
    get sharing() {
      if (!getSession()) return null;
      return held === null && !turningOn && !unsharing && sharing === null ? null : switchedOn();
    },
    // Signing out: what this device knew of the account's sharing goes with it. An opt-out, clear or
    // undo still unconfirmed stays, and goes out the next time the account signs in here.
    signOut() {
      const session = getSession();
      if (session) rememberSharing(session, null);
      closed = true;
    },
    // Switching to the board and arriving on the screen can both ask at once; one request answers both.
    show() { if (visible && loading) return; visible = true; refresh(); },
    hide() { visible = false; },
    // A board left open across 00:00 UTC on the service's clock (and so into Monday's new week) reads
    // again once per new day, from the app's periodic check or when the tab comes back; a hidden tab waits
    // for its return. Quietly: no loading line, no "Updated.", no failure line (a failed read is tried
    // again at the next check), and focus stays put. It sends only what opening the board would.
    rollover() { if (visible && !loading && !document.hidden && getSession() && readDay !== serviceDay()) refresh({ quiet: true }); },
  };
}
