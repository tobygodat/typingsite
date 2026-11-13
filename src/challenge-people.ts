import { isRecord } from './domain-values.js';

interface Friend { id: string; name: string; account: boolean; email: string }

interface Invite { id: string; hostName: string; createdAt: string; expiresAt: string; rematch?: unknown }

interface GhostScore { wpm: number; elapsedMs: number; correct: number }

type GhostChallenge = { id: string; name: string; role: 'sent' | 'received'; sender: GhostScore; createdAt?: unknown; expiresAt: string; status: 'open' } | { id: string; name: string; role: 'sent' | 'received'; sender: GhostScore; result: GhostScore; status: 'done'; completedAt: string };

export type PersonFact = { kind: 'invited'; at: number; until: number; rematch: boolean } | { kind: 'ghost'; at: number; until: number; wpm: number } | { kind: 'ghost-sent'; at: number; until: number } | { kind: 'ghost-result'; at: number; outcome: string; mine: number; theirs: number };

export type PersonLine = PersonFact | { kind: 'email'; email: string };

interface Person { key: string; name: string; friendId: string | null; email: string; invites: { id: string; fact: Extract<PersonFact, { kind: 'invited' }> }[]; ghosts: { id: string; fact: PersonFact }[]; facts: PersonFact[]; tally: { mine: number; theirs: number } | null }

export interface PersonRow { key: string; name: string; detail: string | null; email?: string; state: 'invited' | 'ghost' | 'friend'; friendId: string | null; inviteId: string | null; challengeId: string | null; line: PersonLine | null; tally: { mine: number; theirs: number } | null; until: number | null; latest: number | null }

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

const stamp = (value: unknown) => (typeof value === 'string' ? Date.parse(value) : NaN);
const dated = (value: unknown) => Number.isFinite(stamp(value));
const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : '');

// The service's records, as this module trusts them; anything malformed is left out rather than guessed at.
function parseFriends(list: unknown): Friend[] {
  return (Array.isArray(list) ? list : []).filter(isFriend)
    .map((friend) => ({ id: friend.id, name: text(friend.name), account: Boolean(friend.account), email: text(friend.email) }));
}

function isFriend(value: unknown): value is { id: string; name: string; account?: unknown; email?: unknown } {
  return isRecord(value) && typeof value.id === 'string' && Boolean(text(value.id)) && typeof value.name === 'string' && Boolean(text(value.name));
}

function isInvite(value: unknown): value is Invite {
  return isRecord(value) && typeof value.id === 'string' && Boolean(text(value.id)) && typeof value.hostName === 'string' && Boolean(text(value.hostName))
    && typeof value.createdAt === 'string' && dated(value.createdAt) && typeof value.expiresAt === 'string' && dated(value.expiresAt);
}

function parseInvites(list: unknown, dismissed: Set<string>, now: number): Invite[] {
  return (Array.isArray(list) ? list : []).filter(isInvite).filter((invite) => stamp(invite.expiresAt) > now && !dismissed.has(invite.id));
}

const SCORE_KEYS = ['wpm', 'elapsedMs', 'correct'];
const score = (value: unknown): value is GhostScore => isRecord(value) && SCORE_KEYS.every((key) => typeof value[key] === 'number' && Number.isFinite(value[key]) && value[key] >= 0);

// An open ghost is one still to be raced; a done one carries both scores. An expired ghost is not something that
// happened between two people, so it is left out.
function isChallenge(value: unknown): value is GhostChallenge {
  return isRecord(value) && typeof value.id === 'string' && Boolean(text(value.id)) && typeof value.name === 'string' && Boolean(text(value.name))
    && (value.role === 'sent' || value.role === 'received') && score(value.sender)
    && ((value.status === 'open' && typeof value.expiresAt === 'string' && dated(value.expiresAt))
      || (value.status === 'done' && score(value.result) && typeof value.completedAt === 'string' && dated(value.completedAt)));
}

function parseChallenges(list: unknown, now: number) {
  return (Array.isArray(list) ? list : []).filter(isChallenge).filter((challenge) => challenge.status === 'done' || stamp(challenge.expiresAt) > now);
}

function isLink(value: unknown): value is { id: string; friendId?: unknown; tally?: unknown } {
  return isRecord(value) && typeof value.id === 'string' && Boolean(text(value.id));
}

function parseLinks(links: unknown) {
  const source = isRecord(links) ? links : {};
  const of = (list: unknown) => (Array.isArray(list) ? list : []).filter(isLink);
  const tallies = new Map<string, { mine: number; theirs: number }>();

  for (const link of of(source.friends)) {
    const tally = link.tally;

    // A tally is shown once either side has a win: after only ties it would read 0–0 beside results that aren't it.
    if (Array.isArray(tally) && tally.length === 2 && tally.every((value) => Number.isSafeInteger(value) && value >= 0) && typeof tally[0] === 'number' && typeof tally[1] === 'number' && tally[0] + tally[1] > 0) {
      tallies.set(link.id, { mine: tally[0], theirs: tally[1] });
    }
  }

  const friendOf = (list: unknown) => new Map(of(list).flatMap((link) => typeof link.friendId === 'string' && text(link.friendId) ? [[link.id, link.friendId]] : []));

  return { tallies, invites: friendOf(source.invites), challenges: friendOf(source.challenges) };
}

// The facts a record states, each with the time it happened (`at`) where it has one.
function inviteFact(invite: Invite): Extract<PersonFact, { kind: 'invited' }> {
  return { kind: 'invited', at: stamp(invite.createdAt), until: stamp(invite.expiresAt), rematch: Boolean(invite.rematch) };
}

function ghostFact(challenge: GhostChallenge): PersonFact {
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

const newest = (facts: PersonFact[]) => facts.filter((fact) => Number.isFinite(fact.at)).sort((a, b) => b.at - a.at)[0] || null;

// The list. A person is a friend row when a record links to one; a record no link ties to a friend row is a
// person of its own, since nothing says who else it could be. A received ghost or an invitation with no friend
// row gets its own row; a sent ghost or a finished one with no friend row is history, kept in the inbox.
export function peopleRows({ friends = [], invites = [], challenges = [], links = null, dismissed = new Set(), now = Date.now() }: { friends?: unknown; invites?: unknown; challenges?: unknown; links?: unknown; dismissed?: Set<string>; now?: number } = {}) {
  const linked = parseLinks(links);
  const people = new Map<string, Person>();

  for (const friend of parseFriends(friends)) {
    people.set(`friend:${friend.id}`, { key: `friend:${friend.id}`, name: friend.name, friendId: friend.id, email: friend.email,
      invites: [], ghosts: [], facts: [], tally: linked.tallies.get(friend.id) || null });
  }

  const personFor = (friendId: string | undefined, key: string, name: string) => {
    const friend = friendId && people.get(`friend:${friendId}`);

    if (friend) return friend;
    const person: Person = { key, name, friendId: null, email: '', invites: [], ghosts: [], facts: [], tally: null };
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

  // Two people with one name are told apart by the email typed for them, the one thing recorded that can. A friend
  // saved from a race has none: two of those differ only by what their rows already show (the newest thing between
  // you, the tally), and with neither they stay alike. The friend list carries no date, and race_people only the tally.
  const named = new Map<string, number>();

  for (const row of rows) named.set(sameName(row.name), (named.get(sameName(row.name)) || 0) + 1);

  for (const row of rows) {
    if ((named.get(sameName(row.name)) ?? 0) > 1 && row.email) {
      row.detail = row.email;

      if (row.line?.kind === 'email') row.line = null;
    }
  }

  for (const row of rows) delete row.email;

  return rows.sort(compareRows);
}

const bySoonest = (a: { id: string; fact: PersonFact }, b: { id: string; fact: PersonFact }) => ('until' in a.fact ? a.fact.until : NaN) - ('until' in b.fact ? b.fact.until : NaN) || a.fact.at - b.fact.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

function rowOf(person: Person): PersonRow {
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
    until: invite?.fact.until ?? (ghost && 'until' in ghost.fact ? ghost.fact.until : null) ?? null,
    latest: newest(person.facts)?.at ?? null,
  };
}

const sameName = (name: string) => name.toLocaleLowerCase();

const RANK = { invited: 0, ghost: 1, friend: 2 };

// The order, in one place: invitations, soonest to lapse first; then waiting ghosts, soonest to lapse first; then
// everyone else, the most recent thing between you first, and those with nothing dated by name.
export function compareRows(a: PersonRow, b: PersonRow) {
  return RANK[a.state] - RANK[b.state]
    || (a.state === 'friend' ? 0 : (a.until ?? 0) - (b.until ?? 0))
    || (b.latest ?? -Infinity) - (a.latest ?? -Infinity)
    || (a.latest === null && b.latest === null ? a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) : 0)
    || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
}

// "6 days left", "3 h left", "12 min left": how long until a waiting thing lapses, rounded up.
export function timeLeft(until: number, now = Date.now()) {
  const ms = Math.max(0, until - now);

  if (ms >= DAY) {
    const days = Math.ceil(ms / DAY);

    return `${days} ${days === 1 ? 'day' : 'days'} left`;
  }

  if (ms >= HOUR) return `${Math.ceil(ms / HOUR)} h left`;

  return `${Math.max(1, Math.ceil(ms / MINUTE))} min left`;
}

// A row's quiet line as parts: text, and speeds as { wpm, bare } for the page to show in the chosen unit.
export function lineParts(line: PersonLine | null, now = Date.now()) {
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
export function tallyLabel({ mine, theirs }: { mine: number; theirs: number }) {
  return `${mine} ${mine === 1 ? 'win' : 'wins'}, ${theirs} ${theirs === 1 ? 'loss' : 'losses'}`;
}
