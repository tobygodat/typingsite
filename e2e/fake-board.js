// The friends board for the browser tests: a pure read of each member's own profile row (kept by
// e2e/fake-supabase.js), shown only to mutual friends who are members too and labelled with the reader's
// own name for them. It reads the friend lists kept by e2e/fake-races.js. `members` holds the accounts
// that share, and `versions` each account's sharing version: a share counts only when sent with the
// current one, an opt-out always, and each that counts moves it on, except the same opt-out (by its id)
// arriving again (`lastOptOut`), which changes nothing. supabase/tests/friends-board.sql checks the
// migration itself; this mirrors its replies.
const DAY_MS = 86400000;
export const utcDay = (date = new Date()) => date.toISOString().slice(0, 10);
export function mondayOf(date = new Date()) {
  const midnight = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  return utcDay(new Date(midnight - ((date.getUTCDay() + 6) % 7) * DAY_MS));
}

const whole = (value, max) => Number.isInteger(value) && value >= 0 && value <= max;
const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

// As race_private.board_bests: at most 16 shapes (none otherwise), each checked on its own: a condition
// key holding a whole wpm of 0-400, a whole accuracy of 0-100 and a YYYY-MM-DD date.
export function boardBests(bests) {
  if (!isObject(bests) || Object.keys(bests).length > 16) return {};
  return Object.fromEntries(Object.entries(bests)
    .filter(([key, best]) => /^[A-Za-z0-9:._+-]{1,200}$/.test(key) && isObject(best) && whole(best.wpm, 400) && whole(best.accuracy, 100)
      && typeof best.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(best.date))
    .map(([key, best]) => [key, { wpm: best.wpm, accuracy: best.accuracy, date: best.date }]));
}

// An entry of a summary's map of periods, by its key, when the map is an object.
const entry = (periods, key) => (periods && typeof periods === 'object' && !Array.isArray(periods) && Object.hasOwn(periods, key) ? periods[key] : null);

// As race_private.board_numbers: nothing unless the summary is stamped with the row's own updated_at,
// then the daily keyed by the service's today and the practice keyed by its week, each checked on its own.
export function boardNumbers(board, updatedAt, today, week) {
  if (!board || typeof board !== 'object' || typeof board.at !== 'string') return null;
  const at = Date.parse(board.at);
  if (Number.isNaN(at) || at !== Date.parse(updatedAt)) return null;
  const d = entry(board.days, today);
  const w = entry(board.weeks, week);
  const daily = d && typeof d === 'object' && typeof d.version === 'string' && /^[ -~]{1,200}$/.test(d.version)
    && whole(d.wpm, 400) && whole(d.accuracy, 100) && whole(d.attempts, 1000) && d.attempts >= 1
    ? { version: d.version, wpm: d.wpm, accuracy: d.accuracy, attempts: d.attempts } : null;
  const practice = w && typeof w === 'object' && whole(w.seconds, 604800) && whole(w.runs, 10000)
    ? { seconds: w.seconds, runs: w.runs } : null;
  return { daily, week: practice, bests: boardBests(board.bests) };
}

export class FakeBoard {
  constructor(auth) {
    this.auth = auth;
    this.members = new Set();
    // Each account's sharing version: how many shares and opt-outs were applied (none yet is 0).
    this.versions = new Map();
    // Each account's last applied opt-out id that came with one, kept through the shares after it.
    this.lastOptOut = new Map();
    // Every board call's action, in order.
    this.calls = [];
    // Set to stand in for a project where the migration has not been applied yet.
    this.missing = false;
    // The service's clock; a test that moves the page's clock moves this one with it.
    this.now = () => new Date();
    // Set to a promise to hold the next 'share' or 'unshare': it is applied and answered only once that
    // settles, while later requests go through, as a slow request can on the real service.
    this.holdNext = null;
    // Set to a promise to hold the reply to the next 'share' or 'unshare' once it is applied: the service
    // has taken it, and the answer is slow to come back while later requests go through.
    this.holdNextReply = null;
    // Set to delay the next reply by this many milliseconds: the board is read on arrival, and the reply
    // takes that long to get back.
    this.delayNextReply = 0;
    // Set to a promise to hold the reply to the next 'board' read once it is built: the board is read on
    // arrival, and the answer comes back only once that settles, while later requests go through.
    this.holdNextRead = null;
    // Set to lose the reply to the next 'share' or 'unshare': the service applies it, and the browser gets
    // a failure instead of the answer.
    this.loseNextReply = false;
  }

  version(account) { return this.versions.get(account) ?? 0; }

  // An account that turned sharing on before the test (one change applied, as the service counts it).
  joined(account) {
    this.versions.set(account, this.version(account) + 1);
    this.members.add(account);
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
    const now = this.now();
    const date = utcDay(now);
    const weekStart = mondayOf(now);
    const nextDay = Math.ceil((Date.parse(`${date}T00:00:00Z`) + DAY_MS - now.getTime()) / 1000);
    const email = this.emailOf(viewer);
    const row = (account, fields) => {
      const profile = this.auth.profiles.get(account);
      const numbers = profile ? boardNumbers(profile.board, profile.updated_at, date, weekStart) : null;
      return { ...fields, daily: numbers?.daily ?? null, week: numbers?.week ?? null, ...(numbers ? { bests: numbers.bests } : {}) };
    };
    // Someone who doesn't share sees nobody, and nobody sees them.
    const sharingVersion = this.version(viewer);
    if (!this.members.has(viewer)) return { date, weekStart, sharing: false, sharingVersion, nextDay, rows: [] };
    const mutual = [...this.listed(viewer)].filter(([account]) => this.members.has(account)
      && (this.auth.races.friends.get(account) || []).some((friend) => friend.friendId === viewer || friend.email === email));
    return { date, weekStart, sharing: true, sharingVersion, nextDay, rows: [row(viewer, { self: true, id: null, name: null }),
      ...mutual.map(([account, friend]) => row(account, { self: false, id: friend.id, name: friend.name }))
        .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()))] };
  }

  async handle(caller, { p_action: action, p_data: data }, reply) {
    this.calls.push(action);
    if (this.missing) return reply(404, { message: 'Could not find the function public.friends_board(p_action, p_data) in the schema cache' });
    if (!caller) return reply(401, { message: 'permission denied for function friends_board' });
    if ((action === 'share' || action === 'unshare') && this.holdNext) {
      const held = this.holdNext;
      this.holdNext = null;
      await held;
      if (this.missing) return reply(404, { message: 'Could not find the function public.friends_board(p_action, p_data) in the schema cache' });
    }
    // A share sent with any version but the current one (or none) changes nothing; the reply says.
    if (action === 'share') {
      const seen = data?.version;
      if (Number.isSafeInteger(seen) && seen >= 0 && seen === this.version(caller)) {
        this.versions.set(caller, seen + 1);
        this.members.add(caller);
      }
    } else if (action === 'unshare') {
      // An opt-out arriving again under its id changes nothing, even after a share since; any other (a
      // new id, or none valid) moves the version on and takes the account off, even when already off.
      const id = typeof data?.id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(data.id) ? data.id : null;
      if (id === null || this.lastOptOut.get(caller) !== id) {
        this.versions.set(caller, this.version(caller) + 1);
        if (id !== null) this.lastOptOut.set(caller, id);
        this.members.delete(caller);
      }
    } else if (action !== 'board') return reply(400, { message: 'Unknown board action.' });
    const result = this.board(caller);
    if (action === 'board' && this.holdNextRead) {
      const held = this.holdNextRead;
      this.holdNextRead = null;
      await held;
    }
    if ((action === 'share' || action === 'unshare') && this.loseNextReply) {
      this.loseNextReply = false;
      return reply(503, { message: 'The board is unavailable.' });
    }
    if ((action === 'share' || action === 'unshare') && this.holdNextReply) {
      const held = this.holdNextReply;
      this.holdNextReply = null;
      await held;
    }
    if (this.delayNextReply) {
      const delay = this.delayNextReply;
      this.delayNextReply = 0;
      await new Promise((resolve) => { setTimeout(resolve, delay); });
    }
    return reply(200, result);
  }
}
