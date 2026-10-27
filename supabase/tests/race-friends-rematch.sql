-- Friends and rematch checks. Runs inside a transaction and rolls everything back.
begin;
do $smoke$
declare
  host_id uuid := gen_random_uuid();
  friend_id uuid := gen_random_uuid();
  outsider_id uuid := gen_random_uuid();
  host_email text := 'race-test-' || host_id::text || '@example.invalid';
  friend_email text := 'race-test-' || friend_id::text || '@example.invalid';
  passage text := 'The quick brown fox jumps over the lazy dog.';
  other_passage text := 'Pack my box with five dozen liquor jugs, then rest.';
  friends jsonb;
  created jsonb;
  joined jsonb;
  snap jsonb;
  again jsonb;
  room_id uuid;
  next_room uuid;
  guest_room uuid;
  guest_token text;
  denied boolean;
  busy_rooms uuid[] := '{}';
begin
  insert into auth.users (id,email,email_confirmed_at) values
    (host_id,host_email,now()), (friend_id,friend_email,now()),
    (outsider_id,'race-test-'||outsider_id::text||'@example.invalid',now());

  if has_table_privilege('anon','race_private.friends','SELECT')
    or has_table_privilege('authenticated','race_private.friends','SELECT')
    or has_function_privilege('authenticated','race_private.friend_list(uuid)','EXECUTE')
    or has_function_privilege('authenticated','race_private.open_room(uuid,uuid,text,text,text,jsonb,uuid,text)','EXECUTE') then
    raise exception 'Friend storage or helpers are exposed.';
  end if;

  -- Guests keep no friend list.
  perform set_config('request.jwt.claim.sub','',true);
  denied := false;
  begin perform public.race_action('friends',null,'{}',null);
  exception when others then denied := true; end;
  if not denied then raise exception 'Guest read a friend list.'; end if;

  -- A typed email is saved once and races without retyping it.
  perform set_config('request.jwt.claim.sub',host_id::text,true);
  friends := public.race_action('befriend',null,jsonb_build_object('email',upper(friend_email)),null);
  friends := public.race_action('befriend',null,jsonb_build_object('email',friend_email,'name','Lin'),null);
  if jsonb_array_length(friends) <> 1 or friends->0->>'name' <> 'Lin' or friends->0->>'email' <> friend_email then
    raise exception 'Email friend was not saved once with its name.';
  end if;
  denied := false;
  begin perform public.race_action('befriend',null,jsonb_build_object('email',host_email),null);
  exception when others then denied := true; end;
  if not denied then raise exception 'Owner befriended their own account.'; end if;

  created := public.race_action('create',null,jsonb_build_object('passage',passage,'displayName','Ada',
    'friendId',friends->0->>'id','conditions','{"quoteLength":"medium"}'::jsonb),null);
  room_id := (created->>'roomId')::uuid;
  if created ? 'inviteToken' or created->'room'->>'inviteKind' <> 'account' then raise exception 'Friend race was not an account invite.'; end if;

  -- Another account cannot use the host's friend row.
  perform set_config('request.jwt.claim.sub',outsider_id::text,true);
  denied := false;
  begin perform public.race_action('create',null,jsonb_build_object('passage',passage,'displayName','X','friendId',friends->0->>'id'),null);
  exception when others then denied := true; end;
  if not denied then raise exception 'Outsider used another account''s friend.'; end if;
  if jsonb_array_length(public.race_action('friends',null,'{}',null)) <> 0 then raise exception 'Friend list leaked across accounts.'; end if;
  denied := false;
  begin perform public.race_action('befriend',room_id,'{}',null);
  exception when others then denied := true; end;
  if not denied then raise exception 'Outsider befriended from a race they are not in.'; end if;

  perform set_config('request.jwt.claim.sub',friend_id::text,true);
  if public.race_action('invites',null,'{}',null)->0->>'hostName' <> 'Ada' then raise exception 'Friend invite missing.'; end if;
  joined := public.race_action('join',room_id,'{"displayName":"Lin"}',null);
  if joined->'room'->>'selfSlot' <> '2' then raise exception 'Friend did not join.'; end if;
  if jsonb_array_length(public.race_action('invites',null,'{}',null)) <> 0 then raise exception 'An accepted invitation is still listed.'; end if;
  if (joined->'room'->'players'->0->>'friend')::boolean then raise exception 'Friend flag set before befriending.'; end if;

  -- An account racer can be added from the race without learning their email or id.
  friends := public.race_action('befriend',room_id,'{}',null);
  if jsonb_array_length(friends) <> 1 or friends->0->>'name' <> 'Ada' or friends->0 ? 'email'
    or friends::text like '%'||host_id::text||'%' or friends::text like '%'||host_email||'%' then
    raise exception 'Race friend exposed identity or was not saved.';
  end if;
  snap := public.race_action('get',room_id,'{}',null);
  if not (snap->'players'->0->>'friend')::boolean or not (snap->'players'->0->>'account')::boolean then raise exception 'Friend flag missing.'; end if;
  perform public.race_action('leave',room_id,'{}',null);

  -- Rematch: each seat picks Rematch, and when both have, the next room opens already counting down.
  denied := false;
  perform set_config('request.jwt.claim.sub',outsider_id::text,true);
  begin perform public.race_action('rematch',room_id,jsonb_build_object('passage',other_passage),null);
  exception when others then denied := true; end;
  if not denied then raise exception 'Outsider picked a rematch.'; end if;
  -- A pick stays on the finished race until the other seat picks too, and can be taken back.
  perform set_config('request.jwt.claim.sub',friend_id::text,true);
  again := public.race_action('rematch',room_id,jsonb_build_object('passage',other_passage,'want',true),null);
  if (again->>'roomId')::uuid <> room_id or again->'room'->>'rematchId' is not null
    or not (again->'room'->'players'->1->>'rematch')::boolean or (again->'room'->'players'->0->>'rematch')::boolean then
    raise exception 'A first pick did not stay on the finished race.';
  end if;
  again := public.race_action('rematch',room_id,jsonb_build_object('want',false),null);
  if (again->>'roomId')::uuid <> room_id or (again->'room'->'players'->1->>'rematch')::boolean then raise exception 'A pick was not taken back.'; end if;
  denied := false;
  begin perform public.race_action('rematch',room_id,jsonb_build_object('want','yes'),null);
  exception when others then denied := true; end;
  if not denied then raise exception 'A rematch pick that is not true or false was taken.'; end if;
  perform set_config('request.jwt.claim.sub',host_id::text,true);
  again := public.race_action('rematch',room_id,jsonb_build_object('passage',passage),null);
  if (again->>'roomId')::uuid <> room_id or again->'room'->>'rematchId' is not null
    or not (again->'room'->'players'->0->>'rematch')::boolean then raise exception 'The host''s pick did not stay on the finished race.'; end if;
  -- The racer who picks second is charged for the rematch: the host's own live races do not block it.
  for i in 1..3 loop
    busy_rooms := busy_rooms || (public.race_action('create',null,jsonb_build_object('passage',passage,'displayName','Ada'),null)->>'roomId')::uuid;
  end loop;
  perform set_config('request.jwt.claim.sub',friend_id::text,true);
  snap := public.race_action('get',room_id,'{}',null);
  if not (snap->'players'->0->>'rematch')::boolean then raise exception 'The other seat cannot see a pick.'; end if;
  again := public.race_action('rematch',room_id,jsonb_build_object('passage',other_passage,'conditions','{"quoteLength":"medium"}'::jsonb),null);
  next_room := (again->'room'->>'rematchId')::uuid;
  if (again->>'roomId')::uuid <> room_id or next_room is null then raise exception 'Both picks did not open the rematch.'; end if;
  if (select opened_by from race_private.rooms where id = next_room) <> 'user:' || friend_id::text then raise exception 'Rematch was not charged to the racer who picked second.'; end if;
  delete from race_private.rooms where id = any(busy_rooms);
  snap := public.race_action('join',next_room,'{}',null);
  if snap->'room'->>'selfSlot' <> '2' or snap->'room'->>'rematchOf' <> room_id::text
    or snap->'room'->>'passage' <> other_passage or jsonb_array_length(snap->'room'->'players') <> 2
    or snap->'room'->>'status' <> 'countdown'
    or not (snap->'room'->'players'->0->>'ready')::boolean or not (snap->'room'->'players'->1->>'ready')::boolean
    or (snap->'room'->>'startAt')::timestamptz not between now() + interval '4 seconds' and clock_timestamp() + interval '5 seconds' then
    raise exception 'Rematch room was not opened counting down with both seats.';
  end if;
  if (select r.host_id from race_private.rooms r where r.id = next_room) <> host_id then raise exception 'Rematch changed the host.'; end if;
  perform set_config('request.jwt.claim.sub',host_id::text,true);
  snap := public.race_action('get',room_id,'{}',null);
  if snap->>'rematchId' <> next_room::text or not (snap->'players'->1->>'rematch')::boolean then raise exception 'Original room does not point at the rematch.'; end if;
  -- Asking again moves the seat to the open rematch, which no inbox lists.
  again := public.race_action('rematch',room_id,jsonb_build_object('passage',passage),null);
  if (again->>'roomId')::uuid <> next_room or again->'room'->>'selfSlot' <> '1' then raise exception 'A pick after both did not move to the rematch.'; end if;
  if jsonb_array_length(public.race_action('invites',null,'{}',null)) <> 0 then raise exception 'An opened rematch is listed.'; end if;
  perform set_config('request.jwt.claim.sub',friend_id::text,true);
  if jsonb_array_length(public.race_action('invites',null,'{}',null)) <> 0 then raise exception 'An opened rematch is listed for the other seat.'; end if;

  denied := false;
  begin perform public.race_action('rematch',next_room,jsonb_build_object('passage',passage),null);
  exception when others then denied := true; end;
  if not denied then raise exception 'Rematch opened from a live race.'; end if;

  -- Closing a finished race marks the seat as left: the other can no longer pick, only take a pick back.
  update race_private.rooms set status = 'finished' where id = next_room;
  perform public.race_action('rematch',next_room,jsonb_build_object('passage',passage),null);
  perform set_config('request.jwt.claim.sub',host_id::text,true);
  snap := public.race_action('leave',next_room,'{}',null);
  if snap->>'status' <> 'finished' or not (snap->'players'->0->>'left')::boolean or (snap->'players'->0->>'rematch')::boolean then
    raise exception 'Closing a finished race did not mark the seat as left.';
  end if;
  perform set_config('request.jwt.claim.sub',friend_id::text,true);
  if not (public.race_action('get',next_room,'{}',null)->'players'->0->>'left')::boolean then raise exception 'The other seat cannot see who left.'; end if;
  denied := false;
  begin perform public.race_action('rematch',next_room,jsonb_build_object('passage',passage),null);
  exception when others then denied := true; end;
  if not denied then raise exception 'A rematch was picked against a racer who left.'; end if;
  again := public.race_action('rematch',next_room,jsonb_build_object('want',false),null);
  if (again->'room'->'players'->1->>'rematch')::boolean or again->'room'->>'rematchId' is not null then raise exception 'A pick could not be taken back after the other left.'; end if;

  -- A guest keeps the same seat capability in the rematch.
  perform set_config('request.jwt.claim.sub',host_id::text,true);
  created := public.race_action('create',null,jsonb_build_object('passage',passage,'displayName','Ada'),null);
  guest_room := (created->>'roomId')::uuid;
  denied := false;
  begin perform public.race_action('rematch',guest_room,jsonb_build_object('passage',passage),null);
  exception when others then denied := true; end;
  if not denied then raise exception 'Rematch opened without an opponent.'; end if;
  perform set_config('request.jwt.claim.sub','',true);
  joined := public.race_action('join',guest_room,jsonb_build_object('displayName','Guest','inviteToken',created->>'inviteToken'),null);
  guest_token := joined->>'guestToken';
  denied := false;
  begin perform public.race_action('befriend',guest_room,'{}',guest_token);
  exception when others then denied := true; end;
  if not denied then raise exception 'Guest befriended an account.'; end if;
  perform public.race_action('leave',guest_room,'{}',guest_token);
  -- A result old enough for cleanup can still be raced again, and the guest keeps the same seat capability.
  update race_private.rooms set expires_at = now() - interval '2 days' where id = guest_room;
  perform set_config('request.jwt.claim.sub',host_id::text,true);
  perform public.race_action('rematch',guest_room,jsonb_build_object('passage',passage),null);
  perform set_config('request.jwt.claim.sub','',true);
  again := public.race_action('rematch',guest_room,jsonb_build_object('passage',other_passage),guest_token);
  if again->>'guestToken' <> guest_token or again->'room'->>'selfSlot' <> '2' or again->'room'->>'rematchId' is null then raise exception 'Guest rematch lost the seat.'; end if;
  if (select opened_by from race_private.rooms where id = (again->'room'->>'rematchId')::uuid) not like 'guest:%' then raise exception 'Guest rematch was charged to the host.'; end if;
  snap := public.race_action('rematch',guest_room,'{}',guest_token);
  if (snap->>'roomId')::uuid <> (again->'room'->>'rematchId')::uuid or snap->>'guestToken' <> guest_token or snap->'room'->>'selfSlot' <> '2' then
    raise exception 'Guest did not move to the rematch.';
  end if;
  perform set_config('request.jwt.claim.sub',friend_id::text,true);
  if exists(select 1 from jsonb_array_elements(public.race_action('invites',null,'{}',null)) i where i->>'id' = snap->>'roomId') then
    raise exception 'Guest rematch leaked into an unrelated inbox.';
  end if;
  perform set_config('request.jwt.claim.sub',host_id::text,true);
  snap := public.race_action('join',(snap->>'roomId')::uuid,'{"displayName":"Ada"}',null);
  if snap->'room'->>'selfSlot' <> '1' then raise exception 'Host could not open the guest rematch.'; end if;

  -- Removing a friend is owner-only.
  perform set_config('request.jwt.claim.sub',outsider_id::text,true);
  perform public.race_action('unfriend',null,jsonb_build_object('friendId',friends->0->>'id'),null);
  perform set_config('request.jwt.claim.sub',friend_id::text,true);
  if jsonb_array_length(public.race_action('friends',null,'{}',null)) <> 1 then raise exception 'Outsider removed a friend.'; end if;
  if jsonb_array_length(public.race_action('unfriend',null,jsonb_build_object('friendId',friends->0->>'id'),null)) <> 0 then raise exception 'Friend was not removed.'; end if;
  raise notice 'Friend list, friend invites, rematch seats and guest rematch checks passed.';
end $smoke$;
rollback;
