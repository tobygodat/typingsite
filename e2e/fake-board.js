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

  board(viewer) {
    const now = new Date();
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
    if (action === 'publish') {
      this.published.push({ caller, ...data });
      this.summaries.set(caller, { daily: data.daily || null, week: data.week });
    } else if (action !== 'board') return reply(400, { message: 'Unknown board action.' });
    return reply(200, this.board(caller));
  }
}
