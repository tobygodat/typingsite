import test from 'node:test';
import assert from 'node:assert/strict';
import { createRace, joinRace, getRace, updateRaceProgress, parseRaceLink, makeGuestRaceLink,
  clearRaceLink, rememberRace, recallRace, forgetRace, rematchRace, addFriend, addFriendFromRace,
  listFriends } from '../src/multiplayer.js';

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
