// Drives quick match and Challenge's people list on the local stack the way the app does: real accounts from its
// Auth server, signed in with passwords, calling public.quick_match, public.race_action, public.challenge_action
// and public.race_people through the gateway's PostgREST (/rest/v1/rpc/...) with their own tokens, with the request
// bodies src/multiplayer.ts and src/ghost-race.ts send. Start the stack first with `supabase start`. Run with
// `node supabase/tests/race-service.mjs`.
//
// supabase/tests/quick-match.sql and race-people.sql check each branch inside one transaction as Postgres roles.
// This checks what they can't: that the gateway, the JWTs and the grants let a signed-in browser do the whole
// thing, and that the pieces join up across separate requests and transactions. Nothing is moved by hand: the
// races run on the service's own clock (the 5-second countdown and the 30-second quick match), so this takes
// about a minute. It never reads or writes a private table; every check reads what the app reads.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';

const status = JSON.parse(execFileSync('supabase', ['status', '-o', 'json'], { encoding: 'utf8' }));
const api = status.API_URL;
const anonKey = status.ANON_KEY;
const serviceKey = status.SERVICE_ROLE_KEY;

assert.ok(api && anonKey && serviceKey, 'supabase status names the API URL and both keys');

async function call(path, method, headers, body) {
  const response = await fetch(`${api}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await response.text();

  return { status: response.status, headers: response.headers, json: text ? JSON.parse(text) : null };
}

// A request with an API key, signed in as `token`'s user (or as the key's role when `token` is the key).
const as = (key, token = key) => ({ apikey: key, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' });
const admin = as(serviceKey);

async function signedInUser() {
  const email = `race-test-${randomUUID()}@example.invalid`;
  const password = randomUUID();
  const created = await call('/auth/v1/admin/users', 'POST', admin, { email, password, email_confirm: true });
  assert.equal(created.status, 200, `the Auth server creates ${email}`);
  const session = await call('/auth/v1/token?grant_type=password', 'POST', as(anonKey), { email, password });
  assert.equal(session.status, 200, `${email} signs in`);

  return { id: created.json.id, email, token: session.json.access_token };
}

async function check(name, run) {
  await run();
  console.log(`pass ${name}`);
}

// One RPC as `user`, which must answer 200; `refused` is the same call when it must fail, with the service's message.
async function rpc(user, fn, body) {
  const reply = await call(`/rest/v1/rpc/${fn}`, 'POST', as(anonKey, user.token), body);
  assert.equal(reply.status, 200, `${fn} ${body.p_action ?? ''} answers: ${JSON.stringify(reply.json)}`);

  return reply.json;
}

async function refused(user, fn, body) {
  const reply = await call(`/rest/v1/rpc/${fn}`, 'POST', as(anonKey, user.token), body);
  assert.notEqual(reply.status, 200, `${fn} ${body.p_action ?? ''} is refused`);

  return reply.json?.message;
}

// The bodies src/multiplayer.ts and src/ghost-race.ts post.
const race = (user, action, roomId = null, data = {}) => rpc(user, 'race_action', { p_action: action, p_room_id: roomId, p_guest_token: null, p_data: data });
const quick = (user, action, data = {}) => rpc(user, 'quick_match', { p_action: action, p_data: data });
const challenge = (user, action, id = null, data = {}) => rpc(user, 'challenge_action', { p_action: action, p_id: id, p_data: data });
const people = (user) => rpc(user, 'race_people', {});

// A run's compact trace ({v, k, t, e}, encodeTrace in src/ghost-race.ts), as quick-match.sql's trace_of builds it:
// the first `count` letters of the passage with no mistakes, a key every `step` ms after a first key at 500 ms,
// ending at `end` ms (the race clock on a timed run) or on the last key.
function traceOf(text, count, step, end = null) {
  const t = Array.from({ length: count }, (_, i) => (i === 0 ? 500 : step));

  return { v: 1, k: text.slice(0, count), t, e: end ?? t.reduce((sum, ms) => sum + ms, 0) };
}

// Waits until `ms` after a room's start on the service's clock, read from the snapshot's serverNow.
async function atRaceTime(snapshot, ms, readAt) {
  const offset = Date.parse(snapshot.serverNow) - readAt;
  const wait = Date.parse(snapshot.startAt) + ms - offset - Date.now();

  if (wait > 0) await sleep(wait);
}

async function snapshotOf(user, roomId) {
  const readAt = Date.now();

  return { room: await race(user, 'get', roomId), readAt };
}

// A finishing packet as the race page sends it: the text kept, its counts and the run's trace.
const finish = (user, roomId, passage, trace, sequence) => race(user, 'progress', roomId,
  { typed: passage.slice(0, trace.k.length), keystrokes: trace.k.length, errors: 0, finished: true, sequence, trace });

const ada = await signedInUser();
const lin = await signedInUser();
const kai = await signedInUser();
let quickRoom;

await check('quick match pairs two signed-in accounts into one standard room', async () => {
  assert.deepEqual(await quick(ada, 'rating'), { rating: 1500, races: 0 }, 'a new account reads 1500 with no rated races');
  assert.deepEqual(await quick(lin, 'rating'), { rating: 1500, races: 0 });

  const waiting = await quick(ada, 'queue', { displayName: 'Ada' });
  assert.equal(waiting.state, 'waiting', 'alone, Ada waits');
  const paired = await quick(lin, 'queue', { displayName: 'Lin' });
  assert.equal(paired.state, 'paired', 'Lin is paired with Ada at once');
  quickRoom = paired.roomId;
  assert.equal(paired.room.quick, true);
  assert.equal(paired.room.status, 'countdown');
  assert.equal(paired.room.selfSlot, 2);
  assert.equal(paired.room.duration, 30);
  assert.deepEqual(paired.room.conditions, { mode: 'time', duration: 30, punctuation: false, numbers: false, wordList: '200',
    correctionPolicy: 'mandatory', onlineRace: true, language: 'en', inputClass: 'physical-keyboard', corpus: 'original-en-v6',
    metricVersion: 'stilltype-metrics-v1' }, 'the standard setup');
  assert.deepEqual(paired.room.players.map((player) => player.name), ['Ada', 'Lin']);

  for (const secret of [ada.id, lin.id, ada.email, lin.email]) assert.ok(!JSON.stringify(paired).includes(secret), 'the reply shows no email or account id');

  // Ada's next poll finds the same room, with her seat.
  const found = await quick(ada, 'queue', { displayName: 'Ada' });
  assert.equal(found.state, 'paired');
  assert.equal(found.roomId, quickRoom, 'both are in one room');
  assert.equal(found.room.selfSlot, 1);
  assert.ok(await refused(kai, 'race_action', { p_action: 'get', p_room_id: quickRoom, p_guest_token: null, p_data: {} }), 'a third account has no place in it');
});

await check('both race the standard setup on the service clock and the result is rated', async () => {
  // Each browser asks about the room during the countdown, so both seats are there when it starts.
  const { room, readAt } = await snapshotOf(ada, quickRoom);
  await snapshotOf(lin, quickRoom);
  const passage = room.passage;
  assert.ok(passage.length >= 991 && passage.length <= 1000 && /^[a-z ]+$/.test(passage), 'the service drew a standard passage');

  await atRaceTime(room, 1500, readAt);

  for (const [user, sequence] of [[ada, 1], [lin, 1]]) {
    const live = await race(user, 'progress', quickRoom, { typed: passage.slice(0, 10), keystrokes: 10, errors: 0, finished: false, sequence });
    assert.equal(live.status, 'racing');
  }

  // Both finish on the 30-second clock with honest runs: Ada 245 letters (98 wpm), Lin 200 (80 wpm).
  const adaRun = traceOf(passage, 245, 120, 30000);
  const linRun = traceOf(passage, 200, 148, 30000);
  await atRaceTime(room, 30500, readAt);
  const first = await finish(ada, quickRoom, passage, adaRun, 2);
  assert.equal(first.status, 'racing', 'the race waits for the other finish');
  const settled = await finish(lin, quickRoom, passage, linRun, 2);
  assert.equal(settled.status, 'finished', 'the second finish settles the race');

  const adaView = (await race(ada, 'get', quickRoom));
  assert.deepEqual(adaView.rating, { rated: true, reason: null, outcome: 'won', before: 1500, after: 1520, delta: 20, races: 1 });
  assert.deepEqual(settled.rating, { rated: true, reason: null, outcome: 'lost', before: 1500, after: 1480, delta: -20, races: 1 });
  assert.deepEqual(adaView.players.map((player) => [player.outcome, player.checked]), [['won', true], ['lost', true]], 'both runs passed the trace check');
  assert.deepEqual(adaView.tally, [1, 0]);
  assert.deepEqual(settled.tally, [0, 1]);

  // Graph and Replay read both kept traces.
  assert.deepEqual((await race(lin, 'traces', quickRoom)).traces, [{ slot: 1, trace: adaRun }, { slot: 2, trace: linRun }]);

  // The rating line reads the settled result: each account's rated_results row and its moved rating.
  assert.deepEqual(await quick(ada, 'rating'), { rating: 1520, races: 1,
    last: { roomId: quickRoom, rated: true, reason: null, outcome: 'won', before: 1500, after: 1520, delta: 20, races: 1 } });
  assert.deepEqual(await quick(lin, 'rating'), { rating: 1480, races: 1,
    last: { roomId: quickRoom, rated: true, reason: null, outcome: 'lost', before: 1500, after: 1480, delta: -20, races: 1 } });
  assert.deepEqual(await quick(kai, 'rating'), { rating: 1500, races: 0 }, 'a third account is untouched');
});

let adaRow;
let linRow;
let inviteRoom;
let ghost;
const invitePassage = 'the quick brown fox jumps over the lazy dog and the race goes on';

await check('the racers add each other from the race, and the people list shows the tally', async () => {
  const adaFriends = await race(ada, 'befriend', quickRoom);
  const linFriends = await race(lin, 'befriend', quickRoom);
  assert.equal(adaFriends.length, 1);
  assert.equal(linFriends.length, 1);
  assert.deepEqual([adaFriends[0].name, adaFriends[0].account, linFriends[0].name, linFriends[0].account], ['Lin', true, 'Ada', true]);

  for (const secret of [ada.id, lin.id, ada.email, lin.email]) assert.ok(!JSON.stringify([adaFriends, linFriends]).includes(secret), 'a friend row raced before shows no email or id');
  adaRow = adaFriends[0].id;
  linRow = linFriends[0].id;
  assert.deepEqual(await race(ada, 'friends'), adaFriends);

  assert.deepEqual(await people(ada), { friends: [{ id: adaRow, tally: [1, 0] }], invites: [], challenges: [] });
  assert.deepEqual(await people(lin), { friends: [{ id: linRow, tally: [0, 1] }], invites: [], challenges: [] });
});

await check('an invitation and a ghost challenge to a friend link to that friend\'s row', async () => {
  // Challenge on a friend row: an account invitation to the friend (createRace with friendId).
  const conditions = { mode: 'words', count: 14, punctuation: false, numbers: false, wordList: '200', correctionPolicy: 'mandatory',
    onlineRace: true, language: 'en', inputClass: 'physical-keyboard', corpus: 'original-en-v6', metricVersion: 'stilltype-metrics-v1' };

  const created = await race(ada, 'create', null, { passage: invitePassage, conditions, displayName: 'Ada', inviteEmail: '', friendId: adaRow });
  inviteRoom = created.roomId;
  assert.equal(created.room.inviteKind, 'account');
  assert.equal(created.inviteToken, undefined, 'an account invitation has no guest link');
  const invites = await race(lin, 'invites');
  assert.deepEqual(invites.map((invite) => [invite.id, invite.hostName]), [[inviteRoom, 'Ada']], 'Lin\'s inbox has it');

  // A ghost challenge of a finished 12-word run, sent to the same friend (sendChallenge).
  const ghostPassage = 'the race goes on and on for those who type it well';

  const ghostConditions = { mode: 'words', count: 12, punctuation: false, numbers: false, wordList: '200', correctionPolicy: 'mandatory',
    language: 'en', inputClass: 'physical-keyboard', corpus: 'original-en-v6', metricVersion: 'stilltype-metrics-v1', sourceKind: 'test' };

  const sent = await challenge(ada, 'send', null, { requestId: randomUUID(), friendId: adaRow, displayName: 'Ada', passage: ghostPassage,
    duration: null, conditions: ghostConditions, trace: traceOf(ghostPassage, ghostPassage.length, 150) });

  ghost = sent.id;
  assert.equal(sent.status, 'open');
  assert.deepEqual((await challenge(lin, 'list')).map((row) => [row.id, row.role, row.name]), [[ghost, 'received', 'Ada']]);

  assert.deepEqual(await people(ada), { friends: [{ id: adaRow, tally: [1, 0] }], invites: [], challenges: [{ id: ghost, friendId: adaRow }] },
    'the host sees the ghost it sent, and no invitation of its own');
  assert.deepEqual(await people(lin), { friends: [{ id: linRow, tally: [0, 1] }], invites: [{ id: inviteRoom, friendId: linRow }],
    challenges: [{ id: ghost, friendId: linRow }] }, 'the friend sees the invitation and the ghost on Ada\'s row');
});

await check('a third account sees none of it', async () => {
  assert.deepEqual(await people(kai), { friends: [], invites: [], challenges: [] });
  assert.deepEqual(await race(kai, 'friends'), []);
  assert.deepEqual(await race(kai, 'invites'), []);
  assert.deepEqual(await challenge(kai, 'list'), []);
  assert.match(await refused(kai, 'race_action', { p_action: 'join', p_room_id: inviteRoom, p_guest_token: null,
    p_data: { inviteToken: null, displayName: 'Kai' } }), /belongs to another account/);
  assert.match(await refused(kai, 'challenge_action', { p_action: 'get', p_id: ghost, p_data: {} }), /unavailable/);
  assert.notEqual((await call('/rest/v1/rpc/race_people', 'POST', as(anonKey), {})).status, 200, 'a guest has no people list');
});

await check('the invited race moves the tally and the invitation drops out', async () => {
  await race(lin, 'join', inviteRoom, { inviteToken: null, displayName: 'Lin' });
  assert.deepEqual((await people(lin)).invites, [], 'a joined invitation is no longer open');
  await race(ada, 'ready', inviteRoom, { ready: true });
  const readAt = Date.now();
  const room = await race(lin, 'ready', inviteRoom, { ready: true });
  assert.equal(room.status, 'countdown', 'both ready starts the countdown');

  const run = traceOf(invitePassage, invitePassage.length, 15);
  await atRaceTime(room, 1000, readAt);
  await finish(ada, inviteRoom, invitePassage, run, 1);
  await atRaceTime(room, 2000, readAt);
  const done = await finish(lin, inviteRoom, invitePassage, run, 1);
  assert.equal(done.status, 'finished');
  assert.deepEqual(done.tally, [0, 2], 'Ada finished first');

  assert.deepEqual(await people(ada), { friends: [{ id: adaRow, tally: [2, 0] }], invites: [], challenges: [{ id: ghost, friendId: adaRow }] });
  assert.deepEqual(await people(lin), { friends: [{ id: linRow, tally: [0, 2] }], invites: [], challenges: [{ id: ghost, friendId: linRow }] });
  assert.deepEqual(await people(kai), { friends: [], invites: [], challenges: [] });
});
