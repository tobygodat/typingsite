-- Account deletion (supabase/functions/delete-account). auth.admin.deleteUser removes the auth.users
-- row; every row keyed to that user must go with it through ON DELETE CASCADE, so no foreign key can
-- block the delete or leave the account's data behind, and the forget_race_opener trigger clears the
-- one id kept as text (rooms.opened_by). Runs inside a transaction and rolls back.
begin;
do $deletion$
declare
  ada uuid := gen_random_uuid();
  bob uuid := gen_random_uuid();
  cy uuid := gen_random_uuid();
  ada_email text := 'delete-test-' || ada::text || '@example.invalid';
  bob_email text := 'delete-test-' || bob::text || '@example.invalid';
  cy_email text := 'delete-test-' || cy::text || '@example.invalid';
  passage text := 'The quick brown fox jumps over the lazy dog.';
  created jsonb;
  ada_room uuid;
  bob_room uuid;
  cy_room uuid;
  rematch_room uuid;
  loose text;
begin
  -- Every foreign key into auth.users from the app's schemas cascades. (The auth and storage schemas
  -- belong to Supabase; this app stores nothing in storage.)
  select string_agg(format('%s.%s', c.conrelid::regclass, a.attname), ', ') into loose
    from pg_constraint c
    join pg_namespace n on n.oid = c.connamespace
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
    where c.contype = 'f' and c.confrelid = 'auth.users'::regclass and c.confdeltype <> 'c'
      and n.nspname not in ('auth', 'storage');
  if loose is not null then raise exception 'Foreign keys to auth.users without ON DELETE CASCADE: %', loose; end if;

  insert into auth.users (id,email,email_confirmed_at) values (ada,ada_email,now()), (bob,bob_email,now()), (cy,cy_email,now());
  insert into public.profiles (user_id, data) values (ada, '{"version":2}'), (bob, '{"version":2}');

  -- Ada hosts a race for Bob's account and keeps Cy's email on her friend list.
  perform set_config('request.jwt.claim.sub',ada::text,true);
  created := public.race_action('create',null,jsonb_build_object('displayName','Ada','passage',passage,'inviteEmail',bob_email),null);
  ada_room := (created->>'roomId')::uuid;
  perform public.race_action('befriend',null,jsonb_build_object('email',cy_email,'name','Cy'),null);

  -- Bob joins, adds Ada as a raced friend, keeps her email too, and hosts a guest-link race.
  perform set_config('request.jwt.claim.sub',bob::text,true);
  perform public.race_action('join',ada_room,'{"displayName":"Bob"}',null);
  perform public.race_action('befriend',ada_room,'{}',null);
  perform public.race_action('befriend',null,jsonb_build_object('email',ada_email,'name','Ada'),null);
  created := public.race_action('create',null,jsonb_build_object('displayName','Bob','passage',passage),null);
  bob_room := (created->>'roomId')::uuid;

  -- Ada takes the guest seat in Bob's race with her account; Cy invites Ada's account.
  perform set_config('request.jwt.claim.sub',ada::text,true);
  perform public.race_action('join',bob_room,jsonb_build_object('displayName','Ada','inviteToken',created->>'inviteToken'),null);
  perform set_config('request.jwt.claim.sub',cy::text,true);
  cy_room := (public.race_action('create',null,jsonb_build_object('displayName','Cy','passage',passage,'inviteEmail',ada_email),null)->>'roomId')::uuid;
  if (select count(*) from race_private.players where user_id = ada) <> 2 then raise exception 'Setup did not seat Ada twice.'; end if;

  -- Bob's race finishes and both pick a rematch, Ada second: a room hosted by Bob, opened under Ada's key.
  update race_private.rooms set status = 'finished' where id = bob_room;
  perform set_config('request.jwt.claim.sub',bob::text,true);
  perform public.race_action('rematch',bob_room,jsonb_build_object('passage',passage),null);
  perform set_config('request.jwt.claim.sub',ada::text,true);
  rematch_room := (public.race_action('rematch',bob_room,jsonb_build_object('passage',passage),null)->'room'->>'rematchId')::uuid;
  -- Their pair's tally, which goes with either account.
  insert into race_private.head_to_head (a_id, b_id, a_wins) values (least(ada, bob), greatest(ada, bob), 1);
  if (select opened_by from race_private.rooms where id = rematch_room) <> 'user:' || ada::text then raise exception 'Setup did not charge Ada for the rematch.'; end if;

  -- What auth.admin.deleteUser(ada) does to these tables.
  delete from auth.users where id = ada;

  if exists(select 1 from public.profiles where user_id = ada) then raise exception 'The deleted account''s profile survived.'; end if;
  if not exists(select 1 from public.profiles where user_id = bob) then raise exception 'Another account''s profile was deleted.'; end if;
  if exists(select 1 from race_private.rooms where host_id = ada or invited_id = ada or id in (ada_room, cy_room)) then
    raise exception 'A race hosted by or inviting the deleted account survived.';
  end if;
  if exists(select 1 from race_private.players where user_id = ada) then raise exception 'A race seat of the deleted account survived.'; end if;
  if exists(select 1 from race_private.friends where owner_id = ada or friend_id = ada) then
    raise exception 'A friend row owned by or pointing at the deleted account survived.';
  end if;
  if exists(select 1 from race_private.head_to_head where ada in (a_id, b_id)) then raise exception 'A tally naming the deleted account survived.'; end if;
  -- Bob's own race and the rematch in it stay, with only his seat, and nothing names Ada.
  if (select count(*) from race_private.players where room_id in (bob_room, rematch_room)) <> 2
    or (select count(*) from race_private.players where room_id in (bob_room, rematch_room) and user_id = bob) <> 2 then
    raise exception 'Another account''s race lost its own seat.';
  end if;
  if exists(select 1 from race_private.rooms where opened_by = 'user:' || ada::text) then
    raise exception 'A room still carries the deleted account''s quota key.';
  end if;
  if not exists(select 1 from race_private.rooms where opened_by = 'user:' || bob::text) then
    raise exception 'Another account''s quota key was replaced.';
  end if;
  -- An email Bob typed is Bob's own contact entry. It stays and no longer matches any account.
  if not exists(select 1 from race_private.friends where owner_id = bob and email = ada_email) then
    raise exception 'Another account''s typed friend email was removed.';
  end if;
  raise notice 'Account deletion cascade checks passed.';
end $deletion$;
rollback;
