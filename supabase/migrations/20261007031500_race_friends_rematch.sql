-- Friends and rematches for private online races.
-- A friend is a private contact on the owner's list: either an email the owner typed (resolved only
-- when a race is created, exactly like a typed invite) or an account the owner has raced. Friend rows
-- never expose another account's email or id to the browser.
-- A rematch opens a new room for the same two seats: an account keeps its seat by account, a guest by
-- the same seat capability, so nobody re-enters an email or a link.

create table race_private.friends (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  friend_id uuid references auth.users(id) on delete cascade,
  email text check (email is null or length(email) <= 254),
  name text not null check (length(name) between 1 and 40),
  created_at timestamptz not null default now(),
  check ((friend_id is null) <> (email is null)),
  check (friend_id is distinct from owner_id)
);
create unique index friends_owner_account on race_private.friends (owner_id, friend_id) where friend_id is not null;
create unique index friends_owner_email on race_private.friends (owner_id, email) where email is not null;
alter table race_private.friends enable row level security;
revoke all on race_private.friends from public, anon, authenticated;

alter table race_private.rooms
  add column rematch_of uuid references race_private.rooms(id) on delete set null,
  add column rematch_id uuid references race_private.rooms(id) on delete set null,
  add column rematch_slot integer check (rematch_slot in (1,2)),
  -- Who asked for the room, for quotas: the host for a new race, either racer for a rematch.
  -- 'user:<id>' for an account, 'guest:<seat hash>' for a guest, whose seat capability carries over.
  add column opened_by text;
update race_private.rooms set opened_by = 'user:' || host_id::text where opened_by is null;
alter table race_private.rooms alter column opened_by set not null;
create index rooms_opened_by on race_private.rooms (opened_by, created_at);

create or replace function race_private.friend_list(p_owner uuid)
returns jsonb language sql set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'name', f.name, 'account', f.friend_id is not null)
    || case when f.email is not null then jsonb_build_object('email', f.email) else '{}'::jsonb end
    order by lower(f.name), f.created_at), '[]'::jsonb)
  from race_private.friends f where f.owner_id = p_owner
$$;
revoke all on function race_private.friend_list(uuid) from public, anon, authenticated;

-- Shared by create and rematch: validation, cleanup and quotas for whoever asked, then the room row.
create or replace function race_private.open_room(p_host uuid, p_invited uuid, p_kind text, p_hash text,
  p_passage text, p_conditions jsonb, p_rematch_of uuid, p_opener text)
returns race_private.rooms language plpgsql set search_path = '' as $$
declare
  v_now timestamptz := clock_timestamp();
  v_room race_private.rooms%rowtype;
begin
  -- Serialize per requester to make quotas reliable under concurrent requests.
  perform pg_advisory_xact_lock(hashtextextended(p_opener, 0));
  -- Terminal room data is transient; opportunistic cleanup needs no scheduler.
  -- A rematch's source room stays: the new room points back at it.
  delete from race_private.rooms where expires_at < v_now - interval '1 day' and id is distinct from p_rematch_of;
  if (select count(*) from race_private.rooms where opened_by = p_opener and created_at > v_now - interval '1 hour') >= 10 then
    raise exception 'You have created several races. Please wait before hosting another.';
  end if;
  if (select count(*) from race_private.rooms where opened_by = p_opener and status in ('waiting','countdown','racing') and expires_at > v_now) >= 3 then
    raise exception 'Close an existing race before creating another.';
  end if;
  if p_passage is null or length(p_passage) not between 40 and 8000 or p_passage ~ '[^ -~]' then raise exception 'Use a passage of 40 to 8000 ordinary English characters.'; end if;
  if jsonb_typeof(coalesce(p_conditions,'{}')) <> 'object' or octet_length(coalesce(p_conditions,'{}')::text) > 2000 then raise exception 'Invalid race conditions.'; end if;
  insert into race_private.rooms(host_id, invited_id, invite_kind, invite_hash, passage, conditions, rematch_of, opened_by)
    values (p_host, p_invited, p_kind, p_hash, p_passage, coalesce(p_conditions, '{}'), p_rematch_of, p_opener)
    returning * into v_room;
  return v_room;
end $$;
revoke all on function race_private.open_room(uuid,uuid,text,text,text,jsonb,uuid,text) from public, anon, authenticated;

create or replace function race_private.snapshot(p_room_id uuid, p_slot integer)
returns jsonb language sql set search_path = '' as $$
 select jsonb_build_object(
   'id', r.id, 'status', r.status, 'passage', r.passage, 'conditions', r.conditions,
   'duration', r.duration, 'startAt', r.start_at, 'serverNow', clock_timestamp(),
   'expiresAt', r.expires_at, 'selfSlot', p_slot, 'inviteKind', r.invite_kind,
   'rematchOf', r.rematch_of, 'rematchId', r.rematch_id, 'rematchSlot', r.rematch_slot,
   'rematchBy', (select m.name from race_private.players m where m.room_id = r.id and m.slot = r.rematch_slot),
   'rematchExpiresAt', (select n.expires_at from race_private.rooms n where n.id = r.rematch_id),
   'rematchOpen', exists(select 1 from race_private.rooms n where n.id = r.rematch_id
     and n.status = 'waiting' and n.expires_at > clock_timestamp()),
   'players', coalesce((select jsonb_agg(jsonb_build_object(
     'slot', p.slot, 'name', p.name, 'ready', p.ready,
     'progress', round(p.correct::numeric / length(r.passage) * 100, 1),
     'finished', p.finished, 'elapsed', p.elapsed,
     'wpm', case when p.elapsed > 0 then round(p.correct::numeric / 5 / (p.elapsed / 60)) else 0 end,
     'accuracy', case when p.keystrokes > 0 then round((p.keystrokes - p.errors)::numeric / p.keystrokes * 100) else 100 end,
     'connected', p.last_seen > clock_timestamp() - interval '10 seconds',
     'account', p.user_id is not null,
     'friend', p.user_id is not null and exists(select 1 from race_private.friends f where f.friend_id = p.user_id
       and f.owner_id = (select s.user_id from race_private.players s where s.room_id = r.id and s.slot = p_slot))
   ) || case when p.slot = p_slot then jsonb_build_object('typed', p.typed, 'keystrokes', p.keystrokes,
     'errors', p.errors, 'sequence', p.sequence) else '{}'::jsonb end order by p.slot)
     from race_private.players p where p.room_id = r.id), '[]'::jsonb))
 from race_private.rooms r where r.id = p_room_id
$$;
revoke all on function race_private.snapshot(uuid, integer) from public, anon, authenticated;

create or replace function race_private.action(p_action text, p_room_id uuid, p_data jsonb, p_guest_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_room race_private.rooms%rowtype;
  v_next race_private.rooms%rowtype;
  v_player race_private.players%rowtype;
  v_friend race_private.friends%rowtype;
  v_now timestamptz := clock_timestamp();
  v_name text;
  v_token text;
  v_hash text;
  v_email text;
  v_invited uuid;
  v_other uuid;
  v_slot integer;
  v_typed text;
  v_keys integer;
  v_errors integer;
  v_sequence integer;
  v_correct integer;
  v_added integer;
  v_elapsed numeric;
  v_finished boolean;
  v_result jsonb;
begin
  if p_data is null or jsonb_typeof(p_data) <> 'object' then raise exception 'Invalid race request.'; end if;
  if p_guest_token is not null then
    if p_guest_token !~ '^[0-9a-f]{64}$' then raise exception 'That guest seat is not valid.'; end if;
    v_hash := encode(extensions.digest(p_guest_token, 'sha256'), 'hex');
  end if;

  if p_action = 'create' then
    if v_uid is null or not exists(select 1 from auth.users where id = v_uid) then raise exception 'Sign in to host an online race.'; end if;
    v_name := btrim(coalesce(p_data->>'displayName', ''));
    v_email := lower(btrim(coalesce(p_data->>'inviteEmail', '')));
    if length(v_name) not between 1 and 40 or v_name ~ '[[:cntrl:]]' then raise exception 'Use a racer name of 1 to 40 characters.'; end if;
    if coalesce(p_data->>'friendId', '') <> '' then
      if p_data->>'friendId' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'That friend is no longer on your list.'; end if;
      select * into v_friend from race_private.friends where id = (p_data->>'friendId')::uuid and owner_id = v_uid;
      if not found then raise exception 'That friend is no longer on your list.'; end if;
      v_invited := v_friend.friend_id;
      v_email := coalesce(v_friend.email, '');
    end if;
    if v_email <> '' then
      if length(v_email) > 254 or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'Enter a valid account email.'; end if;
      select id into v_invited from auth.users where lower(email) = v_email and email_confirmed_at is not null limit 1;
      if v_invited = v_uid then raise exception 'Invite someone other than yourself.'; end if;
    elsif v_friend.id is null then
      v_token := encode(extensions.gen_random_bytes(32), 'hex');
    end if;
    v_room := race_private.open_room(v_uid, v_invited, case when v_token is null then 'account' else 'guest' end,
      case when v_token is not null then encode(extensions.digest(v_token,'sha256'),'hex') end,
      p_data->>'passage', p_data->'conditions', null, 'user:' || v_uid::text);
    insert into race_private.players(room_id,slot,user_id,name) values(v_room.id,1,v_uid,v_name);
    return jsonb_build_object('roomId',v_room.id,'room',race_private.snapshot(v_room.id,1))
      || case when v_token is not null then jsonb_build_object('inviteToken',v_token) else '{}'::jsonb end;
  end if;

  if p_action = 'invites' then
    if v_uid is null then raise exception 'Sign in to see race invites.'; end if;
    -- The other seated racer names the invitation: the host for a new race, either player for a rematch.
    select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'hostName',p.name,'createdAt',r.created_at,
        'expiresAt',r.expires_at,'rematch',r.rematch_of is not null) order by r.created_at desc),'[]'::jsonb)
      into v_result from race_private.rooms r
      join race_private.players p on p.room_id=r.id and p.user_id is distinct from v_uid
      where r.invited_id=v_uid and r.status='waiting' and r.expires_at > v_now
        -- Accepted invitations drop out: a joined seat, or a rematch seat its holder has opened.
        and not exists(select 1 from race_private.players s where s.room_id=r.id and s.user_id=v_uid
          and s.last_seen > '-infinity'::timestamptz);
    return v_result;
  end if;

  if p_action in ('friends','befriend','unfriend') and p_room_id is null then
    if v_uid is null or not exists(select 1 from auth.users where id = v_uid) then raise exception 'Sign in to keep a friend list.'; end if;
    if p_action = 'befriend' then
      v_email := lower(btrim(coalesce(p_data->>'email', '')));
      v_name := btrim(coalesce(p_data->>'name', ''));
      if length(v_email) > 254 or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'Enter a valid account email.'; end if;
      if v_email = (select lower(email) from auth.users where id = v_uid) then raise exception 'That’s your own account.'; end if;
      if v_name = '' then v_name := left(split_part(v_email, '@', 1), 40); end if;
      if length(v_name) not between 1 and 40 or v_name ~ '[[:cntrl:]]' then raise exception 'Use a friend name of 1 to 40 characters.'; end if;
      if not exists(select 1 from race_private.friends where owner_id = v_uid and email = v_email)
        and (select count(*) from race_private.friends where owner_id = v_uid) >= 100 then raise exception 'Your friend list is full. Remove someone first.'; end if;
      insert into race_private.friends(owner_id, email, name) values (v_uid, v_email, v_name)
        on conflict (owner_id, email) where email is not null do update set name = excluded.name;
    elsif p_action = 'unfriend' then
      if coalesce(p_data->>'friendId','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'That friend is no longer on your list.'; end if;
      delete from race_private.friends where id = (p_data->>'friendId')::uuid and owner_id = v_uid;
    end if;
    return race_private.friend_list(v_uid);
  end if;

  select * into v_room from race_private.rooms where id=p_room_id for update;
  if not found then raise exception 'That race is unavailable or has expired.'; end if;
  select * into v_player from race_private.players where room_id=p_room_id
    and ((v_uid is not null and user_id=v_uid) or (v_hash is not null and guest_hash=v_hash)) limit 1;
  v_slot := v_player.slot;

  if p_action = 'join' and v_slot is null then
    if v_room.expires_at <= v_now or v_room.status <> 'waiting' then raise exception 'This race is no longer accepting racers.'; end if;
    if exists(select 1 from race_private.players where room_id=p_room_id and slot=2) then raise exception 'This race already has two racers.'; end if;
    if v_room.invite_kind='account' then
      if v_uid is null or v_room.invited_id is distinct from v_uid then raise exception 'This invite belongs to another account.'; end if;
    elsif coalesce(p_data->>'inviteToken','') !~ '^[0-9a-f]{64}$'
      or encode(extensions.digest(p_data->>'inviteToken','sha256'),'hex') is distinct from v_room.invite_hash then
      raise exception 'That race link is not valid.';
    end if;
    v_name := btrim(coalesce(p_data->>'displayName',''));
    if length(v_name) not between 1 and 40 or v_name ~ '[[:cntrl:]]' then raise exception 'Use a racer name of 1 to 40 characters.'; end if;
    if v_uid is null then v_token := encode(extensions.gen_random_bytes(32), 'hex'); end if;
    insert into race_private.players(room_id,slot,user_id,guest_hash,name) values(p_room_id,2,v_uid,
      case when v_token is not null then encode(extensions.digest(v_token,'sha256'),'hex') end,v_name);
    return jsonb_build_object('roomId',p_room_id,'room',race_private.snapshot(p_room_id,2))
      || case when v_token is not null then jsonb_build_object('guestToken',v_token) else '{}'::jsonb end;
  end if;

  if v_slot is null then raise exception 'You do not have a place in this race.'; end if;
  update race_private.players set last_seen=v_now where room_id=p_room_id and slot=v_slot;
  if v_room.status in ('waiting','countdown','racing') and v_room.expires_at <= v_now then
    update race_private.rooms set status='expired' where id=p_room_id; v_room.status := 'expired';
  end if;
  if v_room.status='countdown' and v_room.start_at <= v_now then
    update race_private.rooms set status='racing' where id=p_room_id; v_room.status := 'racing';
  end if;
  -- A small grace period accepts the final network packet; server elapsed stays capped at 60 s.
  if v_room.status='racing' and v_now >= v_room.start_at + interval '70 seconds' then
    update race_private.players set finished=true,elapsed=60 where room_id=p_room_id and not finished;
    update race_private.rooms set status='finished' where id=p_room_id; v_room.status := 'finished';
  end if;

  if p_action='join' then
    return jsonb_build_object('roomId',p_room_id,'room',race_private.snapshot(p_room_id,v_slot))
      || case when v_player.guest_hash is not null then jsonb_build_object('guestToken',p_guest_token) else '{}'::jsonb end;
  elsif p_action='get' then null;
  elsif p_action='leave' then
    if v_room.status in ('waiting','countdown','racing') then
      update race_private.rooms set status='cancelled' where id=p_room_id;
    end if;
  elsif p_action='ready' then
    if v_room.status <> 'waiting' then raise exception 'The race has already started or closed.'; end if;
    if jsonb_typeof(p_data->'ready') <> 'boolean' or not (p_data ? 'ready') then raise exception 'Invalid ready state.'; end if;
    update race_private.players set ready=(p_data->>'ready')::boolean where room_id=p_room_id and slot=v_slot;
    if (select count(*) from race_private.players where room_id=p_room_id and ready) = 2 then
      update race_private.rooms set status='countdown',start_at=v_now + interval '5 seconds' where id=p_room_id;
    end if;
  elsif p_action='progress' then
    if v_room.status='finished' then return race_private.snapshot(p_room_id,v_slot); end if;
    if v_room.status <> 'racing' or v_now < v_room.start_at then raise exception 'Wait for the shared countdown to finish.'; end if;
    if v_player.finished then return race_private.snapshot(p_room_id,v_slot); end if;
    if jsonb_typeof(p_data->'typed') <> 'string' or not (p_data ? 'typed') then raise exception 'Invalid typing progress.'; end if;
    v_typed := p_data->>'typed';
    if coalesce(p_data->>'keystrokes','') !~ '^[0-9]{1,5}$' or coalesce(p_data->>'errors','') !~ '^[0-9]{1,5}$'
      or coalesce(p_data->>'sequence','') !~ '^[0-9]{1,9}$' or jsonb_typeof(p_data->'finished') <> 'boolean' then raise exception 'Invalid typing counters.'; end if;
    v_keys := (p_data->>'keystrokes')::integer; v_errors := (p_data->>'errors')::integer;
    v_sequence := (p_data->>'sequence')::integer;
    if v_sequence <= v_player.sequence then return race_private.snapshot(p_room_id,v_slot); end if;
    v_elapsed := least(60, greatest(0.001, extract(epoch from v_now-v_room.start_at)));
    if length(v_typed) > length(v_room.passage) or v_typed ~ '[^ -~]' or v_keys < length(v_typed)
      or v_keys < v_player.keystrokes or v_keys > 50000 or v_errors < v_player.errors or v_errors > v_keys
      or v_keys > floor(v_elapsed * 100) + 20 then raise exception 'Typing progress is outside the race limits.'; end if;
    select count(*) into v_correct from generate_series(1,length(v_typed)) n where substr(v_typed,n,1)=substr(v_room.passage,n,1);
    select length(v_typed) - coalesce(min(n)-1,length(v_typed)) into v_added
      from generate_series(1,length(v_typed)) n where substr(v_typed,n,1) <> substr(v_player.typed,n,1);
    if v_errors < length(v_typed) - v_correct or v_correct > v_keys - v_errors
      or v_keys - v_player.keystrokes < v_added then raise exception 'Typing counters do not match the submitted text.'; end if;
    v_finished := (p_data->>'finished')::boolean;
    if v_finished and v_elapsed < 60 and v_typed <> v_room.passage then raise exception 'Complete the passage before finishing early.'; end if;
    v_finished := v_finished or v_elapsed >= 60;
    update race_private.players set typed=v_typed,keystrokes=v_keys,errors=v_errors,sequence=v_sequence,
      correct=v_correct,elapsed=v_elapsed,finished=v_finished where room_id=p_room_id and slot=v_slot;
    if (select count(*) from race_private.players where room_id=p_room_id and finished)=2 then
      update race_private.rooms set status='finished' where id=p_room_id;
    end if;
  elsif p_action='rematch' then
    if v_room.status not in ('finished','cancelled','expired') then raise exception 'Finish this race before starting another.'; end if;
    if (select count(*) from race_private.players where room_id=p_room_id) < 2 then raise exception 'Nobody joined this race, so there is no one to race again.'; end if;
    -- The second player to ask joins the rematch the first one opened.
    if v_room.rematch_id is not null then
      select * into v_next from race_private.rooms where id=v_room.rematch_id;
      if found and v_next.status in ('waiting','countdown','racing') and v_next.expires_at > v_now then
        update race_private.players set last_seen=v_now where room_id=v_next.id and slot=v_slot;
        return jsonb_build_object('roomId',v_next.id,'room',race_private.snapshot(v_next.id,v_slot))
          || case when v_player.guest_hash is not null then jsonb_build_object('guestToken',p_guest_token) else '{}'::jsonb end;
      end if;
    end if;
    select user_id into v_other from race_private.players where room_id=p_room_id and slot<>v_slot;
    -- The racer who asks is charged for the room, not the original host.
    v_next := race_private.open_room(v_room.host_id, v_other, v_room.invite_kind, null,
      p_data->>'passage', p_data->'conditions', p_room_id,
      case when v_player.user_id is not null then 'user:' || v_player.user_id::text else 'guest:' || v_player.guest_hash end);
    -- Same seats, names and identities. The opponent counts as away until they open the rematch.
    insert into race_private.players(room_id,slot,user_id,guest_hash,name,last_seen)
      select v_next.id, slot, user_id, guest_hash, name, case when slot=v_slot then v_now else '-infinity'::timestamptz end
      from race_private.players where room_id=p_room_id;
    update race_private.rooms set rematch_id=v_next.id, rematch_slot=v_slot where id=p_room_id;
    return jsonb_build_object('roomId',v_next.id,'room',race_private.snapshot(v_next.id,v_slot))
      || case when v_player.guest_hash is not null then jsonb_build_object('guestToken',p_guest_token) else '{}'::jsonb end;
  elsif p_action='befriend' then
    if v_uid is null then raise exception 'Sign in to keep a friend list.'; end if;
    select user_id, name into v_other, v_name from race_private.players where room_id=p_room_id and slot<>v_slot;
    if v_other is null then raise exception 'Only racers with an account can be added as friends.'; end if;
    if not exists(select 1 from race_private.friends where owner_id = v_uid and friend_id = v_other)
      and (select count(*) from race_private.friends where owner_id = v_uid) >= 100 then raise exception 'Your friend list is full. Remove someone first.'; end if;
    insert into race_private.friends(owner_id, friend_id, name) values (v_uid, v_other, v_name)
      on conflict (owner_id, friend_id) where friend_id is not null do update set name = excluded.name;
    return race_private.friend_list(v_uid);
  else raise exception 'Unknown race action.';
  end if;
  return race_private.snapshot(p_room_id,v_slot);
end $$;
revoke all on function race_private.action(text,uuid,jsonb,text) from public, anon, authenticated;
grant execute on function race_private.action(text,uuid,jsonb,text) to anon, authenticated;
