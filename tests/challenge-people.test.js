import test from 'node:test';
import assert from 'node:assert/strict';
import { lineParts, peopleRows, tallyLabel, timeLeft } from '../src/challenge-people.js';
import { challengeOutcome } from '../src/ghost-race.js';

const NOW = Date.parse('2026-11-11T12:00:00Z');
const MIN = 60000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const iso = (ms) => new Date(ms).toISOString();
const score = (wpm, elapsedMs = 30000) => ({ wpm, accuracy: 97, elapsedMs, correct: Math.round(wpm * 5 * elapsedMs / 60000) });

const invite = (id, hostName, { age = 2 * MIN, left = 13 * MIN, rematch = false } = {}) => ({ id, hostName, createdAt: iso(NOW - age), expiresAt: iso(NOW + left), rematch });

const ghost = (id, name, { role = 'received', status = 'open', age = DAY, left = 6 * DAY, mine = 70, theirs = 80, doneAgo = HOUR } = {}) => ({
  id, name, role, status, duration: null, conditions: {},
  sender: score(role === 'received' ? theirs : mine), result: status === 'done' ? score(role === 'received' ? mine : theirs) : null,
  createdAt: iso(NOW - age), expiresAt: iso(NOW + left), completedAt: status === 'done' ? iso(NOW - doneAgo) : null,
});

test('one row per friend, with the tally the service links to it', () => {
  const rows = peopleRows({ now: NOW, friends: [{ id: 'f1', name: 'Sam Achebe', account: true }, { id: 'f2', name: 'Lena Ortiz', account: false, email: 'lena@example.com' }],
    links: { friends: [{ id: 'f1', tally: [3, 4] }] } });

  assert.deepEqual(rows.map((row) => [row.name, row.state, row.tally]), [['Lena Ortiz', 'friend', null], ['Sam Achebe', 'friend', { mine: 3, theirs: 4 }]]);
  assert.deepEqual(rows[0].line, { kind: 'email', email: 'lena@example.com' });
  assert.equal(rows[1].line, null);
});

test('an invitation linked to a friend is that friend’s row, and wins over a waiting ghost', () => {
  const rows = peopleRows({ now: NOW, friends: [{ id: 'f1', name: 'Priya', account: true }],
    invites: [invite('r1', 'P')], challenges: [ghost('c1', 'Priya')],
    links: { invites: [{ id: 'r1', friendId: 'f1' }], challenges: [{ id: 'c1', friendId: 'f1' }] } });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, 'Priya');
  assert.equal(rows[0].state, 'invited');
  assert.equal(rows[0].inviteId, 'r1');
  assert.equal(rows[0].line.kind, 'invited');
});

test('without links, every invitation and waiting ghost is its own row, and history makes none', () => {
  const rows = peopleRows({ now: NOW, friends: [{ id: 'f1', name: 'Maya', account: true }],
    invites: [invite('r1', 'Maya')], challenges: [ghost('c1', 'Maya'), ghost('c2', 'Maya', { status: 'done' }), ghost('c3', 'Maya', { role: 'sent' })] });

  assert.deepEqual(rows.map((row) => row.key), ['invite:r1', 'ghost:c1', 'friend:f1']);
  assert.equal(rows[2].line, null);
});

test('dismissed and lapsed invitations and expired ghosts are gone', () => {
  const rows = peopleRows({ now: NOW, dismissed: new Set(['r1']),
    invites: [invite('r1', 'A'), invite('r2', 'B', { left: -MIN })], challenges: [ghost('c1', 'C', { left: -MIN }), { ...ghost('c2', 'D'), status: 'expired' }] });

  assert.deepEqual(rows, []);
});

test('the order: invitations, then ghosts, each soonest to lapse first, then the newest thing between you', () => {
  const rows = peopleRows({ now: NOW,
    friends: [{ id: 'a', name: 'Ann' }, { id: 'b', name: 'Bo' }, { id: 'z', name: 'Zed' }, { id: 'y', name: 'yan' }],
    invites: [invite('late', 'Late', { left: 14 * MIN }), invite('soon', 'Soon', { left: 3 * MIN })],
    challenges: [ghost('g-late', 'GL', { left: 6 * DAY }), ghost('g-soon', 'GS', { left: 2 * DAY }),
      ghost('ra', 'Ann', { status: 'done', doneAgo: 3 * DAY }), ghost('rb', 'Bo', { role: 'sent', status: 'done', doneAgo: HOUR })],
    links: { challenges: [{ id: 'ra', friendId: 'a' }, { id: 'rb', friendId: 'b' }] } });

  assert.deepEqual(rows.map((row) => row.name), ['Soon', 'Late', 'GS', 'GL', 'Bo', 'Ann', 'yan', 'Zed']);
});

test('a finished ghost reads as who led, mine first, with its date', () => {
  const [row] = peopleRows({ now: NOW, friends: [{ id: 'f', name: 'Theo' }],
    challenges: [ghost('c', 'Theo', { status: 'done', mine: 81, theirs: 77, doneAgo: 5 * DAY })], links: { challenges: [{ id: 'c', friendId: 'f' }] } });

  assert.deepEqual({ ...row.line, at: undefined }, { kind: 'ghost-result', at: undefined, outcome: 'won', mine: 81, theirs: 77 });
  assert.deepEqual(lineParts(row.line, NOW).map((part) => (typeof part === 'string' ? part : part.wpm)), ['won ', 81, '–', 77, ` · ${new Date(NOW - 5 * DAY).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`]);
});

test('copy for each line, the time left and the tally label', () => {
  const words = (line) => lineParts(line, NOW).map((part) => (typeof part === 'string' ? part : `[${part.wpm}]`)).join('');

  assert.equal(words({ kind: 'invited', at: NOW - 2 * MIN, rematch: false }), 'invited you · 2 min ago');
  assert.equal(words({ kind: 'invited', at: NOW - 20000, rematch: true }), 'wants a rematch · just now');
  assert.equal(words({ kind: 'ghost', until: NOW + 6 * DAY - HOUR, wpm: 84 }), 'sent a ghost at [84] · 6 days left');
  assert.equal(words({ kind: 'ghost-sent', until: NOW + 90 * MIN }), 'has your ghost · 2 h left');
  assert.equal(timeLeft(NOW + DAY + 1, NOW), '2 days left');
  assert.equal(timeLeft(NOW + DAY, NOW), '1 day left');
  assert.equal(timeLeft(NOW + 30000, NOW), '1 min left');
  assert.equal(tallyLabel({ mine: 3, theirs: 4 }), '3 wins, 4 losses');
  assert.equal(tallyLabel({ mine: 1, theirs: 1 }), '1 win, 1 loss');
});

// Random records, the rules recomputed from them, and the list checked against those rules.
function random(seed) {
  let state = seed >>> 0;

  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);

    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function world(seed) {
  const rnd = random(seed);
  const pick = (list) => list[Math.floor(rnd() * list.length)];
  const int = (max) => Math.floor(rnd() * max);
  const names = ['Sam', 'Lena', 'Theo', 'Maya', 'Priya', 'Jonas', 'sam', 'Ana'];

  const friends = Array.from({ length: int(6) }, (_, index) => {
    const friend = { id: `f${index}`, name: pick(names), account: rnd() < 0.6 };

    if (rnd() < 0.3) friend.email = `p${index}@example.com`;

    return friend;
  });

  const invites = Array.from({ length: int(5) }, (_, index) => invite(`r${index}`, pick(names), { age: int(14) * MIN, left: (int(30) - 4) * MIN, rematch: rnd() < 0.3 }));

  const challenges = Array.from({ length: int(7) }, (_, index) => {
    const status = pick(['open', 'done', 'expired']);

    const challenge = ghost(`c${index}`, pick(names), { role: pick(['sent', 'received']), status: status === 'expired' ? 'open' : status,
      age: int(6) * DAY + int(20) * HOUR, left: (int(8) - 1) * DAY + int(20) * HOUR, mine: 40 + int(60), theirs: 40 + int(60), doneAgo: int(9) * DAY + int(20) * HOUR });

    // The service says expired for an open ghost past its time; the list must leave it out either way.
    if (status === 'expired') challenge.status = 'expired';

    return challenge;
  });

  const ids = friends.map((friend) => friend.id).concat(['gone']);

  const links = rnd() < 0.2 ? null : {
    friends: friends.filter(() => rnd() < 0.6).map((friend) => ({ id: friend.id, tally: [int(6), int(6)] })),
    invites: invites.filter(() => rnd() < 0.5).map((entry) => ({ id: entry.id, friendId: pick(ids) })),
    challenges: challenges.filter(() => rnd() < 0.6).map((entry) => ({ id: entry.id, friendId: pick(ids) })),
  };

  const dismissed = new Set(invites.filter(() => rnd() < 0.2).map((entry) => entry.id));

  return { friends, invites, challenges, links, dismissed, now: NOW };
}

function shuffled(list, rnd) {
  const copy = [...list];

  for (let index = copy.length - 1; index > 0; index -= 1) {
    const other = Math.floor(rnd() * (index + 1));
    [copy[index], copy[other]] = [copy[other], copy[index]];
  }

  return copy;
}

test('property: every row follows the rules recomputed from the raw records', () => {
  for (let seed = 1; seed <= 2000; seed += 1) {
    const input = world(seed);
    const rows = peopleRows(input);
    const friendIds = new Set(input.friends.map((friend) => friend.id));
    const linkOf = (list, id) => input.links?.[list]?.find((link) => link.id === id)?.friendId;
    const owner = (list, id) => (friendIds.has(linkOf(list, id)) ? `friend:${linkOf(list, id)}` : null);
    const liveInvites = input.invites.filter((entry) => Date.parse(entry.expiresAt) > NOW && !input.dismissed.has(entry.id));
    const openGhosts = input.challenges.filter((entry) => entry.role === 'received' && entry.status === 'open' && Date.parse(entry.expiresAt) > NOW);

    const facts = (key) => [
      ...liveInvites.filter((entry) => (owner('invites', entry.id) || `invite:${entry.id}`) === key).map((entry) => Date.parse(entry.createdAt)),
      ...input.challenges.filter((entry) => (owner('challenges', entry.id) || `ghost:${entry.id}`) === key)
        .filter((entry) => (entry.status === 'open' && Date.parse(entry.expiresAt) > NOW) || entry.status === 'done')
        .map((entry) => Date.parse(entry.status === 'done' ? entry.completedAt : entry.createdAt)),
    ];

    // No person twice, and nobody missing.
    const keys = rows.map((row) => row.key);
    assert.equal(new Set(keys).size, keys.length, `seed ${seed}: a person appears twice`);
    const expected = new Set([...friendIds].map((id) => `friend:${id}`));

    for (const entry of liveInvites) expected.add(owner('invites', entry.id) || `invite:${entry.id}`);

    for (const entry of openGhosts) expected.add(owner('challenges', entry.id) || `ghost:${entry.id}`);
    assert.deepEqual(new Set(keys), expected, `seed ${seed}: the people listed`);

    for (const row of rows) {
      const invites = liveInvites.filter((entry) => (owner('invites', entry.id) || `invite:${entry.id}`) === row.key);
      const ghosts = openGhosts.filter((entry) => (owner('challenges', entry.id) || `ghost:${entry.id}`) === row.key);
      const state = invites.length ? 'invited' : ghosts.length ? 'ghost' : 'friend';
      assert.equal(row.state, state, `seed ${seed}: ${row.key} state`);
      const soonest = (list) => list.sort((a, b) => Date.parse(a.expiresAt) - Date.parse(b.expiresAt) || Date.parse(a.createdAt) - Date.parse(b.createdAt) || (a.id < b.id ? -1 : 1))[0];

      // The action acts on the record that lapses first.
      if (state === 'invited') assert.equal(row.inviteId, soonest(invites).id);

      if (state === 'ghost') assert.equal(row.challengeId, soonest(ghosts).id);

      if (state === 'friend') assert.ok(row.friendId && !row.inviteId && !row.challengeId);

      // The line: the waiting record's fact, else the newest dated fact, else the typed email, else nothing.
      const times = facts(row.key);

      if (state === 'invited') assert.equal(row.line.at, Date.parse(soonest(invites).createdAt));
      else if (state === 'ghost') assert.equal(row.line.wpm, soonest(ghosts).sender.wpm);
      else if (times.length) assert.equal(row.line.at, Math.max(...times));
      else {
        const email = input.friends.find((friend) => `friend:${friend.id}` === row.key)?.email;
        assert.deepEqual(row.line, email && !row.detail ? { kind: 'email', email } : null);
      }

      if (row.line?.kind === 'ghost-result') {
        const source = input.challenges.find((entry) => Date.parse(entry.completedAt) === row.line.at && entry.status === 'done');
        const lead = challengeOutcome(source);
        const mine = source.role === 'received' ? 'recipient' : 'sender';
        assert.equal(row.line.outcome, lead === 'tie' ? 'tied' : lead === mine ? 'won' : 'lost');
      }

      // A tally only from the service's record for that friend, and only once either side has a win.
      const tally = row.friendId && input.links?.friends?.find((link) => link.id === row.friendId)?.tally;
      assert.deepEqual(row.tally, tally && tally[0] + tally[1] > 0 ? { mine: tally[0], theirs: tally[1] } : null, `seed ${seed}: ${row.key} tally`);

      // Someone who shares a name with another row is told apart by the email typed for them, and only then.
      const shared = rows.filter((other) => other.name.toLocaleLowerCase() === row.name.toLocaleLowerCase()).length > 1;
      const typed = input.friends.find((friend) => `friend:${friend.id}` === row.key)?.email || null;
      assert.equal(row.detail, shared && typed ? typed : null, `seed ${seed}: ${row.key} detail`);
    }

    // The order, recomputed.
    const rank = { invited: 0, ghost: 1, friend: 2 };

    for (let index = 1; index < rows.length; index += 1) {
      const [a, b] = [rows[index - 1], rows[index]];
      assert.ok(rank[a.state] <= rank[b.state], `seed ${seed}: state order`);

      if (a.state === b.state && a.state !== 'friend') assert.ok(a.until <= b.until, `seed ${seed}: soonest first`);

      if (a.state === b.state && a.state === 'friend') assert.ok((a.latest ?? -Infinity) >= (b.latest ?? -Infinity), `seed ${seed}: newest first`);
    }

    // The same records in any order (another device, or a sync merge either way round) draw the same list.
    const rnd = random(seed * 7919);

    const again = peopleRows({ ...input, friends: shuffled(input.friends, rnd), invites: shuffled(input.invites, rnd), challenges: shuffled(input.challenges, rnd),
      links: input.links && { friends: shuffled(input.links.friends, rnd), invites: shuffled(input.links.invites, rnd), challenges: shuffled(input.links.challenges, rnd) } });

    assert.deepEqual(again, rows, `seed ${seed}: order of records changed the list`);
  }
});

test('a tally nobody has won yet is left out, and any win shows it', () => {
  const rows = peopleRows({ now: NOW, friends: [{ id: 'a', name: 'Ann', account: true }, { id: 'b', name: 'Bo', account: true }],
    links: { friends: [{ id: 'a', tally: [0, 0] }, { id: 'b', tally: [0, 1] }] } });

  assert.deepEqual(rows.map((row) => [row.name, row.tally]), [['Ann', null], ['Bo', { mine: 0, theirs: 1 }]]);
});

test('people who share a name are told apart by a typed email, and two saved from races stay alike', () => {
  const rows = peopleRows({ now: NOW, friends: [{ id: 'a', name: 'Sam', email: 'sam.a@example.com' }, { id: 'b', name: 'sam', email: 'sam.b@example.com' },
    { id: 'c', name: 'Sam', account: true }, { id: 'd', name: 'Lee', email: 'lee@example.com' }] });

  const byKey = Object.fromEntries(rows.map((row) => [row.key, row]));

  assert.equal(byKey['friend:a'].detail, 'sam.a@example.com');
  assert.equal(byKey['friend:a'].line, null);
  assert.equal(byKey['friend:b'].detail, 'sam.b@example.com');
  assert.equal(byKey['friend:c'].detail, null);
  assert.equal(byKey['friend:d'].detail, null);
  assert.deepEqual(byKey['friend:d'].line, { kind: 'email', email: 'lee@example.com' });
  assert.equal('email' in byKey['friend:a'], false);
});

test('malformed records are left out, never guessed at', () => {
  const rows = peopleRows({ now: NOW, friends: [{ id: 'f', name: '  ' }, null, { id: 'g', name: 'Gil' }],
    invites: [{ id: 'x', hostName: 'X', createdAt: 'soon', expiresAt: iso(NOW + MIN) }],
    challenges: [{ ...ghost('c', 'C'), sender: { wpm: 'fast' } }],
    links: { friends: [{ id: 'g', tally: [1, -1] }], invites: 'nope' } });

  assert.deepEqual(rows.map((row) => [row.key, row.tally]), [['friend:g', null]]);
});
