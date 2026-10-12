import test from 'node:test';
import assert from 'node:assert/strict';
import { createRace, joinRace, getRace, updateRaceProgress, parseRaceLink, makeGuestRaceLink,
  clearRaceLink, rememberRace, recallRace, forgetRace, rematchRace, addFriend, addFriendFromRace,
  listFriends, removeFriend, queueFriendRequests } from '../src/multiplayer.js';

const roomId = '00000000-0000-4000-8000-000000000001';
const inviteToken = 'a'.repeat(64);
const guestToken = 'b'.repeat(64);
const session = { user: { id: 'host' }, access_token: 'account-token', expires_at: 9999999999 };

test('guest links keep capabilities in fragments and remove auth redirect parameters', () => {
  const link = makeGuestRaceLink({roomId,inviteToken}, 'https://stilltype.example/?code=used&foo=bar#access_token=private');
  assert.equal(new URL(link).searchParams.get('code'), null);
  assert.equal(new URL(link).searchParams.get('foo'), 'bar');
  assert.deepEqual(parseRaceLink(link), {roomId,inviteToken});
  assert.equal(parseRaceLink('https://stilltype.example/#race=invalid&invite=' + inviteToken), null);
  assert.equal(parseRaceLink(clearRaceLink(link)), null);
  assert.throws(() => makeGuestRaceLink({roomId,inviteToken:'short'}, link));
});

test('host sign-in is required before a request is made', () => {
  assert.throws(() => createRace(null, {passage:'text',displayName:'Host'}), /Sign in/);
});

test('RPC requests send the correct role and keep invite tokens out of subsequent progress calls', async () => {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    const data = JSON.parse(options.body);
    calls.push({url,headers:options.headers,data});
    const room = {id:roomId,selfSlot:2,passage:'The shared passage.',conditions:{textId:'quote-id'},players:[{slot:2,sequence:12}]};
    return new Response(JSON.stringify(data.p_action === 'join' ? {roomId,guestToken,room} : data.p_action === 'create' ? {roomId,inviteToken,room} : room));
  };
  try {
    const created = await createRace(session,{passage:{id:'quote-id',text:'The shared passage.'},displayName:'Host'});
    assert.equal(calls[0].headers.Authorization,'Bearer account-token');
    assert.equal(calls[0].data.p_data.passage,'The shared passage.');
    assert.equal(calls[0].data.p_data.conditions.textId,'quote-id');
    assert.deepEqual(created.room.passage,{id:'quote-id',text:'The shared passage.'});
    const joined = await joinRace(null,{roomId,inviteToken,displayName:'Guest'});
    assert.equal(calls[1].headers.Authorization,undefined);
    assert.equal(joined.guestToken,guestToken);
    await getRace(null,{roomId,guestToken});
    await updateRaceProgress(null,{roomId,guestToken},{typed:'The',keystrokes:3,errors:0});
    assert.equal(calls[3].data.p_guest_token,guestToken);
    assert.equal(calls[3].data.p_data.inviteToken,undefined);
    assert.equal(calls[3].data.p_data.sequence,13);
  } finally { globalThis.fetch = original; }
});

test('reconnect credentials expire within the tab without storing any run profile', () => {
  const original = globalThis.sessionStorage;
  const values = new Map();
  globalThis.sessionStorage = {getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};
  try {
    rememberRace({roomId,guestToken});
    assert.equal(recallRace().guestToken,guestToken);
    assert.equal(values.size,1);
    const key = [...values.keys()][0];
    values.set(key, JSON.stringify({roomId,guestToken,savedAt:Date.now()-21*60*1000}));
    assert.equal(recallRace(),null);
    assert.equal(values.size,0);
    rememberRace({roomId,guestToken}); forgetRace(); assert.equal(values.size,0);
  } finally { globalThis.sessionStorage = original; }
});

test('friend races send only the friend id, and rematches keep the guest seat', async () => {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    const data = JSON.parse(options.body);
    calls.push(data);
    const room = {id:roomId,selfSlot:2,passage:'A fresh passage.',conditions:{textId:'next'},players:[{slot:2,sequence:0}]};
    return new Response(JSON.stringify(['friends','befriend'].includes(data.p_action) ? [] : {roomId,guestToken,room}));
  };
  try {
    await createRace(session,{passage:{id:'q',text:'The shared passage.'},displayName:'Host',inviteEmail:'typed@example.com',friendId:roomId});
    assert.equal(calls[0].p_data.friendId,roomId);
    assert.equal(calls[0].p_data.inviteEmail,'');
    await rematchRace(null,{roomId,guestToken},{passage:{id:'next',text:'A fresh passage.'},conditions:{quoteLength:'medium',textId:'old'}});
    assert.equal(calls[1].p_action,'rematch');
    assert.equal(calls[1].p_guest_token,guestToken);
    assert.equal(calls[1].p_room_id,roomId);
    assert.deepEqual(calls[1].p_data,{passage:'A fresh passage.',conditions:{quoteLength:'medium',textId:'next'}});
    await addFriend(session,{email:' lin@example.com ',name:' Lin '});
    assert.deepEqual(calls[2].p_data,{email:'lin@example.com',name:'Lin'});
    await addFriendFromRace(session,{roomId,guestToken});
    assert.equal(calls[3].p_room_id,roomId);
    assert.equal(calls[3].p_guest_token,null);
    assert.deepEqual(await listFriends(null),[]);
    assert.equal(calls.length,4);
  } finally { globalThis.fetch = original; }
});

// A friend-list service the test answers by hand. `sent` lists each request as the queue sends it.
function friendService() {
  const sent = [];
  const send = (name) => (signal) => new Promise((resolve, reject) => { sent.push({ name, signal, resolve, reject }); });
  return { sent, send, names: () => sent.map((request) => request.name) };
}
const settle = () => new Promise((resolve) => { setImmediate(resolve); });

test('a removal made while a save is still out is sent after it, so the save’s reply can’t bring the friend back', async () => {
  const { sent, send, names } = friendService();
  const shown = [];
  const friends = queueFriendRequests((list) => { shown.push(list); });
  // Creating a race saves Lin in the background; with that save out, Kim is removed.
  const saving = friends.change(send('befriend lin'));
  const removing = friends.change(send('unfriend kim'));
  await settle();
  assert.deepEqual(names(), ['befriend lin']);
  // The service has both; the save's reply is the list before the removal.
  sent[0].resolve(['kim', 'lin']);
  await saving;
  await settle();
  assert.deepEqual(names(), ['befriend lin', 'unfriend kim']);
  sent[1].resolve(['lin']);
  await removing;
  assert.deepEqual(shown, [['kim', 'lin'], ['lin']]);
});

test('a failed save neither drops nor holds up the friend list read before or after it', async () => {
  const { sent, send, names } = friendService();
  let shown = null;
  const friends = queueFriendRequests((list) => { shown = list; });
  // A slow first read, then a background save that fails.
  const reading = friends.reload(send('friends'));
  const saving = friends.change(send('befriend lin'));
  await settle();
  sent[0].resolve(['kim']);
  assert.deepEqual(await reading, ['kim']);
  assert.deepEqual(shown, ['kim']);
  await settle();
  sent[1].reject(new Error('offline'));
  await assert.rejects(saving, /offline/);
  assert.deepEqual(shown, ['kim']);
  // A save that fails first leaves the read queued behind it to apply.
  const failing = friends.change(send('befriend ada'));
  const after = friends.reload(send('friends'));
  await settle();
  sent[2].reject(new Error('offline'));
  await assert.rejects(failing, /offline/);
  await settle();
  sent[3].resolve(['kim', 'lin']);
  await after;
  assert.deepEqual(shown, ['kim', 'lin']);
  assert.deepEqual(names(), ['friends', 'befriend lin', 'befriend ada', 'friends']);
});

test('friend-list reloads queued back to back go as one, and never ahead of a change', async () => {
  const { sent, send, names } = friendService();
  let shown = null;
  const friends = queueFriendRequests((list) => { shown = list; });
  const first = friends.reload(send('friends'));
  const second = friends.reload(send('friends'));
  const third = friends.reload(send('friends'));
  assert.equal(second, first);
  assert.equal(third, first);
  const removing = friends.change(send('unfriend kim'));
  const last = friends.reload(send('friends'));
  assert.notEqual(last, first);
  await settle();
  sent[0].resolve(['kim', 'lin']);
  await first;
  // A reload already sent is not joined: the next one is its own request.
  await settle();
  sent[1].resolve(['lin']);
  await removing;
  await settle();
  sent[2].resolve(['lin']);
  await last;
  assert.deepEqual(names(), ['friends', 'unfriend kim', 'friends']);
  assert.deepEqual(shown, ['lin']);
});

test('a friend-list request that never answers gives up after the limit, aborts its fetch, and lets the next one go', { timeout: 5000 }, async () => {
  const { sent, send, names } = friendService();
  const shown = [];
  const friends = queueFriendRequests((list) => { shown.push(list); }, { limit: 20 });
  // A list read stalls (the connection never answers), and a removal is queued behind it.
  const stalled = friends.reload(send('friends'));
  const removing = friends.change(send('unfriend kim'));
  await assert.rejects(stalled, /taking too long/);
  assert.equal(sent[0].signal.aborted, true);
  await settle();
  assert.deepEqual(names(), ['friends', 'unfriend kim']);
  // An answer that comes after the limit is not drawn.
  sent[0].resolve(['kim', 'lin']);
  sent[1].resolve(['lin']);
  await removing;
  assert.deepEqual(shown, [['lin']]);
});

test('friend-list calls hand their abort signal to fetch', async () => {
  const original = globalThis.fetch;
  const signals = [];
  globalThis.fetch = async (url, options) => { signals.push(options.signal); return new Response('[]'); };
  try {
    const { signal } = new AbortController();
    await listFriends(session, signal);
    await addFriend(session, { email: 'lin@example.com' }, signal);
    await removeFriend(session, roomId, signal);
    await addFriendFromRace(session, { roomId }, signal);
    assert.deepEqual(signals, [signal, signal, signal, signal]);
  } finally { globalThis.fetch = original; }
});
