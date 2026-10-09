// The friends board for the browser tests: one row per account that shares, shown only to mutual
// friends who share too and labelled with the reader's own name for them. It reads the friend lists
// kept by e2e/fake-races.js. A test can set a summary directly ({ daily, week, bests }) to stand for sharing
// turned on elsewhere; `sharing: false` marks an account that turned it off, `clear` ({ id, from }) its
// latest history clear and `undo` the clear before it (both named in its own replies). supabase/tests/friends-board.sql checks the migration itself; this mirrors its replies.
import { randomUUID } from 'node:crypto';

const DAY_MS = 86400000;
export const utcDay = (date = new Date()) => date.toISOString().slice(0, 10);
export function mondayOf(date = new Date()) {
  const midnight = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  return utcDay(new Date(midnight - ((date.getUTCDay() + 6) % 7) * DAY_MS));
}

const shares = (summary) => Boolean(summary) && summary.sharing !== false;

// As race_private.sent_bests: at most 16 shapes, each a condition key holding exactly a whole wpm of
// 0-400, a whole accuracy of 0-100 and a date no later than tomorrow (UTC). The message the service
// raises, or null when they are fine.
export function invalidBests(bests, today) {
  if (bests === undefined || bests === null) return null;
  if (typeof bests !== 'object' || Array.isArray(bests)) return 'Invalid bests.';
  const entries = Object.entries(bests);
  if (entries.length > 16) return 'Too many bests for the board.';
  const tomorrow = utcDay(new Date(Date.parse(`${today}T00:00:00Z`) + DAY_MS));
  for (const [key, best] of entries) {
    if (!/^[A-Za-z0-9:._-]{1,200}$/.test(key) || !best || typeof best !== 'object' || Array.isArray(best)
      || Object.keys(best).some((field) => !['wpm', 'accuracy', 'date'].includes(field))
      || !Number.isInteger(best.wpm) || best.wpm < 0 || !Number.isInteger(best.accuracy) || best.accuracy < 0
      || typeof best.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(best.date)) return 'Invalid bests.';
    if (best.wpm > 400 || best.accuracy > 100 || best.date > tomorrow) return 'That best is outside the board limits.';
  }
  return null;
}

// As race_private.fold_bests: on each shape the better best stays (faster, then more accurate, then
// the earlier); past 16 shapes, the ones just sent stay, then the most recently set.
export function foldBests(old = {}, sent = {}) {
  const better = (a, b) => a.wpm - b.wpm || a.accuracy - b.accuracy || (a.date < b.date ? 1 : a.date > b.date ? -1 : 0);
  const merged = { ...old };
  for (const [key, best] of Object.entries(sent)) if (!merged[key] || better(best, merged[key]) >= 0) merged[key] = best;
  const kept = Object.entries(merged).sort(([keyA, a], [keyB, b]) => Number(keyB in sent) - Number(keyA in sent)
    || (a.date < b.date ? 1 : a.date > b.date ? -1 : 0) || (keyA < keyB ? -1 : 1)).slice(0, 16);
  return Object.fromEntries(kept);
}

// As race_private.bests_since: none dated before the UTC day of the row's clear, less a day.
export function bestsSince(bests = {}, from = null) {
  if (!from) return bests;
  const floor = utcDay(new Date(Date.parse(from) - DAY_MS));
  return Object.fromEntries(Object.entries(bests).filter(([, best]) => best.date >= floor));
}

export class FakeBoard {
  constructor(auth) {
    this.auth = auth;
    this.summaries = new Map();
    // Every board call's action, in order; the writes the service took (and turning sharing off); and
    // the writes it refused.
    this.calls = [];
    this.published = [];
    this.refused = [];
    // Set to stand in for a project where the migration has not been applied yet.
    this.missing = false;
    // The service's clock; a test that moves the page's clock moves this one with it.
    this.now = () => new Date();
    // Set to a promise to hold the next write: it is stored and answered only once that settles, while
    // later requests go through, as a slow request can on the real service.
    this.holdNext = null;
    // Set to lose the reply to the next write: the service takes it, and the browser gets an error.
    this.dropNextReply = false;
  }

  emailOf(id) { return [...this.auth.users.values()].find((user) => user.id === id)?.email.toLowerCase(); }

  // Accounts on the owner's list, once each: added from a race, or a typed email an account uses.
  listed(owner) {
    const accounts = new Map();
    const rows = [...(this.auth.races.friends.get(owner) || [])].sort((a, b) => Number(Boolean(b.friendId)) - Number(Boolean(a.friendId)));
    for (const friend of rows) {
      const account = friend.friendId || [...this.auth.users.values()].find((user) => user.email.toLowerCase() === friend.email)?.id;
      if (account && account !== owner && !accounts.has(account)) accounts.set(account, friend);
    }
    return accounts;
  }

  // As race_private.board: a publish or share that doesn't name the latest clear is refused, and so is a
  // publish or replace while not sharing, an undo of a clear that isn't the latest, and one whose 'before'
  // isn't the clear it would put back. Otherwise
  // 'publish' (and 'share' while sharing) folds the summary in: the stored daily stays unless the new one
  // is for a later day (today's first) or better on the same daily, and within a week the larger
  // practice time and run count stay, as does the better best on each shape. 'share' while not sharing starts afresh. 'replace' overwrites it:
  // a clear takes effect when it happened after the latest one, keeping its id and the time it happened,
  // turned into the service's time by the gap between when it happened and when it was sent (never later
  // than now), and an undo puts back the clear before. A clear or undo repeated after a lost reply is
  // answered as done: one still the latest (or an undo taken) folds its numbers in as a publish's are;
  // one overtaken since, or a clear that happened before the latest, changes nothing. True when the write was taken (or
  // already was).
  // Bests are then cut to those since the row's clear (bestsSince). Turning sharing off empties them.
  store(caller, action, data) {
    const now = this.now();
    const today = utcDay(now);
    const thisWeek = mondayOf(now);
    const old = this.summaries.get(caller);
    const current = old?.clear ?? null;
    const clear = action === 'replace' && data.clear ? { id: data.clear.id,
      from: new Date(Math.min(Date.parse(data.clear.at) + (now.getTime() - Date.parse(data.clear.sent)), now.getTime())).toISOString() } : null;
    if (action !== 'replace' && (data.clear ?? null) !== (current?.id ?? null)) return false;
    if (!old) {
      if (action !== 'share') return false;
      this.summaries.set(caller, { sharing: true, clear: null, undo: null, seen: [], daily: data.daily || null, week: { ...data.week }, bests: { ...data.bests } });
      return true;
    }
    if (!shares(old) && action !== 'share') return false;
    // A clear applied before and overtaken since (by a newer clear, or its undo) changes nothing.
    if (clear && clear.id !== current?.id && ((old.seen ?? []).includes(clear.id) || (current && Date.parse(clear.from) < Date.parse(current.from)))) return true;
    const repeat = Boolean(clear && clear.id === current?.id) || (action === 'replace' && !clear && data.undo === old.undone);
    if (!repeat && action === 'replace' && !clear && (data.undo !== current?.id || (data.before ?? null) !== (old.undo?.id ?? null))) return false;
    const next = { sharing: true, clear: current, undo: old.undo ?? null, undone: old.undone ?? null, seen: old.seen ?? [], daily: data.daily || null, week: { ...data.week },
      bests: { ...data.bests } };
    if (repeat || (action !== 'replace' && shares(old))) {
      // Today's (or this week's) first, then the later date.
      const ahead = (a, b, latest) => (a === latest) !== (b === latest) ? a === latest : a > b;
      const same = Boolean(old.daily && next.daily && old.daily.date === next.daily.date && old.daily.version === next.daily.version);
      if (same) next.daily = { ...next.daily, attempts: Math.max(old.daily.attempts, next.daily.attempts) };
      const better = same && (old.daily.wpm - next.daily.wpm || old.daily.accuracy - next.daily.accuracy) > 0;
      if (old.daily && (!next.daily || ahead(old.daily.date, next.daily.date, today) || better)) {
        next.daily = { ...old.daily, attempts: same ? next.daily.attempts : old.daily.attempts };
      }
      if (old.week.start === next.week.start) {
        next.week = { start: old.week.start, seconds: Math.max(old.week.seconds, next.week.seconds), runs: Math.max(old.week.runs, next.week.runs) };
      } else if (ahead(old.week.start, next.week.start, thisWeek)) next.week = { ...old.week };
      next.bests = foldBests(old.bests, next.bests);
    } else if (clear) {
      Object.assign(next, { clear, undo: current, undone: null, seen: [clear.id, ...next.seen].slice(0, 20) });
    }
    else if (action === 'replace') Object.assign(next, { clear: old.undo ?? null, undo: null, undone: data.undo });
    next.bests = bestsSince(next.bests, next.clear?.from);
    this.summaries.set(caller, next);
    return true;
  }

  // Another device of the account clears its history now.
  clearElsewhere(user) {
    const old = this.summaries.get(user);
    const clear = { id: randomUUID(), from: this.now().toISOString() };
    this.summaries.set(user, { ...old, clear, undo: old?.clear ?? null, seen: [clear.id, ...(old?.seen ?? [])].slice(0, 20), daily: null,
      week: { start: mondayOf(this.now()), seconds: 0, runs: 0 }, bests: {} });
    return clear;
  }

  board(viewer) {
    const now = this.now();
    const date = utcDay(now);
    const weekStart = mondayOf(now);
    const email = this.emailOf(viewer);
    const own = this.summaries.get(viewer);
    const row = (account, fields) => {
      const summary = this.summaries.get(account);
      return { ...fields, bests: { ...summary?.bests },
        daily: summary?.daily?.date === date
          ? { version: summary.daily.version, wpm: summary.daily.wpm, accuracy: summary.daily.accuracy, attempts: summary.daily.attempts } : null,
        week: summary?.week?.start === weekStart ? { seconds: summary.week.seconds, runs: summary.week.runs } : null };
    };
    // Someone who doesn't share sees nobody, and nobody sees them.
    if (!shares(own)) return { date, weekStart, now: now.toISOString(), sharing: false, clear: own?.clear ?? null, undo: own?.undo ?? null, rows: [] };
    const mutual = [...this.listed(viewer)].filter(([account]) => shares(this.summaries.get(account))
      && (this.auth.races.friends.get(account) || []).some((friend) => friend.friendId === viewer || friend.email === email));
    return { date, weekStart, now: now.toISOString(), sharing: true, clear: own.clear ?? null, undo: own.undo ?? null, rows: [row(viewer, { self: true, id: null, name: null }),
      ...mutual.map(([account, friend]) => row(account, { self: false, id: friend.id, name: friend.name }))
        .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()))] };
  }

  handle(caller, { p_action: action, p_data: data = {} }, reply) {
    this.calls.push(action);
    if (this.missing) return reply(404, { message: 'Could not find the function public.friends_board(p_action, p_data) in the schema cache' });
    if (!caller) return reply(401, { message: 'permission denied for function friends_board' });
    const write = ['share', 'publish', 'replace'].includes(action);
    if ((write || action === 'unshare') && this.holdNext) {
      const held = this.holdNext;
      this.holdNext = null;
      return held.then(() => this.handle(caller, { p_action: action, p_data: data }, reply));
    }
    if (write) {
      const invalid = invalidBests(data.bests, utcDay(this.now()));
      if (invalid) return reply(400, { message: invalid });
      if (!this.store(caller, action, data)) {
        this.refused.push({ caller, action, ...data });
        return reply(200, { ...this.board(caller), refused: true });
      }
      this.published.push({ caller, action, ...data });
      if (this.dropNextReply) {
        this.dropNextReply = false;
        return reply(502, { message: 'The reply was lost.' });
      }
    } else if (action === 'unshare') {
      this.published.push({ caller, action });
      const old = this.summaries.get(caller);
      this.summaries.set(caller, { ...old, sharing: false, daily: null, week: null, bests: {} });
    } else if (action !== 'board') return reply(400, { message: 'Unknown board action.' });
    return reply(200, this.board(caller));
  }
}
