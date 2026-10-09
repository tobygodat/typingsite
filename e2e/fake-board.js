// The friends board for the browser tests: one summary per account, shown only to mutual friends and
// labelled with the reader's own name for them. It reads the friend lists kept by e2e/fake-races.js.
// supabase/tests/friends-board.sql checks the migration itself; this only mirrors its replies.
const DAY_MS = 86400000;
export const utcDay = (date = new Date()) => date.toISOString().slice(0, 10);
export function mondayOf(date = new Date()) {
  const midnight = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  return utcDay(new Date(midnight - ((date.getUTCDay() + 6) % 7) * DAY_MS));
}

export class FakeBoard {
  constructor(auth) {
    this.auth = auth;
    this.summaries = new Map();
    this.published = [];
    // Set to stand in for a project where the migration has not been applied yet.
    this.missing = false;
    // The service's clock; a test that moves the page's clock moves this one with it.
    this.now = () => new Date();
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

  // 'publish' folds a summary into the stored one, as race_private.board does: the stored daily stays
  // unless the new one is for a later day (today's first) or better on the same daily, and within a week
  // the larger practice time and run count stay. 'replace' (a history clear or undo) overwrites it.
  store(caller, data, replace) {
    const now = this.now();
    const today = utcDay(now);
    const thisWeek = mondayOf(now);
    const next = { daily: data.daily || null, week: { ...data.week } };
    const old = this.summaries.get(caller);
    // Today's (or this week's) first, then the later date.
    const ahead = (a, b, current) => (a === current) !== (b === current) ? a === current : a > b;
    if (old && !replace) {
      const same = Boolean(old.daily && next.daily && old.daily.date === next.daily.date && old.daily.version === next.daily.version);
      if (same) next.daily = { ...next.daily, attempts: Math.max(old.daily.attempts, next.daily.attempts) };
      const better = same && (old.daily.wpm - next.daily.wpm || old.daily.accuracy - next.daily.accuracy) > 0;
      if (old.daily && (!next.daily || ahead(old.daily.date, next.daily.date, today) || better)) {
        next.daily = { ...old.daily, attempts: same ? next.daily.attempts : old.daily.attempts };
      }
      if (old.week.start === next.week.start) {
        next.week = { start: old.week.start, seconds: Math.max(old.week.seconds, next.week.seconds), runs: Math.max(old.week.runs, next.week.runs) };
      } else if (ahead(old.week.start, next.week.start, thisWeek)) next.week = { ...old.week };
    }
    this.summaries.set(caller, next);
  }

  board(viewer) {
    const now = this.now();
    const date = utcDay(now);
    const weekStart = mondayOf(now);
    const email = this.emailOf(viewer);
    const row = (account, fields) => {
      const summary = this.summaries.get(account);
      return { ...fields,
        daily: summary?.daily?.date === date
          ? { version: summary.daily.version, wpm: summary.daily.wpm, accuracy: summary.daily.accuracy, attempts: summary.daily.attempts } : null,
        week: summary?.week?.start === weekStart ? { seconds: summary.week.seconds, runs: summary.week.runs } : null };
    };
    const mutual = [...this.listed(viewer)].filter(([account]) => (this.auth.races.friends.get(account) || [])
      .some((friend) => friend.friendId === viewer || friend.email === email));
    return { date, weekStart, rows: [row(viewer, { self: true, id: null, name: null }),
      ...mutual.map(([account, friend]) => row(account, { self: false, id: friend.id, name: friend.name }))
        .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()))] };
  }

  handle(caller, { p_action: action, p_data: data = {} }, reply) {
    if (this.missing) return reply(404, { message: 'Could not find the function public.friends_board(p_action, p_data) in the schema cache' });
    if (!caller) return reply(401, { message: 'permission denied for function friends_board' });
    if (action === 'publish' || action === 'replace') {
      this.published.push({ caller, action, ...data });
      this.store(caller, data, action === 'replace');
    } else if (action !== 'board') return reply(400, { message: 'Unknown board action.' });
    return reply(200, this.board(caller));
  }
}
