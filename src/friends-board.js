// The friends board on the Challenge screen: today's daily result, this week's practice time and each
// person's best on each test shape, for you and the people you chose. Sharing is opt-in and off by
// default: only an account that shares sees the board, and it sees only mutual friends (each on the
// other's list) who share too. The service never returns an account id or email; rows carry the name on
// your own list.
// The numbers are a read-only view of each account's own synced profile row: every profile save writes
// a summary of exactly the copy it saves into the row's `board` column, stamped with the save
// (src/account.js), and the service shows it only while it describes that exact row. So the board shows
// what the row holds, as Progress does, and nothing here keeps clears, clocks or a queue of its own. The
// numbers are reported by browsers, so they are friendly and unverified. Guests have no row.
import { request, freshSession, loadSession, AuthError } from './account.js';
import { CORPUS_VERSION, CORRECTION_POLICIES, INPUT_CLASSES, METRIC_VERSION, QUOTE_DIFFICULTIES, QUOTE_LENGTHS, TEST_COUNTS, TEST_DURATIONS,
  conditionKey } from './typing.js';
import { wordListIds } from './words.js';
import { dailyPassage, trendRun, validRun } from './insights.js';

const DAY_MS = 86400000;
// The service shows nothing outside these, so they are never written.
const MAX_WPM = 400;
const MAX_ATTEMPTS = 1000;
const MAX_RUNS = 10000;
export const MAX_SHAPES = 16;
// A plus joins the text part's settings (`plain+numbers`), so it is allowed too.
const KEY_PATTERN = /^[A-Za-z0-9:._+-]{1,200}$/;
// The app's own test shapes: timed, word-count and quote tests.
const SHAPE_MODES = ['time', 'words', 'quote'];
const $ = (id) => document.getElementById(id);

// The summary's shape. A row whose summary is older than this build's is rewritten from the row's own
// data on the next load (src/app.js), so a part added later reaches rows saved before it.
// 2 added `bests`.
export const BOARD_V = 2;

export const utcDay = (date = new Date()) => date.toISOString().slice(0, 10);

// Monday 00:00 UTC of the week holding `date`, as YYYY-MM-DD.
export function weekStart(date = new Date()) {
  const midnight = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  return utcDay(new Date(midnight - ((date.getUTCDay() + 6) % 7) * DAY_MS));
}

// Which daily a result belongs to: its conditions (corpus and metric version included) and its passage.
// A reader compares only results whose version matches its own, so two builds never share one ranking.
export const dailyVersion = (dailyKey, date = new Date()) => `${dailyKey}|${dailyPassage(date).textVersion}`;

// Whether a run can stand as a best on the board: exactly the runs that can set a personal best in the
// app (a completed, uninterrupted practice test or retest; never a drill, daily, race or anything
// interrupted), on one of its own test shapes, dated, and within the limits the service shows.
export function shareableBest(run) {
  return trendRun(run) && SHAPE_MODES.includes(run.conditions?.mode) && Boolean(run.at) && !Number.isNaN(Date.parse(run.at))
    && Number.isInteger(run.score?.wpm) && run.score.wpm >= 0 && run.score.wpm <= MAX_WPM
    && Number.isInteger(run.score?.accuracy) && run.score.accuracy >= 0 && run.score.accuracy <= 100
    && KEY_PATTERN.test(conditionKey(run.conditions));
}

// Each test shape's best among `runs`, keyed by its condition key (the shape, corpus and metric
// version): the fastest, then the more accurate, then the earlier. Dated by the UTC day of the run's own
// time, as Progress dates it, so no device's clock, the writer's included, changes it. At most 16
// shapes: the ones this build can compare first, then the ones with the most runs, then the most
// recently run.
export function shapeBests(runs) {
  const shapes = new Map();
  for (const run of runs) {
    if (!shareableBest(run)) continue;
    const at = Date.parse(run.at);
    const key = conditionKey(run.conditions);
    const { wpm, accuracy } = run.score;
    const entry = shapes.get(key) || { runs: 0, last: 0, best: null };
    entry.runs += 1;
    entry.last = Math.max(entry.last, at);
    const best = entry.best;
    if (!best || wpm > best.wpm || (wpm === best.wpm && (accuracy > best.accuracy || (accuracy === best.accuracy && at < best.at)))) {
      entry.best = { wpm, accuracy, at };
    }
    shapes.set(key, entry);
  }
  return Object.fromEntries([...shapes]
    .sort(([keyA, a], [keyB, b]) => Number(Boolean(shapeOf(keyB))) - Number(Boolean(shapeOf(keyA)))
      || b.runs - a.runs || b.last - a.last || (keyA < keyB ? -1 : 1))
    .slice(0, MAX_SHAPES)
    .map(([key, { best }]) => [key, { wpm: best.wpm, accuracy: best.accuracy, date: utcDay(new Date(best.at)) }]));
}

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
// `weeks` holds, for each of the latest weeks (Monday 00:00 UTC) with a run, the time and number of
// completed, uninterrupted runs. `bests` holds each test shape's best (see shapeBests).
export function boardSummary(runs, dailyKey) {
  const dailies = new Map();
  const weeks = new Map();
  for (const run of runs) {
    if (!validRun(run)) continue;
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
      seconds: Math.min(Math.round(weeks.get(start).ms / 1000), 7 * DAY_MS / 1000), runs: Math.min(weeks.get(start).runs, MAX_RUNS) }])),
    bests: shapeBests(runs),
  };
}

// The profile row's `board` column: the summary of the runs in the copy being written, and `at`, that
// write's `updated_at`. The service shows it only while the row's `updated_at` is still `at`, so a
// write that leaves it out (an older build) hides it rather than letting it describe another copy.
export const boardColumn = (runs, dailyKey, at) => ({ v: BOARD_V, at, ...boardSummary(runs, dailyKey) });

// Whether a profile row's summary describes that row, in this build's shape.
export const boardCurrent = (row) => Boolean(row?.board?.at) && Date.parse(row.board.at) === Date.parse(row.updated_at)
  && row.board.v >= BOARD_V;

// The test shape a condition key names, as conditions, when this build writes that key: one of its own
// test modes with only that mode's parts filled in, each a value the app offers (a length from its own
// list, a word list and whether numbers are on, or a quote's length and difficulty; an input and a
// correction policy it records), its corpus and metric version, and the key read back exactly. Otherwise
// null: a key from another build, or one no copy of this build writes, which the board never lists or compares.
export function shapeOf(key) {
  const parts = typeof key === 'string' ? key.split(':') : [];
  if (parts.length !== 11) return null;
  const [mode, duration, count, text, quoteLength, difficulty, wordList, inputClass, correctionPolicy, corpus, metricVersion] = parts;
  // Numbers ride on the text part (`plain+numbers`), and only on generated tests; a quote ignores them.
  const numbers = text.endsWith('+numbers');
  const punctuation = numbers ? text.slice(0, -'+numbers'.length) : text;
  const conditions = { mode, duration: Number(duration) || null, count: Number(count) || null, punctuation: punctuation === 'punctuation',
    numbers, quoteLength: quoteLength || null, difficulty: difficulty || null, wordList: wordList || null, inputClass, correctionPolicy,
    language: 'en', corpus, metricVersion };
  const quote = mode === 'quote';
  const written = SHAPE_MODES.includes(mode)
    && (mode === 'time' ? TEST_DURATIONS.includes(conditions.duration) : !duration)
    && (mode === 'words' ? TEST_COUNTS.includes(conditions.count) : !count)
    && (quote ? QUOTE_LENGTHS.includes(quoteLength) && QUOTE_DIFFICULTIES.includes(difficulty) && !wordList && !numbers
      : !quoteLength && !difficulty && wordListIds.includes(wordList))
    && INPUT_CLASSES.includes(inputClass) && CORRECTION_POLICIES.includes(correctionPolicy)
    && corpus === CORPUS_VERSION && metricVersion === METRIC_VERSION;
  return written && conditionKey(conditions) === key ? conditions : null;
}
// A key's shape without its corpus and metric version, to tell "another version of this shape".
const shapePart = (key) => String(key).split(':').slice(0, 9).join(':');

// The shapes the board can compare: every key this build writes that anyone on the board has a best
// on. Timed tests first, then word counts, then quotes, shortest first, and without numbers before with.
export function boardShapes(rows) {
  const keys = new Set(rows.flatMap((row) => Object.keys(row.bests || {})).filter((key) => shapeOf(key)));
  const length = (shape) => shape.duration || shape.count || 0;
  return [...keys].map((key) => ({ key, conditions: shapeOf(key) })).sort((a, b) => SHAPE_MODES.indexOf(a.conditions.mode) - SHAPE_MODES.indexOf(b.conditions.mode)
    || length(a.conditions) - length(b.conditions) || Number(a.conditions.numbers) - Number(b.conditions.numbers)
    || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

// A shape's description in parts: the app's own (`parts`), and for a quote the punctuation setting its
// key keeps ('on' or 'off'). A quote ignores that setting, so the app doesn't describe it, but two quote
// keys can differ by it alone.
function describedParts(conditions, parts) {
  const part = parts(conditions);
  if (conditions.mode !== 'quote') return part;
  const { language, length, text, ...rest } = part;
  return { language, length, text, setting: conditions.punctuation ? 'on' : 'off', ...rest };
}
// The setting, named short in the picker and in full under it.
const named = (name, value, full = false) => (name === 'setting' ? `punctuation ${full ? 'setting ' : ''}${value}` : value);
// A quote has no word list (its language part is plain "english"), and only a quote has that setting, so
// each is compared, and named, only between the shapes it belongs to.
const belongs = (name, conditions) => (name === 'language' ? conditions.mode !== 'quote' : name !== 'setting' || conditions.mode === 'quote');
// Each listed shape's parts, and which parts tell the listed shapes apart.
function tellApart(shapes, parts) {
  const described = shapes.map((shape) => describedParts(shape.conditions, parts));
  const names = [...new Set(described.flatMap((part) => Object.keys(part)))];
  const differs = new Set(names.filter((name) => new Set(described.filter((part, index) => belongs(name, shapes[index].conditions))
    .map((part) => part[name])).size > 1));
  return { described, names, differs };
}

// Each shape's name in the picker: its length and text first, then whichever other parts of its
// description (a quote's punctuation setting, word list, input, correction policy) differ between the
// shapes listed, so what tells two apart comes before a narrow picker cuts the rest off.
export function shapeLabels(shapes, parts) {
  const { described, names, differs } = tellApart(shapes, parts);
  const order = ['length', 'text', 'setting', ...names].filter((name, index, all) => all.indexOf(name) === index
    && (name === 'length' || name === 'text' || differs.has(name)));
  return described.map((part, index) => order.filter((name) => belongs(name, shapes[index].conditions) && part[name] !== undefined)
    .map((name) => named(name, part[name])).join(' · '));
}

// The full description of the picked shape: the app's own, with the punctuation setting when it tells
// this quote apart from another listed.
export function shapeDescription(shapes, key, parts) {
  const { described, differs } = tellApart(shapes, parts);
  const part = described[shapes.findIndex((shape) => shape.key === key)] || {};
  return Object.entries(part).filter(([name]) => name !== 'setting' || differs.has(name)).map(([name, value]) => named(name, value, true)).join(' · ');
}

// The shape the picker opens on: the one you have the most best-eligible runs on, then the one the most
// people on the board have a best on, then the first listed.
export function defaultShape(shapes, runs, rows) {
  const counts = new Map();
  for (const run of runs) {
    if (!shareableBest(run)) continue;
    const key = conditionKey(run.conditions);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const holders = (key) => rows.filter((row) => row.bests?.[key]).length;
  return [...shapes].sort((a, b) => (counts.get(b.key) || 0) - (counts.get(a.key) || 0) || holders(b.key) - holders(a.key))[0]?.key ?? null;
}

// The rows on one shape: each person's best on exactly that key, the fastest first (accuracy breaks a
// tie), then those without one. A best on the same shape from another build is marked, never compared.
export function bestsOrder(rows, key) {
  const placed = rows.map((row) => {
    const best = row.bests?.[key] ?? null;
    const otherVersion = !best && Object.keys(row.bests || {}).some((other) => other !== key && !shapeOf(other) && shapePart(other) === shapePart(key));
    return { ...row, best, otherVersion };
  });
  return placed.sort((a, b) => Number(Boolean(b.best)) - Number(Boolean(a.best))
    || (b.best?.wpm ?? 0) - (a.best?.wpm ?? 0) || (b.best?.accuracy ?? 0) - (a.best?.accuracy ?? 0) || byName(a, b));
}

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
// of the device sends it, before any other board request; the service answers a repeat as done. Until
// then this device's profile saves write no summary (src/app.js), so it shows nothing new. Each opt-out
// is kept under its own id, and a confirmation settles only the one it was sent for: a reply that
// arrives after sharing was turned back on and off again can't drop the newer opt-out.
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
// the sharing version it is based on (see versionOf).
export const readBoard = (session) => call(session, 'board');
export const startSharing = (session, version) => call(session, 'share', { version });
export const stopSharing = (session) => call(session, 'unshare');

export function createFriendsBoard({ getSession, dailyKey, runs, conditionParts, signIn, openOnline, onShared = () => {} }) {
  let visible = false;
  // Whether this account shares, as this device last knew it (see knownSharing); null until it knows.
  const known = getSession() ? knownSharing(getSession()) : { sharing: null, version: null };
  let sharing = known.sharing;
  // Signed out: this device stops keeping whether the account shares.
  let closed = false;
  const isSharing = () => sharing === true;
  // `at` is the sharing version of the reply that said so, kept beside it for this device's other tabs.
  function setSharing(value, at = null) {
    sharing = value;
    const session = getSession();
    if (session && !closed) rememberSharing(session, value, at);
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

  // A board the service sent.
  function took(result) {
    board = result;
    rollAt = nextRead(result) ?? rollAt;
    if (!sharesWaiting) version = versionOf(result) ?? version;
  }
  // The reply to this tab's own change: one step past the version it knew means nothing else came in
  // between, so the version after it is known too. Anything more stays unknown until this tab takes a
  // board, and a share sent meanwhile is refused rather than counting a change this tab never showed.
  function stepped(result) {
    if (version !== null && versionOf(result) === version + 1) version += 1;
  }
  // The account doesn't share (any more), as this reply says. A tab that thought it shared says so in one
  // line; one that didn't know just knows now.
  function notSharing(result) {
    if (sharing) note = ELSEWHERE;
    setSharing(false, versionOf(result));
  }
  // Every reply says whether this account shares, and that is what this tab goes by: another device may
  // have turned it on or off. A reply that crossed a switch here, or came while an opt-out made on this
  // device is unconfirmed, doesn't count. Learning that the account shares never shares anything itself:
  // only the switch sends 'share'.
  function learn(result, seq) {
    if (typeof result?.sharing !== 'boolean' || seq !== toggles || unsharing) return;
    if (!result.sharing) notSharing(result);
    else {
      if (!sharing) note = '';
      setSharing(true, versionOf(result));
    }
  }

  // The switch's requests go one at a time, in order, so the service keeps the last choice made here.
  let switching = Promise.resolve();
  const inTurn = (task) => {
    const next = switching.catch(() => {}).then(task);
    switching = next;
    return next;
  };
  // The opt-out, sent now. Once the service confirms it, that opt-out is settled on this device. This
  // tab is off the board then, unless its switch has moved since, or a newer opt-out is still kept. What
  // it now knows is kept before the opt-out is settled, so the other tabs, which adopt it once that
  // happens, adopt this reply's version with it.
  async function unshareNow(session, seq = toggles) {
    const id = optOutId(session);
    const result = await stopSharing(session);
    stepped(result);
    const newest = optOutId(session);
    if (seq === toggles && (newest === null || newest === id)) {
      unsharing = false;
      notSharing(result);
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
    renderBests(board.rows);
  }

  // The shape picked in this tab, kept while the board still lists it. Until one is picked the picker
  // opens on the default (see defaultShape).
  let picked = null;
  let listed = '';
  // Bests on one shape at a time: only rows whose key is exactly the picked one are compared.
  function renderBests(rows) {
    const shapes = boardShapes(rows);
    $('board-bests-none').hidden = shapes.length > 0;
    for (const id of ['board-shape-field', 'board-bests-meta', 'board-bests']) $(id).hidden = !shapes.length;
    const select = $('board-shape');
    if (!shapes.length) { select.replaceChildren(); $('board-bests').replaceChildren(); listed = ''; return; }
    const key = shapes.some((shape) => shape.key === picked) ? picked : defaultShape(shapes, runs(), rows);
    const labels = shapeLabels(shapes, conditionParts);
    // Rebuilt only when the shapes or their names change, so a re-read never disturbs the picker.
    const signature = JSON.stringify(shapes.map((shape, index) => [shape.key, labels[index]]));
    if (signature !== listed) {
      listed = signature;
      select.replaceChildren(...shapes.map((shape, index) => {
        const option = document.createElement('option');
        option.value = shape.key;
        option.textContent = labels[index];
        return option;
      }));
    }
    if (select.value !== key) select.value = key;
    $('board-bests-meta').textContent = `${shapeDescription(shapes, key, conditionParts)} · best completed test or retest · dates in utc`;
    $('board-bests').replaceChildren(...bestsOrder(rows, key).map((entry) => (entry.best
      ? row(entry, String(entry.best.wpm), 'wpm', `${entry.best.accuracy}% accuracy · ${entry.best.date}`)
      : row(entry, '—', '', entry.otherVersion ? 'another version of this shape · not compared' : 'no best on this shape yet'))));
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
        if (!result?.sharing) {
          // Refused: sharing was turned off elsewhere after this browser last read it. It stays off.
          unsharing = optOutPending(session);
          setSharing(false, versionOf(result));
          note = ELSEWHERE;
          took(result);
          render();
          return;
        }
        unsharing = false;
        setSharing(true, versionOf(result));
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
  // waiting to go (see version).
  function adopt(kept) {
    sharing = kept.sharing;
    if (!sharesWaiting) version = kept.version;
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
      adopt(kept);
      if (!changed) return;
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
  $('board-shape').addEventListener('change', (event) => { picked = event.target.value; if (board?.rows) renderBests(board.rows); });
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
