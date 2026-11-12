// Challenge's list of people: one row per person you race, built only from what the race service lists for
// this account (friends, open invitations, ghost challenges, and the links that tie those to a friend row) and
// the invitations dismissed on this device. The page draws exactly what peopleRows returns, so the list is a
// pure function of those records and `now`: two devices holding the same records draw the same list.
import { challengeOutcome } from './ghost-race.js';
import { ago } from './inbox.js';

const MINUTE = 60000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// What a row offers, by its state. One state per row; the first that applies wins: an invitation lapses in
// minutes, a ghost in days, and racing a friend never lapses.
export const ROW_STATES = Object.freeze(['invited', 'ghost', 'friend']);

const stamp = (value) => (typeof value === 'string' ? Date.parse(value) : NaN);
const dated = (value) => Number.isFinite(stamp(value));
const text = (value) => (typeof value === 'string' && value.trim() ? value.trim() : '');

// The service's records, as this module trusts them; anything malformed is left out rather than guessed at.
function parseFriends(list) {
  return (Array.isArray(list) ? list : []).filter((friend) => text(friend?.id) && text(friend?.name))
    .map((friend) => ({ id: friend.id, name: text(friend.name), account: Boolean(friend.account), email: text(friend.email) }));
}

function parseInvites(list, dismissed, now) {
  return (Array.isArray(list) ? list : []).filter((invite) => text(invite?.id) && text(invite?.hostName)
    && dated(invite.createdAt) && dated(invite.expiresAt) && stamp(invite.expiresAt) > now && !dismissed.has(invite.id));
}

const SCORE_KEYS = ['wpm', 'elapsedMs', 'correct'];
const score = (value) => Boolean(value) && SCORE_KEYS.every((key) => Number.isFinite(value[key]) && value[key] >= 0);

// An open ghost is one still to be raced; a done one carries both scores. An expired ghost is not something that
// happened between two people, so it is left out.
function parseChallenges(list, now) {
  return (Array.isArray(list) ? list : []).filter((challenge) => text(challenge?.id) && text(challenge?.name)
    && ['sent', 'received'].includes(challenge.role) && score(challenge.sender))
    .filter((challenge) => (challenge.status === 'open' && dated(challenge.expiresAt) && stamp(challenge.expiresAt) > now)
      || (challenge.status === 'done' && score(challenge.result) && dated(challenge.completedAt)));
}

function parseLinks(links) {
  const of = (list) => (Array.isArray(list) ? list : []).filter((link) => text(link?.id));
  const tallies = new Map();

  for (const link of of(links?.friends)) {
    const tally = link.tally;

    // A tally is shown once either side has a win: after only ties it would read 0–0 beside results that aren't it.
    if (Array.isArray(tally) && tally.length === 2 && tally.every((value) => Number.isSafeInteger(value) && value >= 0) && tally[0] + tally[1] > 0) {
      tallies.set(link.id, { mine: tally[0], theirs: tally[1] });
    }
  }

  const friendOf = (list) => new Map(of(list).filter((link) => text(link.friendId)).map((link) => [link.id, link.friendId]));

  return { tallies, invites: friendOf(links?.invites), challenges: friendOf(links?.challenges) };
}

// The facts a record states, each with the time it happened (`at`) where it has one.
function inviteFact(invite) {
  return { kind: 'invited', at: stamp(invite.createdAt), until: stamp(invite.expiresAt), rematch: Boolean(invite.rematch) };
}

function ghostFact(challenge) {
  if (challenge.status === 'open') {
    return challenge.role === 'received'
      ? { kind: 'ghost', at: stamp(challenge.createdAt), until: stamp(challenge.expiresAt), wpm: challenge.sender.wpm }
      : { kind: 'ghost-sent', at: stamp(challenge.createdAt), until: stamp(challenge.expiresAt) };
  }

  const leader = challengeOutcome(challenge);
  const mine = challenge.role === 'received' ? 'recipient' : 'sender';
  const outcome = leader === 'tie' ? 'tied' : leader === mine ? 'won' : 'lost';
  const [mineWpm, theirsWpm] = challenge.role === 'received' ? [challenge.result.wpm, challenge.sender.wpm] : [challenge.sender.wpm, challenge.result.wpm];

  return { kind: 'ghost-result', at: stamp(challenge.completedAt), outcome, mine: mineWpm, theirs: theirsWpm };
}

const newest = (facts) => facts.filter((fact) => Number.isFinite(fact.at)).sort((a, b) => b.at - a.at)[0] || null;

// The list. A person is a friend row when a record links to one; a record no link ties to a friend row is a
// person of its own, since nothing says who else it could be. A received ghost or an invitation with no friend
// row gets its own row; a sent ghost or a finished one with no friend row is history, kept in the inbox.
export function peopleRows({ friends = [], invites = [], challenges = [], links = null, dismissed = new Set(), now = Date.now() } = {}) {
  const linked = parseLinks(links);
  const people = new Map();

  for (const friend of parseFriends(friends)) {
    people.set(`friend:${friend.id}`, { key: `friend:${friend.id}`, name: friend.name, friendId: friend.id, email: friend.email,
      invites: [], ghosts: [], facts: [], tally: linked.tallies.get(friend.id) || null });
  }

  const personFor = (friendId, key, name) => {
    const friend = friendId && people.get(`friend:${friendId}`);

    if (friend) return friend;
    const person = { key, name, friendId: null, email: '', invites: [], ghosts: [], facts: [], tally: null };
    people.set(key, person);

    return person;
  };

  for (const invite of parseInvites(invites, dismissed, now)) {
    const person = personFor(linked.invites.get(invite.id), `invite:${invite.id}`, text(invite.hostName));
    const fact = inviteFact(invite);
    person.invites.push({ id: invite.id, fact });
    person.facts.push(fact);
  }

  for (const challenge of parseChallenges(challenges, now)) {
    const friendId = linked.challenges.get(challenge.id);
    const waiting = challenge.role === 'received' && challenge.status === 'open';

    if (!people.has(`friend:${friendId}`) && !waiting) continue;
    const person = personFor(friendId, `ghost:${challenge.id}`, text(challenge.name));
    const fact = ghostFact(challenge);

    if (waiting) person.ghosts.push({ id: challenge.id, fact });
    person.facts.push(fact);
  }

  const rows = [...people.values()].map(rowOf);

  // Two people with one name are told apart by the email typed for them, the one thing recorded that can; a friend
  // saved from a race has none, so two of those stay alike.
  const named = new Map();

  for (const row of rows) named.set(sameName(row.name), (named.get(sameName(row.name)) || 0) + 1);

  for (const row of rows) {
    if (named.get(sameName(row.name)) > 1 && row.email) {
      row.detail = row.email;

      if (row.line?.kind === 'email') row.line = null;
    }
  }

  for (const row of rows) delete row.email;

  return rows.sort(compareRows);
}

const bySoonest = (a, b) => a.fact.until - b.fact.until || a.fact.at - b.fact.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

function rowOf(person) {
  const invite = [...person.invites].sort(bySoonest)[0];
  const ghost = [...person.ghosts].sort(bySoonest)[0];
  const state = invite ? 'invited' : ghost ? 'ghost' : 'friend';
  // The line explains the row's action when something waits for you; otherwise it is the newest thing that happened.
  const fact = invite?.fact || ghost?.fact || newest(person.facts);
  const line = fact || (person.email ? { kind: 'email', email: person.email } : null);

  return {
    key: person.key,
    name: person.name,
    detail: null,
    email: person.email,
    state,
    friendId: person.friendId,
    inviteId: invite?.id || null,
    challengeId: ghost?.id || null,
    line,
    tally: person.friendId ? person.tally : null,
    // How the list orders this row: what waits for you lapses at `until`; everything else by its newest fact.
    until: invite?.fact.until ?? ghost?.fact.until ?? null,
    latest: newest(person.facts)?.at ?? null,
  };
}

const sameName = (name) => name.toLocaleLowerCase();

const RANK = { invited: 0, ghost: 1, friend: 2 };

// The order, in one place: invitations, soonest to lapse first; then waiting ghosts, soonest to lapse first; then
// everyone else, the most recent thing between you first, and those with nothing dated by name.
export function compareRows(a, b) {
  return RANK[a.state] - RANK[b.state]
    || (a.state === 'friend' ? 0 : a.until - b.until)
    || (b.latest ?? -Infinity) - (a.latest ?? -Infinity)
    || (a.latest === null && b.latest === null ? a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) : 0)
    || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
}

// "6 days left", "3 h left", "12 min left": how long until a waiting thing lapses, rounded up.
export function timeLeft(until, now = Date.now()) {
  const ms = Math.max(0, until - now);

  if (ms >= DAY) {
    const days = Math.ceil(ms / DAY);

    return `${days} ${days === 1 ? 'day' : 'days'} left`;
  }

  if (ms >= HOUR) return `${Math.ceil(ms / HOUR)} h left`;

  return `${Math.max(1, Math.ceil(ms / MINUTE))} min left`;
}

// A row's quiet line as parts: text, and speeds as { wpm, bare } for the page to show in the chosen unit.
export function lineParts(line, now = Date.now()) {
  if (!line) return [];

  switch (line.kind) {
    case 'invited': return [`${line.rematch ? 'wants a rematch' : 'invited you'} · ${ago(new Date(line.at).toISOString(), now)}`];
    case 'ghost': return ['sent a ghost at ', { wpm: line.wpm }, ` · ${timeLeft(line.until, now)}`];
    case 'ghost-sent': return [`has your ghost · ${timeLeft(line.until, now)}`];
    case 'ghost-result': return [`${line.outcome} `, { wpm: line.mine, bare: true }, '–', { wpm: line.theirs, bare: true }, ` · ${ago(new Date(line.at).toISOString(), now)}`];
    case 'email': return [line.email];
    default: return [];
  }
}

// The tally as a screen reader hears it: "3 wins, 4 losses".
export function tallyLabel({ mine, theirs }) {
  return `${mine} ${mine === 1 ? 'win' : 'wins'}, ${theirs} ${theirs === 1 ? 'loss' : 'losses'}`;
}
