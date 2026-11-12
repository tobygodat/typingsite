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
import { CORPUS_VERSION, CORRECTION_POLICIES, INPUT_CLASSES, METRIC_VERSION, QUOTE_DIFFICULTIES, QUOTE_LENGTHS,
  conditionKey } from './typing.js';
import { isValidLength } from './lengths.js';
import { layoutIds, isDefaultLayout } from './layouts.js';
import { wordListIds } from './words.js';
import { comparableKind, conditionParts, dailyPassage, trendRun, validRun } from './insights.js';
import { Schema } from 'effect';
import { AsyncLifetime, accountLifetime, abortable, WorkCancelled } from './async-runtime.js';
import { decodeReply, errorDetails } from './network.js';
import type { Session } from './network.js';
import { sameSignIn } from './account.js';
import { at as indexed, entry as mapped, isRecord, lookup } from './domain-values.js';
import type { Conditions } from './typing.js';
import type { HistoricalRecord, HydratedProfile } from './profile-types.js';

const BestSchema = Schema.Struct({ wpm: Schema.Number, accuracy: Schema.Number, date: Schema.String });
const DailySchema = Schema.Struct({ version: Schema.String, wpm: Schema.Number, accuracy: Schema.Number, attempts: Schema.Number });
const WeekSchema = Schema.Struct({ seconds: Schema.Number, runs: Schema.Number });

const RowSchema = Schema.Struct({
  self: Schema.optional(Schema.Boolean), id: Schema.optional(Schema.NullOr(Schema.Union([Schema.String, Schema.Number]))), name: Schema.optional(Schema.NullOr(Schema.String)),
  daily: Schema.optional(Schema.NullOr(DailySchema)), week: Schema.optional(Schema.NullOr(WeekSchema)),
  bests: Schema.optional(Schema.NullOr(Schema.Record(Schema.String, BestSchema))),
});

const BoardSchema = Schema.StructWithRest(Schema.Struct({
  sharing: Schema.optional(Schema.Boolean), sharingVersion: Schema.optional(Schema.Number),
  date: Schema.optional(Schema.String), nextDay: Schema.optional(Schema.Number), rows: Schema.optional(Schema.Array(RowSchema)),
}), [Schema.Record(Schema.String, Schema.Unknown)]);

export type BoardReply = typeof BoardSchema.Type;

export type BoardRow = typeof RowSchema.Type & { otherVersion?: boolean };

export interface BoardShape { key: string; conditions: Conditions }

export interface ReadDeadline { wall: number; mono: number }

export interface SharingState { sharing: boolean | null; version: number | null }

export interface FriendsBoardOptions {
  getSession(): Session | null; dailyKey(): string; runs(): HydratedProfile['runs'];
  signIn(): void; openOnline(): void; onShared?(): void;
}

export interface FriendsBoardSnapshot {
  signedIn: boolean; switchedOn: boolean; off: boolean; loading: boolean; status: string;
  date: string; rows: readonly BoardRow[] | null; bestsRows: readonly BoardRow[];
  shapes: readonly BoardShape[]; shapeLabels: readonly string[]; picked: string | null; shapeDescription: string;
}

interface BestCandidate { conditions: HistoricalRecord; at: string; score: { wpm: number; accuracy: number } }

function bestCandidate(run: unknown): BestCandidate | null {
  if (!trendRun(run) || run.fresh === false || !isRecord(run.conditions) || (typeof run.conditions.mode !== 'string' || !SHAPE_MODES.includes(run.conditions.mode))
    || !run.at || Number.isNaN(Date.parse(String(run.at))) || !isRecord(run.score)) return null;
  const { wpm, accuracy } = run.score;

  if (typeof wpm !== 'number' || !Number.isInteger(wpm) || wpm < 0 || wpm > MAX_WPM
    || typeof accuracy !== 'number' || !Number.isInteger(accuracy) || accuracy < 0 || accuracy > 100
    || !KEY_PATTERN.test(conditionKey(run.conditions))) return null;

  return { conditions: run.conditions, at: String(run.at), score: { wpm, accuracy } };
}

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
export const dailyVersion = (dailyKey: string, date = new Date()) => `${dailyKey}|${dailyPassage(date).textVersion}`;

// Whether a run can stand as a best on the board: exactly the runs that can set a personal best in the
// app (a completed, uninterrupted practice test or retest; never a drill, daily, race or anything
// interrupted), and only on fresh text (a run saved before runs recorded that counts as fresh); on one
// of its own test shapes, dated, and within the limits the service shows.
export function shareableBest(run: unknown) {
  return bestCandidate(run) !== null;
}

// Each test shape's best among `runs`, keyed by its condition key (the shape, corpus and metric
// version): the fastest, then the more accurate, then the earlier. Dated by the UTC day of the run's own
// time, as Progress dates it, so no device's clock, the writer's included, changes it. At most 16
// shapes: the ones this build can compare first, then the ones with the most runs, then the most
// recently run.
export function shapeBests(runs: readonly unknown[]) {
  const shapes = new Map<string, { runs: number; last: number; best: { wpm: number; accuracy: number; at: number } }>();

  for (const source of runs) {
    const run = bestCandidate(source);

    if (!run) continue;
    const at = Date.parse(run.at);
    const key = conditionKey(run.conditions);
    const { wpm, accuracy } = run.score;
    const entry = shapes.get(key) || { runs: 0, last: 0, best: { wpm, accuracy, at } };
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
const latest = (periods: ReadonlyMap<string, object>) => [...periods.keys()].sort().reverse().slice(0, PERIODS);

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
// `bests` holds each test shape's best (see shapeBests), which never comes from a custom-text run.
export function boardSummary(runs: readonly unknown[], dailyKey: string) {
  const dailies = new Map<string, { score: { wpm: unknown; accuracy: unknown } }[]>();
  const weeks = new Map<string, { ms: number; runs: number }>();

  for (const run of runs) {
    if (!validRun(run) || !comparableKind(run.kind)) continue;

    const conditions = isRecord(run.conditions) ? run.conditions : undefined;
    const score = isRecord(run.score) ? run.score : undefined;
    const day = String(run.challengeDate ?? '');

    if (run.kind === 'daily' && DATE.test(day) && conditionKey(conditions) === dailyKey && Number(score?.wpm) <= MAX_WPM && score) {
      const attempts = dailies.get(day) ?? [];
      attempts.push({ score: { wpm: score.wpm, accuracy: score.accuracy } });
      dailies.set(day, attempts);
    }

    const at = run.at ? Date.parse(String(run.at)) : NaN;

    if (Number.isNaN(at)) continue;
    const start = weekStart(new Date(at));
    const week = weeks.get(start) || { ms: 0, runs: 0 };
    week.ms += Math.max(0, Number(run.elapsedMs) || 0);
    week.runs += 1;
    weeks.set(start, week);
  }

  return {
    days: Object.fromEntries(latest(dailies).map((day) => {
      const attempts = mapped(dailies, day);
      const best = indexed([...attempts].sort((a, b) => Number(b.score.wpm) - Number(a.score.wpm) || Number(b.score.accuracy) - Number(a.score.accuracy)), 0);

      return [day, { version: dailyVersion(dailyKey, new Date(`${day}T00:00:00Z`)), wpm: best.score.wpm, accuracy: best.score.accuracy,
        attempts: Math.min(attempts.length, MAX_ATTEMPTS) }];
    })),
    weeks: Object.fromEntries(latest(weeks).map((start) => [start, {
      seconds: Math.min(Math.floor(mapped(weeks, start).ms / 1000), 7 * DAY_MS / 1000), runs: Math.min(mapped(weeks, start).runs, MAX_RUNS) }])),
    bests: shapeBests(runs),
  };
}

// The profile row's `board` column: the summary of the runs in the copy being written, and `at`, that
// write's `updated_at`. The service shows it only while the row's `updated_at` is still `at`, so a
// write that leaves it out (an older build) hides it rather than letting it describe another copy.
export const boardColumn = (runs: readonly unknown[], dailyKey: string, at: string) => ({ v: BOARD_V, at, ...boardSummary(runs, dailyKey) });

// Whether a profile row's summary describes that row, in this build's shape.
export function boardCurrent(row: unknown) {
  return isRecord(row) && isRecord(row.board) && Boolean(row.board.at)
    && Date.parse(String(row.board.at)) === Date.parse(String(row.updated_at)) && Number(row.board.v) >= BOARD_V;
}

// The test shape a condition key names, as conditions, when this build writes that key: one of its own
// test modes with only that mode's parts filled in, each a value the app offers (a length from its own
// list, a word list and whether numbers are on, or a quote's length and difficulty; an input and a
// correction policy it records), its corpus and metric version, and the key read back exactly. Otherwise
// null: a key from another build, or one no copy of this build writes, which the board never lists or compares.
export function shapeOf(key: unknown): Conditions | null {
  const parts = typeof key === 'string' ? key.split(':') : [];
  const suffix = parts.splice(11);
  const layoutPart = suffix.at(-1)?.startsWith('layout-') ? suffix.pop() : null;
  const layout = layoutPart?.startsWith('layout-') ? layoutPart.slice(7) : null;

  if (suffix.some((part) => !['strict-space', 'quick-end-off'].includes(part))) return null;

  if (parts.length !== 11 || (layoutPart && (!layoutIds.includes(layout ?? '') || isDefaultLayout(layout)))) return null;
  const [mode = '', duration = '', count = '', text = '', quoteLength = '', difficulty = '', wordList = '', inputClass = '', correctionPolicy = '', corpus = '', metricVersion = ''] = parts;
  // Numbers ride on the text part (`plain+numbers`), and only on generated tests; a quote ignores them.
  const numbers = text.endsWith('+numbers');
  const punctuation = numbers ? text.slice(0, -'+numbers'.length) : text;

  if (mode !== 'time' && mode !== 'words' && mode !== 'quote') return null;

  if (inputClass !== 'physical-keyboard' && inputClass !== 'touch') return null;

  if (correctionPolicy !== 'relaxed' && correctionPolicy !== 'mandatory' && correctionPolicy !== 'no-backspace'
    && correctionPolicy !== 'fail-word' && correctionPolicy !== 'fail-any') return null;

  const conditions: Conditions = { mode, duration: Number(duration) || null, count: Number(count) || null, punctuation: punctuation === 'punctuation',
    numbers, quoteLength: quoteLength || null, difficulty: difficulty || null, wordList: wordList || null, inputClass, correctionPolicy,
    language: 'en', corpus, metricVersion };

  if (layout) conditions.layout = layout;

  if (suffix.includes('strict-space')) conditions.strictSpace = true;

  if (suffix.includes('quick-end-off')) conditions.quickEnd = false;

  const quote = mode === 'quote';

  const written = SHAPE_MODES.includes(mode)
    && (mode === 'time' ? isValidLength('time', conditions.duration) : !duration)
    && (mode === 'words' ? isValidLength('words', conditions.count) : !count)
    && (quote ? QUOTE_LENGTHS.includes(quoteLength) && QUOTE_DIFFICULTIES.includes(difficulty) && !wordList && !numbers
      : !quoteLength && !difficulty && wordListIds.includes(wordList))
    && INPUT_CLASSES.includes(inputClass) && CORRECTION_POLICIES.includes(correctionPolicy)
    && corpus === CORPUS_VERSION && metricVersion === METRIC_VERSION;

  return written && conditionKey(conditions) === key ? conditions : null;
}

// A key's shape without its corpus and metric version, to tell "another version of this shape".
const shapePart = (key: string) => {
  const parts = String(key).split(':');

  return [...parts.slice(0, 9), ...parts.slice(11)].join(':');
};

// The shapes the board can compare: every key this build writes that anyone on the board has a best
// on. Timed tests first, then word counts, then quotes, shortest first, and without numbers before with.
export function boardShapes(rows: readonly BoardRow[]) {
  const keys = new Set(rows.flatMap((row) => Object.keys(row.bests || {})).filter((key) => shapeOf(key)));
  const length = (shape: Conditions) => shape.duration || shape.count || 0;

  return [...keys].flatMap((key) => {
    const conditions = shapeOf(key);

    return conditions ? [{ key, conditions }] : [];
  }).sort((a, b) => SHAPE_MODES.indexOf(String(a.conditions.mode ?? '')) - SHAPE_MODES.indexOf(String(b.conditions.mode ?? ''))
    || length(a.conditions) - length(b.conditions) || Number(a.conditions.numbers) - Number(b.conditions.numbers)
    || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

// A shape's description in parts: the app's own (conditionParts), and for a quote the punctuation setting its
// key keeps ('on' or 'off'). A quote ignores that setting, so the app doesn't describe it, but two quote
// keys can differ by it alone.
function describedParts(conditions: Conditions) {
  const part = conditionParts(conditions);

  if (conditions.mode !== 'quote') return part;
  const { language, length, text, ...rest } = part;

  return { language, length, text, setting: conditions.punctuation ? 'on' : 'off', ...rest };
}

// The setting, named short in the picker and in full under it.
const named = (name: string, value: unknown, full = false) => (name === 'setting' ? `punctuation ${full ? 'setting ' : ''}${value}` : value);

// A quote has no word list (its language part is plain "english"), and only a quote has that setting, so
// each is compared, and named, only between the shapes it belongs to.
const belongs = (name: string, conditions: Conditions) => (name === 'language' ? conditions.mode !== 'quote' : name !== 'setting' || conditions.mode === 'quote');

// Each listed shape's parts, and which parts tell the listed shapes apart.
function tellApart(shapes: readonly BoardShape[]) {
  const described = shapes.map((shape) => describedParts(shape.conditions));
  const names = [...new Set(described.flatMap((part) => Object.keys(part)))];

  const differs = new Set(names.filter((name) => new Set(described.flatMap((part, index) => belongs(name, indexed(shapes, index).conditions) ? [part[name]] : [])).size > 1));

  return { described, names, differs };
}

// Each shape's name in the picker: its length and text first, then whichever other parts of its
// description (a quote's punctuation setting, word list, input, correction policy) differ between the
// shapes listed, so what tells two apart comes before a narrow picker cuts the rest off.
export function shapeLabels(shapes: readonly BoardShape[]) {
  const { described, names, differs } = tellApart(shapes);

  const order = ['length', 'text', 'setting', ...names].filter((name, index, all) => all.indexOf(name) === index
    && (name === 'length' || name === 'text' || differs.has(name)));

  return described.map((part, index) => order
    .flatMap((name) => (belongs(name, indexed(shapes, index).conditions) && part[name] !== undefined ? [named(name, part[name] ?? '')] : []))
    .join(' · '));
}

// What the picker's name for the picked shape leaves out, and only where it isn't the usual: a word list
// other than the top 200, touch input, a correction rule other than continue on error. The layout and
// rules are already in the app's parts only away from their defaults. Versions never differ on the
// board (boardShapes keeps the current ones), so they aren't named.
const USUAL = { language: ['english 200', 'english'], input: ['physical keyboard'], correction: ['continue on error'] };

export function shapeDescription(shapes: readonly BoardShape[], key: string | null) {
  const { described, differs } = tellApart(shapes);
  const index = shapes.findIndex((shape) => shape.key === key);
  const part = described[index] || {};
  const shown = ['length', 'text', 'setting', ...differs].filter((name) => name === 'length' || name === 'text' || differs.has(name));

  return Object.entries(part).filter(([name, value]) => !shown.includes(name) && !['setting', 'corpus', 'metric'].includes(name)
    && !lookup(USUAL, name)?.some((usual) => usual === value)).map(([name, value]) => named(name, value ?? '', true)).join(' · ');
}

// The shape the picker opens on: the one you have the most best-eligible runs on, then the one the most
// people on the board have a best on, then the first listed.
export function defaultShape(shapes: readonly BoardShape[], runs: readonly unknown[], rows: readonly BoardRow[]) {
  const counts = new Map<string, number>();

  for (const source of runs) {
    const run = bestCandidate(source);

    if (!run) continue;
    const key = conditionKey(run.conditions);
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  const holders = (key: string) => rows.filter((row) => row.bests?.[key]).length;

  return [...shapes].sort((a, b) => (counts.get(b.key) || 0) - (counts.get(a.key) || 0) || holders(b.key) - holders(a.key))[0]?.key ?? null;
}

// The rows on one shape: each person's best on exactly that key, the fastest first (accuracy breaks a
// tie), then those without one. A best on the same shape from another build is marked, never compared.
export function bestsOrder<T extends BoardRow>(rows: readonly T[], key: string) {
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
export function nextRead(reply: unknown, wall = Date.now(), mono = performance.now()): ReadDeadline | null {
  return isRecord(reply) && typeof reply.nextDay === 'number' && Number.isFinite(reply.nextDay)
    ? { wall: wall + reply.nextDay * 1000, mono: mono + reply.nextDay * 1000 } : null;
}

export const readDue = (at: ReadDeadline | null, wall = Date.now(), mono = performance.now()) => !at || wall >= at.wall || mono >= at.mono;

// Under a minute in seconds, then minutes: one decimal below ten, whole above. Never rounded up.
export function practiceTime(seconds: number) {
  if (!seconds) return { value: '0', unit: 'min' };

  if (seconds < 60) return { value: String(seconds), unit: 's' };
  const minutes = seconds / 60;

  return { value: minutes < 10 ? (Math.floor(minutes * 10) / 10).toFixed(1) : String(Math.floor(minutes)), unit: 'min' };
}

const label = (row: BoardRow) => (row.self ? 'You' : row.name || 'Friend');

// Level rows list you first, then by name.
const byName = (a: BoardRow, b: BoardRow) => Number(Boolean(b.self)) - Number(Boolean(a.self)) || label(a).localeCompare(label(b));

// Highest daily wpm first (accuracy breaks a tie, as on race results); nobody yet goes last.
export function dailyOrder<T extends BoardRow>(rows: readonly T[]) {
  return [...rows].sort((a, b) => Number(Boolean(b.daily)) - Number(Boolean(a.daily))
    || (b.daily?.wpm ?? 0) - (a.daily?.wpm ?? 0) || (b.daily?.accuracy ?? 0) - (a.daily?.accuracy ?? 0) || byName(a, b));
}

export function weekOrder<T extends BoardRow>(rows: readonly T[]) {
  return [...rows].sort((a, b) => (b.week?.seconds ?? -1) - (a.week?.seconds ?? -1) || byName(a, b));
}

// Whether the account shares is the service's to say: its membership is the only record, and every board
// reply says. This device keeps what it last read (or last chose) only to show the switch: true, false, or
// null when it has never read the board for this account, with the sharing version of the reply that said
// so (see versionOf), or none while an opt-out made here is unconfirmed. It is never synced, so one device
// can't put sharing back on for another. Its tabs share it, both parts in one value ('1' or '0', then
// ':' and the version), so a tab that adopts what another tab read adopts the version that goes with it.
// A value without a version (kept by an earlier build) has none; anything else is nothing known.
export const sharingValue = (value: boolean, version: number | null) => `${value ? 1 : 0}${version !== null && Number.isSafeInteger(version) && version >= 0 ? `:${version}` : ''}`;

export function readSharing(value: unknown): SharingState {
  const kept = /^([01])(?::(\d{1,16}))?$/.exec(typeof value === 'string' ? value : '');
  const version = kept?.[2] === undefined ? null : Number(kept[2]);

  return kept && (version === null || Number.isSafeInteger(version)) ? { sharing: kept[1] === '1', version } : { sharing: null, version: null };
}

const sharingKey = (session: Session) => `stilltype-board-sharing:${session.user.id}`;

function knownSharing(session: Session) {
  try { return readSharing(localStorage.getItem(sharingKey(session))); } catch { return readSharing(null); }
}

function rememberSharing(session: Session, value: boolean | null, version: number | null = null) {
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
// time, and a share sent after it counts. An opt-out is only ever sent with the id it is kept under: where
// this browser can't keep one in localStorage, this page keeps it until it is confirmed (or the page closes).
const optOutKey = (session: Session) => `stilltype-board-optout:${session.user.id}`;
const keptInPage = new Map<string, string>();

function optOutId(session: Session) {
  try {
    const id = localStorage.getItem(optOutKey(session));

    if (id !== null) return id;
  } catch {}

  return keptInPage.get(session.user.id) ?? null;
}

export const optOutPending = (session: Session) => optOutId(session) !== null;

function rememberOptOut(session: Session) {
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

  try {
    localStorage.setItem(optOutKey(session), id);
    keptInPage.delete(session.user.id);
  } catch { keptInPage.set(session.user.id, id); }
}

function settleOptOut(session: Session, id: string) {
  try { if (localStorage.getItem(optOutKey(session)) === id) localStorage.removeItem(optOutKey(session)); } catch {}

  if (keptInPage.get(session.user.id) === id) keptInPage.delete(session.user.id);
}

const OFF = 'Your row is off the board.';
const PENDING = 'Your row comes off once the board can be reached.';
const ELSEWHERE = 'Sharing was turned off on another device.';

// Every reply carries the account's sharing version: how many shares and opt-outs the service has
// applied. A share is sent with the one its device last read, and counts only if sharing hasn't changed
// since, so a share that arrives late can't undo a newer opt-out from another device. Null when a reply
// has none.
export function versionOf(reply: unknown): number | null {
  return isRecord(reply) && typeof reply.sharingVersion === 'number' && Number.isSafeInteger(reply.sharingVersion)
    && reply.sharingVersion >= 0 ? reply.sharingVersion : null;
}

async function call(session: Session, action: string, data: { version?: number | null; id?: string } = {}, signal?: AbortSignal) {
  const lifetime = accountLifetime();
  const stored = loadSession();
  const active = await freshSession(stored?.user.id === session.user.id ? stored : session, { signal });

  try {
    return decodeReply(BoardSchema, await request('/rest/v1/rpc/friends_board', {
      method: 'POST', token: active?.access_token, signal, lifetime, body: { p_action: action, p_data: data },
    }));
  } catch (cause) {
    const error = errorDetails(cause);

    if (error.status === 404 || /schema cache|could not find.*function/i.test(error.message)) {
      throw new AuthError('The friends board is being set up. Please try again shortly.');
    }

    throw error;
  }
}

// No numbers travel: the service reads them from each account's own profile row. A share carries only
// the sharing version it is based on (see versionOf), and an opt-out only the id it is kept under here
// (the service takes one without a valid id as a new opt-out; the board never sends one).
export const readBoard = (session: Session, signal?: AbortSignal) => call(session, 'board', {}, signal);
export const startSharing = (session: Session, version: number | null, signal?: AbortSignal) => call(session, 'share', { version }, signal);
export const stopSharing = (session: Session, id: string | null = null, signal?: AbortSignal) => call(session, 'unshare', id ? { id } : {}, signal);

export function createFriendsBoard(initial?: FriendsBoardOptions) {
  let options: FriendsBoardOptions = initial ?? { getSession: () => null, dailyKey: () => '', runs: () => [], signIn: () => {}, openOnline: () => {} };
  const getSession = () => options.getSession();
  const dailyKey = () => options.dailyKey();
  const runs = () => options.runs();
  const onShared = () => options.onShared?.();
  let identity = getSession();
  let lifetime = new AsyncLifetime(accountLifetime());
  let disposed = false;
  let configured = false;
  const listeners = new Set<() => void>();

  let snapshot: FriendsBoardSnapshot = { signedIn: false, switchedOn: false, off: false, loading: false, status: '',
    date: '', rows: null, bestsRows: [], shapes: [], shapeLabels: [], picked: null, shapeDescription: '' };

  function active(session: Session) {
    return !disposed && !closed && lifetime.active && sameSignIn(session, getSession());
  }

  function requireActive(session: Session) {
    if (!active(session)) throw new WorkCancelled('Board work was cancelled.');
  }

  function requestBoard(session: Session) {
    requireActive(session);

    return lifetime.run(abortable((signal) => readBoard(session, signal), errorDetails));
  }

  function requestShare(session: Session, at: number | null) {
    requireActive(session);

    return lifetime.run(abortable((signal) => startSharing(session, at, signal), errorDetails));
  }

  function requestUnshare(session: Session, id: string) {
    requireActive(session);

    return lifetime.run(abortable((signal) => stopSharing(session, id, signal), errorDetails));
  }

  let visible = false;
  // Whether this account shares, as this device last knew it (see knownSharing); null until it knows.
  const known = identity ? knownSharing(identity) : { sharing: null, version: null };
  let sharing = known.sharing;
  // The sharing version that went with it (see versionOf): the newest this tab has taken, or null.
  let latest = known.version;
  // Signed out: this device stops keeping whether the account shares.
  let closed = false;
  const isSharing = () => sharing === true;

  // `at` is the sharing version of the reply that said so, kept beside it for this device's other tabs.
  function setSharing(value: boolean | null, at: number | null = null) {
    sharing = value;

    if (at !== null) latest = at;
    const session = getSession();

    if (session && !closed) rememberSharing(session, value, at);
  }

  // What this browser's tabs keep (see knownSharing).
  const keptHere = () => (identity && !closed ? knownSharing(identity) : { sharing: null, version: null });

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
  function adoptReply(result: BoardReply) {
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
  let board: BoardReply | null = null;
  let generation = 0;
  // When to read again for the next UTC day (see nextRead), from the last board received. A read that
  // fails leaves it, so the next check tries again.
  let rollAt: ReadDeadline | null = null;
  // A quiet line for the board when sharing was turned off on another device.
  let note = '';
  // Bumped by each switch of the sharing setting here, so a reply that crossed one doesn't count.
  let toggles = 0;
  // The switch stays on while turning sharing on is still on its way.
  let turningOn = false;
  // Sharing was turned off on this device (in this tab or another) but the service hasn't confirmed it
  // yet: no sharing state from the service is accepted, and the opt-out is sent again before any other
  // board request. Kept across reloads.
  let unsharing = Boolean(identity && optOutPending(identity));
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
  function took(result: BoardReply) {
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
  function stepped(result: BoardReply) {
    if (version !== null && versionOf(result) === version + 1) version += 1;
  }

  // Every reply says whether this account shares, and that is what this tab goes by: another device may
  // have turned it on or off. A reply that crossed a switch here, or came while an opt-out made on this
  // device is unconfirmed, doesn't count, and nor does one older than what this browser holds (see
  // adoptReply). A tab that thought it shared and learns it doesn't says so in one line; one that didn't
  // know just knows now. Learning that the account shares never shares anything itself: only the switch
  // sends 'share'.
  function learn(result: BoardReply, seq: number) {
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
  let switching: Promise<BoardReply | void> = Promise.resolve();

  const inTurn = (task: () => Promise<BoardReply>) => {
    const next = switching.catch(() => {}).then(task);
    switching = next;

    return next;
  };

  // The opt-out, sent now with the id it is kept under. Once the service confirms it, that opt-out is
  // settled on this device. This tab is off the board then, unless its switch has moved since, or a newer
  // opt-out is still kept. What it now knows is kept before the opt-out is settled, so the other tabs,
  // which adopt it once that happens, adopt this reply's version with it. When none is kept any more by
  // the time its turn comes (a share ahead of it, or another tab, sent and settled it), nothing is sent:
  // an opt-out sent then would be a new one, and would undo the share. It reads the board instead.
  async function unshareNow(session: Session, seq = toggles) {
    requireActive(session);
    const id = optOutId(session);

    if (id === null) {
      unsharing = false;

      return requestBoard(session);
    }

    const result = await requestUnshare(session, id);
    requireActive(session);
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

  function removeRow(session: Session) {
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
  // it with that request. One this tab still waits on that is no longer kept was confirmed (by a share
  // ahead of it, or by another tab): there is nothing left to send. True while one is unconfirmed.
  function optingOut(session: Session) {
    const pending = optOutPending(session);

    if (!unsharing && pending) {
      optedOut();

      if (visible) render();
    } else if (unsharing && !pending) unsharing = false;

    return unsharing;
  }

  // What the switch shows: what this device knows, or on while turning sharing on is on its way.
  const switchedOn = () => (isSharing() && !unsharing) || turningOn;

  // The status line last asked for, kept when another tab's change re-renders the board.
  let shown = '';

  let picked: string | null = null;

  function render(status = '') {
    if (disposed) return;
    shown = status;
    const signedIn = Boolean(getSession());
    const shared = signedIn && isSharing() && !unsharing;
    const text = signedIn ? status || (!shared && !turningOn ? note : '') : '';
    const daily = board?.date && dailyVersion(dailyKey(), new Date(`${board.date}T00:00:00Z`));

    const rows = shared && board?.sharing && board.rows
      ? board.rows.map((entry) => entry.daily && entry.daily.version !== daily ? { ...entry, daily: null, otherVersion: true } : entry)
      : null;

    const bestsRows = rows && board?.rows ? board.rows : [];
    const shapes = boardShapes(bestsRows);
    const key = shapes.some((shape) => shape.key === picked) ? picked : defaultShape(shapes, runs(), bestsRows);
    snapshot = { signedIn, switchedOn: switchedOn(), off: signedIn && !switchedOn() && sharing !== null,
      loading, status: text, date: board?.date ?? '', rows, bestsRows, shapes, shapeLabels: shapeLabels(shapes), picked: key,
      shapeDescription: shapeDescription(shapes, key) };

    for (const listener of listeners) listener();
  }

  // Reads the board; it never writes numbers. An unconfirmed opt-out goes first, and its reply is the
  // board. A quiet read (after a profile save, the day check, or one this tab makes by itself) shows no
  // loading line and leaves the status alone if it fails: only opening the board or Refresh reports that.
  // aria-disabled, not disabled, while loading: a disabled button would drop keyboard focus.
  async function refresh({ manual = false, quiet = false } = {}) {
    syncIdentity();
    const session = getSession();

    if (!session || !active(session)) {
      render();

      return;
    }

    const current = ++generation;
    const seq = toggles;
    loading = true;

    if (quiet) render(shown);

    if (!quiet) render(board ? '' : 'Loading the board…');

    try {
      const result = optingOut(session) ? await removeRow(session) : await requestBoard(session);

      if (!active(session) || current !== generation || seq !== toggles) return;
      learn(result, seq);
      took(result);
      render(manual ? 'Updated.' : '');
    } catch (failure) {
      if (!active(session) || current !== generation || seq !== toggles || quiet) return;
      render(errorDetails(failure).message || 'The friends board is unavailable. Try again.');
    } finally {
      if (active(session) && current === generation) { loading = false; render(shown); }
    }
  }

  // The switch on the board, and its palette command: the only way this device shares or stops. Turning
  // sharing on makes this account a member, and your row shows whatever your profile row holds, unless
  // sharing was turned off elsewhere since this browser last read it: then the service refuses, and the
  // switch stays off and says so. Turning it off takes you off the board, retrying (resume, the next
  // board request in any tab, or the next load) if that fails. Focus stays where it was.
  async function setShare(on: boolean) {
    syncIdentity();
    const session = getSession();

    if (!session || !active(session)) {
      render();

      return;
    }

    if (on === sharing && !turningOn && !unsharing) {
      render();

      return;
    }

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
          if (version === null) {
            const reply = off ?? await requestBoard(session);
            requireActive(session);
            version = versionOf(reply);
          }

          const reply = await requestShare(session, version);

          requireActive(session);

          // A refused share moved nothing.
          if (reply?.sharing) stepped(reply);

          return reply;
        }).finally(() => { if (active(session)) sharesWaiting -= 1; });

        if (!active(session) || seq !== toggles) return;
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
        if (!active(session) || seq !== toggles) return;
        turningOn = false;
        // Still waiting on an opt-out only if one is still kept: the share may have failed after the
        // opt-out ahead of it was confirmed (or the share itself may have landed with its reply lost).
        unsharing = optOutPending(session);
        render(errorDetails(failure).message || 'Sharing couldn’t be turned on. Try again.');
      }

      return;
    }

    stopHere(session);
    render();

    try {
      await removeRow(session);

      if (!active(session) || seq !== toggles) return;
      // Off, unless an opt-out made since (in another tab) is still on its way.
      render(unsharing ? PENDING : OFF);
    } catch (failure) {
      if (!active(session) || seq !== toggles) return;
      // Another tab may have sent it meanwhile, and settled it.
      unsharing = optOutPending(session);
      render(unsharing ? `${errorDetails(failure).message || 'The board is unavailable.'} ${PENDING}` : OFF);
    }
  }

  // Turning sharing off here: the opt-out is kept until the service confirms it.
  function stopHere(session: Session) {
    rememberOptOut(session);
    setSharing(false);
    optedOut();
  }

  // What another tab of this browser read: this tab shows it, and a share from here goes with its
  // version, since that is the state this tab's switch then shows. Not while a share from this tab is
  // waiting to go (see version). One no newer than what this tab took changes nothing (see adoptReply).
  // True when it counted.
  function adopt(kept: SharingState) {
    if (kept.version !== null && latest !== null && kept.version <= latest) return false;
    sharing = kept.sharing;

    if (kept.version !== null) latest = kept.version;

    if (!sharesWaiting) version = kept.version;

    return true;
  }

  // Another tab of this browser changed what this device keeps: an opt-out (made, or settled), or
  // whether the account shares.
  function onStorage(event: StorageEvent) {
    const session = getSession();

    if (!session || !active(session) || !event.key) return;

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

  function configure(next: FriendsBoardOptions) {
    if (disposed) return;
    options = next;
    const session = getSession();

    if (identity === null ? session !== null : !sameSignIn(identity, session)) {
      void lifetime.close();
      lifetime = new AsyncLifetime(accountLifetime());
      identity = session;
      const known = session ? knownSharing(session) : { sharing: null, version: null };
      sharing = known.sharing;
      latest = known.version;
      version = known.version;
      closed = false;
      generation += 1;
      toggles += 1;
      board = null;
      rollAt = null;
      note = '';
      loading = false;
      turningOn = false;
      sharesWaiting = 0;
      unsharing = Boolean(session && optOutPending(session));
      switching = Promise.resolve();
    }

    if (!configured) { configured = true; addEventListener('storage', onStorage); }

    render();
  }

  function syncIdentity() {
    const session = getSession();

    if (identity === null ? session !== null : !sameSignIn(identity, session)) configure(options);
  }

  if (initial) configure(initial);

  return {
    configure,
    getSnapshot: () => snapshot,
    subscribeView(listener: () => void) {
      listeners.add(listener);

      return () => { listeners.delete(listener); };
    },
    pick(key: string) { picked = key; render(shown); },
    signIn: () => options.signIn(),
    openOnline: () => options.openOnline(),
    refresh,
    setShare,
    // After the account check (and when the browser is back online): an unconfirmed opt-out goes out. A
    // device that has never read the board for this account reads it once, quietly, to learn whether it
    // shares; one that knows learns of changes elsewhere from its next board request.
    resume() {
      syncIdentity();
      const session = getSession();

      if (!session || !active(session)) return;

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
      generation += 1;
      toggles += 1;
      void lifetime.close();
      board = null;
      sharing = null;
      turningOn = false;
      loading = false;
      render();
    },
    // The account is deleted: nothing of it stays on this device, an unconfirmed opt-out included (the
    // account's board rows went with it).
    forget() {
      const session = getSession();

      if (session) {
        rememberSharing(session, null);

        try { localStorage.removeItem(optOutKey(session)); } catch {}

        keptInPage.delete(session.user.id);
      }

      closed = true;
      generation += 1;
      toggles += 1;
      void lifetime.close();
      board = null;
      sharing = null;
      turningOn = false;
      loading = false;
      render();
    },
    // Switching to the board and arriving on the screen can both ask at once; one request answers both.
    show() {
      syncIdentity();

      if (visible && loading) return;
      visible = true;
      void refresh();
    },
    hide() { visible = false; },
    dispose() {
      disposed = true;
      closed = true;
      generation += 1;
      toggles += 1;
      void lifetime.close();
      removeEventListener('storage', onStorage);
      listeners.clear();
    },
    // A board left open across 00:00 UTC on the service's clock (and so into Monday's new week) reads
    // again once the day has turned (see nextRead), from the app's periodic check or when the tab comes
    // back; a hidden tab waits for its return. Quietly: no loading line, no "Updated.", no failure line
    // (a failed read is tried again at the next check), and focus stays put.
    rollover() { if (visible && !loading && !document.hidden && getSession() && readDue(rollAt)) refresh({ quiet: true }); },
  };
}

export type FriendsBoardController = ReturnType<typeof createFriendsBoard>;
