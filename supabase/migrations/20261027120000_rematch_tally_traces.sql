-- Rematch on the results page, a lasting head-to-head tally, and both racers' keystroke traces.
-- Rematch: each seat of a closed race picks Rematch, or takes the pick back. When both have picked, the
-- service opens the next room for the same seats, already counting down, and both browsers move to it,
-- so nobody accepts anything. A racer who closes the race is marked as left, which ends the choice.
-- Tally: race_private.head_to_head counts the wins of each pair of accounts. It is updated here, in the
-- same transaction that settles a race between two accounts, so no browser writes its own wins. A tie
-- counts for neither. Guests have no tally. Only the two accounts can read their row.
-- Traces: each racer posts the compact trace of their run (the ghost challenge format, scored by
-- race_private.trace_score) with the progress that finishes it, or after it. A trace that does not replay
-- to the result the service settled is not kept, and the result stands either way. Once the race is
-- finished, both seats can read both traces, which draw the speed graph and the two-caret replay.

alter table race_private.players
  add column rematch boolean not null default false,
  add column left_race boolean not null default false,
  add column trace jsonb check (trace is null or octet_length(trace::text) <= 65536);

create table race_private.head_to_head (
  a_id uuid not null references auth.users(id) on delete cascade,
  b_id uuid not null references auth.users(id) on delete cascade,
  a_wins integer not null default 0 check (a_wins >= 0),
  b_wins integer not null default 0 check (b_wins >= 0),
  primary key (a_id, b_id),
  check (a_id < b_id)
);
create index head_to_head_b on race_private.head_to_head (b_id);
alter table race_private.head_to_head enable row level security;
revoke all on race_private.head_to_head from public, anon, authenticated;
create policy head_to_head_pair_read on race_private.head_to_head for select to authenticated
  using ((select auth.uid()) in (a_id, b_id));
grant select on race_private.head_to_head to authenticated;

-- The winning seat of a race, as its results show it: more wpm, then more accuracy. Null for a tie.
create function race_private.winner(p_room_id uuid)
returns integer language sql stable set search_path = '' as $$
  with scored as (
    select slot,
      case when elapsed > 0 then round(correct::numeric / 5 / (elapsed / 60)) else 0 end as wpm,
      case when keystrokes > 0 then round((keystrokes - errors)::numeric / keystrokes * 100) else 100 end as accuracy
    from race_private.players where room_id = p_room_id)
  select case when (one.wpm, one.accuracy) > (two.wpm, two.accuracy) then 1
    when (one.wpm, one.accuracy) < (two.wpm, two.accuracy) then 2 end
  from scored one join scored two on one.slot = 1 and two.slot = 2
$$;
revoke all on function race_private.winner(uuid) from public, anon, authenticated;

-- Called once, by the request that moves a room to finished. A race between two accounts adds the win
-- to their pair's row (creating it on their first race, a tie included).
create function race_private.settle(p_room_id uuid)
returns void language plpgsql set search_path = '' as $$
declare
  v_one uuid;
  v_two uuid;
  v_winner integer;
begin
  select user_id into v_one from race_private.players where room_id = p_room_id and slot = 1;
  select user_id into v_two from race_private.players where room_id = p_room_id and slot = 2;
  if v_one is null or v_two is null or v_one = v_two then return; end if;
  v_winner := race_private.winner(p_room_id);
  insert into race_private.head_to_head (a_id, b_id, a_wins, b_wins)
    values (least(v_one, v_two), greatest(v_one, v_two),
      case when (v_winner = 1 and v_one < v_two) or (v_winner = 2 and v_two < v_one) then 1 else 0 end,
      case when (v_winner = 1 and v_one > v_two) or (v_winner = 2 and v_two > v_one) then 1 else 0 end)
    on conflict (a_id, b_id) do update
      set a_wins = race_private.head_to_head.a_wins + excluded.a_wins,
        b_wins = race_private.head_to_head.b_wins + excluded.b_wins;
end $$;
revoke all on function race_private.settle(uuid) from public, anon, authenticated;

-- Keeps a finished racer's trace once, and only one that replays to the correct characters the service
-- settled. Anything else is dropped without failing the request: the trace only draws the graph and replay.
create function race_private.keep_trace(p_room_id uuid, p_slot integer, p_trace jsonb)
returns void language plpgsql set search_path = '' as $$
declare
  v_player race_private.players%rowtype;
  v_score jsonb;
begin
  if p_trace is null or jsonb_typeof(p_trace) <> 'object' then return; end if;
  select * into v_player from race_private.players where room_id = p_room_id and slot = p_slot;
  if not v_player.finished or v_player.trace is not null then return; end if;
  begin
    v_score := race_private.trace_score((select passage from race_private.rooms where id = p_room_id), p_trace, null, true);
  exception when others then
    return;
  end;
  if (v_score->>'correct')::integer <> v_player.correct then return; end if;
  update race_private.players set trace = p_trace where room_id = p_room_id and slot = p_slot;
end $$;
revoke all on function race_private.keep_trace(uuid, integer, jsonb) from public, anon, authenticated;

create or replace function race_private.snapshot(p_room_id uuid, p_slot integer)
returns jsonb language sql set search_path = '' as $$
 select jsonb_build_object(
   'id', r.id, 'status', r.status, 'passage', r.passage, 'conditions', r.conditions,
   'duration', r.duration, 'startAt', r.start_at, 'serverNow', clock_timestamp(),
   'expiresAt', r.expires_at, 'selfSlot', p_slot, 'inviteKind', r.invite_kind,
   'rematchOf', r.rematch_of, 'rematchId', r.rematch_id,
   -- The pair's wins once the race is finished, this seat's first. Null when either racer is a guest.
   'tally', (select case when me.user_id = h.a_id then jsonb_build_array(h.a_wins, h.b_wins)
       else jsonb_build_array(h.b_wins, h.a_wins) end
     from race_private.players me
     join race_private.players them on them.room_id = me.room_id and them.slot <> me.slot
     join race_private.head_to_head h on h.a_id = least(me.user_id, them.user_id) and h.b_id = greatest(me.user_id, them.user_id)
     where me.room_id = r.id and me.slot = p_slot and r.status = 'finished'),
   'players', coalesce((select jsonb_agg(jsonb_build_object(
     'slot', p.slot, 'name', p.name, 'ready', p.ready,
     'progress', round(p.correct::numeric / length(r.passage) * 100, 1),
     'finished', p.finished, 'elapsed', p.elapsed,
     'wpm', case when p.elapsed > 0 then round(p.correct::numeric / 5 / (p.elapsed / 60)) else 0 end,
     'accuracy', case when p.keystrokes > 0 then round((p.keystrokes - p.errors)::numeric / p.keystrokes * 100) else 100 end,
     'connected', p.last_seen > clock_timestamp() - interval '10 seconds',
     'rematch', p.rematch, 'left', p.left_race,
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
  v_rival race_private.players%rowtype;
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
      -- Serialize per owner so concurrent adds cannot pass the cap together.
      perform pg_advisory_xact_lock(hashtextextended('friends:' || v_uid::text, 0));
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
    perform race_private.settle(p_room_id);
  end if;

  if p_action='join' then
    return jsonb_build_object('roomId',p_room_id,'room',race_private.snapshot(p_room_id,v_slot))
      || case when v_player.guest_hash is not null then jsonb_build_object('guestToken',p_guest_token) else '{}'::jsonb end;
  elsif p_action='get' then null;
  elsif p_action='leave' then
    if v_room.status in ('waiting','countdown','racing') then
      update race_private.rooms set status='cancelled' where id=p_room_id;
    else
      update race_private.players set left_race=true, rematch=false where room_id=p_room_id and slot=v_slot;
    end if;
  elsif p_action='ready' then
    if v_room.status <> 'waiting' then raise exception 'The race has already started or closed.'; end if;
    if jsonb_typeof(p_data->'ready') <> 'boolean' or not (p_data ? 'ready') then raise exception 'Invalid ready state.'; end if;
    update race_private.players set ready=(p_data->>'ready')::boolean where room_id=p_room_id and slot=v_slot;
    if (select count(*) from race_private.players where room_id=p_room_id and ready) = 2 then
      update race_private.rooms set status='countdown',start_at=v_now + interval '5 seconds' where id=p_room_id;
    end if;
  elsif p_action='progress' then
    -- A trace may come with the progress that finishes this racer, or after it.
    if v_room.status='finished' or v_player.finished then
      perform race_private.keep_trace(p_room_id, v_slot, p_data->'trace');
      return race_private.snapshot(p_room_id,v_slot);
    end if;
    if v_room.status <> 'racing' or v_now < v_room.start_at then raise exception 'Wait for the shared countdown to finish.'; end if;
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
    if v_finished then perform race_private.keep_trace(p_room_id, v_slot, p_data->'trace'); end if;
    if (select count(*) from race_private.players where room_id=p_room_id and finished)=2 then
      update race_private.rooms set status='finished' where id=p_room_id;
      perform race_private.settle(p_room_id);
    end if;
  elsif p_action='rematch' then
    if v_room.status not in ('finished','cancelled','expired') then raise exception 'Finish this race before starting another.'; end if;
    if (select count(*) from race_private.players where room_id=p_room_id) < 2 then raise exception 'Nobody joined this race, so there is no one to race again.'; end if;
    -- Once the next room is open, asking moves this seat to it. That room may also be one a racer opened
    -- alone before picks existed, which the other joins this way.
    if v_room.rematch_id is not null then
      select * into v_next from race_private.rooms where id=v_room.rematch_id;
      if found and v_next.status in ('waiting','countdown','racing') and v_next.expires_at > v_now then
        update race_private.players set last_seen=v_now where room_id=v_next.id and slot=v_slot;
        return jsonb_build_object('roomId',v_next.id,'room',race_private.snapshot(v_next.id,v_slot))
          || case when v_player.guest_hash is not null then jsonb_build_object('guestToken',p_guest_token) else '{}'::jsonb end;
      end if;
      -- That race is over, so both seats pick again from nothing.
      update race_private.players set rematch=false where room_id=p_room_id;
    end if;
    if jsonb_typeof(coalesce(p_data->'want', 'true'::jsonb)) <> 'boolean' then raise exception 'Invalid rematch choice.'; end if;
    select * into v_rival from race_private.players where room_id=p_room_id and slot<>v_slot;
    if not coalesce((p_data->>'want')::boolean, true) then
      update race_private.players set rematch=false where room_id=p_room_id and slot=v_slot;
    else
      if v_rival.left_race then raise exception '% has left this race.', v_rival.name; end if;
      update race_private.players set rematch=true, left_race=false where room_id=p_room_id and slot=v_slot;
      if v_rival.rematch then
        -- Both picked: the next room opens for the same seats, names and identities, already counting
        -- down. The racer who picked second is charged for it, not the original host.
        v_next := race_private.open_room(v_room.host_id, v_rival.user_id, v_room.invite_kind, null,
          p_data->>'passage', p_data->'conditions', p_room_id,
          case when v_player.user_id is not null then 'user:' || v_player.user_id::text else 'guest:' || v_player.guest_hash end);
        insert into race_private.players(room_id,slot,user_id,guest_hash,name,ready,last_seen)
          select v_next.id, slot, user_id, guest_hash, name, true, v_now from race_private.players where room_id=p_room_id;
        update race_private.rooms set status='countdown', start_at=v_now + interval '5 seconds' where id=v_next.id;
        update race_private.rooms set rematch_id=v_next.id where id=p_room_id;
      end if;
    end if;
    return jsonb_build_object('roomId',p_room_id,'room',race_private.snapshot(p_room_id,v_slot))
      || case when v_player.guest_hash is not null then jsonb_build_object('guestToken',p_guest_token) else '{}'::jsonb end;
  elsif p_action='traces' then
    if v_room.status <> 'finished' then raise exception 'This race has not finished.'; end if;
    return jsonb_build_object('traces', (select jsonb_agg(jsonb_build_object('slot', slot, 'trace', trace) order by slot)
      from race_private.players where room_id=p_room_id));
  elsif p_action='befriend' then
    if v_uid is null then raise exception 'Sign in to keep a friend list.'; end if;
    select user_id, name into v_other, v_name from race_private.players where room_id=p_room_id and slot<>v_slot;
    if v_other is null then raise exception 'Only racers with an account can be added as friends.'; end if;
    perform pg_advisory_xact_lock(hashtextextended('friends:' || v_uid::text, 0));
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

-- Account deletion: the quota key of a deleted account is replaced before its rows cascade. After them,
-- a rematch the account opened from a race it was invited to still pointed at that deleted race, and the
-- update failed its foreign key, so the account could not be deleted.
create or replace function race_private.forget_opener()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update race_private.rooms set opened_by = 'deleted' where opened_by = 'user:' || old.id::text;
  return old;
end $$;
revoke all on function race_private.forget_opener() from public, anon, authenticated;
drop trigger forget_race_opener on auth.users;
create trigger forget_race_opener before delete on auth.users
  for each row execute function race_private.forget_opener();
