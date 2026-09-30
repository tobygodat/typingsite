begin;
do $smoke$
declare
  host_id uuid := gen_random_uuid();
  invited_id uuid := gen_random_uuid();
  outsider_id uuid := gen_random_uuid();
  invited_email text := 'race-test-' || invited_id::text || '@example.invalid';
  created jsonb;
  joined jsonb;
  snap jsonb;
  account_room jsonb;
  room_id uuid;
  invite_token text;
  guest_token text;
  passage text := 'The quick brown fox jumps over the lazy dog.';
  denied boolean;
begin
  insert into auth.users (id,email,email_confirmed_at) values
    (host_id,'race-test-'||host_id::text||'@example.invalid',now()),
    (invited_id,invited_email,now()),
    (outsider_id,'race-test-'||outsider_id::text||'@example.invalid',now());

  if has_table_privilege('anon','race_private.rooms','SELECT')
    or has_table_privilege('authenticated','race_private.players','SELECT')
    or has_function_privilege('anon','race_private.snapshot(uuid,integer)','EXECUTE') then
    raise exception 'Private storage or snapshot helper is exposed.';
  end if;

  perform set_config('request.jwt.claim.sub','',true);
  denied := false;
  begin perform public.race_action('create',null,jsonb_build_object('passage',passage,'displayName','Guest host'),null);
  exception when others then denied := true; end;
  if not denied then raise exception 'Guest host authorization failed.'; end if;

  perform set_config('request.jwt.claim.sub',host_id::text,true);
  created := public.race_action('create',null,jsonb_build_object('passage',passage,'displayName','Host','conditions','{}'::jsonb),null);
  room_id := (created->>'roomId')::uuid;
  invite_token := created->>'inviteToken';
  if length(invite_token) <> 64 then raise exception 'Invalid invite capability.'; end if;
  if created->'room' ? 'host_id' or (created->'room')::text like '%'||invite_token||'%' then raise exception 'Snapshot exposes secrets.'; end if;

  perform set_config('request.jwt.claim.sub',outsider_id::text,true);
  denied := false;
  begin perform public.race_action('get',room_id,'{}',null);
  exception when others then denied := true; end;
  if not denied then raise exception 'Outsider read authorization failed.'; end if;

  perform set_config('request.jwt.claim.sub','',true);
  joined := public.race_action('join',room_id,jsonb_build_object('displayName','Guest','inviteToken',invite_token),null);
  guest_token := joined->>'guestToken';
  if length(guest_token) <> 64 or guest_token = invite_token then raise exception 'Guest seat capability must be independent.'; end if;
  denied := false;
  begin perform public.race_action('join',room_id,jsonb_build_object('displayName','Intruder','inviteToken',invite_token),null);
  exception when others then denied := true; end;
  if not denied then raise exception 'Third racer took an occupied seat.'; end if;
  denied := false;
  begin perform public.race_action('get',room_id,'{}',invite_token);
  exception when others then denied := true; end;
  if not denied then raise exception 'Invite capability authorized an occupied guest seat.'; end if;

  denied := false;
  begin perform public.race_action('progress',room_id,jsonb_build_object('typed','The','keystrokes',3,'errors',0,'sequence',1,'finished',false),guest_token);
  exception when others then denied := true; end;
  if not denied then raise exception 'Pre-start typing accepted.'; end if;
  perform public.race_action('ready',room_id,'{"ready":true}',guest_token);
  perform set_config('request.jwt.claim.sub',host_id::text,true);
  snap := public.race_action('ready',room_id,'{"ready":true}',null);
  if snap->>'status' <> 'countdown' or snap->>'startAt' is null then raise exception 'Shared countdown not scheduled.'; end if;
  update race_private.rooms set start_at=clock_timestamp()-interval '10 seconds' where id=room_id;

  perform set_config('request.jwt.claim.sub','',true);
  denied := false;
  begin perform public.race_action('progress',room_id,jsonb_build_object('typed','The','keystrokes',3,'errors',0,'sequence',1,'finished',true),guest_token);
  exception when others then denied := true; end;
  if not denied then raise exception 'Incomplete early finish accepted.'; end if;
  denied := false;
  begin perform public.race_action('progress',room_id,jsonb_build_object('typed','Xhe','keystrokes',3,'errors',0,'sequence',1,'finished',false),guest_token);
  exception when others then denied := true; end;
  if not denied then raise exception 'Impossible mismatch counters accepted.'; end if;
  snap := public.race_action('progress',room_id,jsonb_build_object('typed',passage,'keystrokes',length(passage),'errors',0,'sequence',1,'finished',true),guest_token);
  if (snap->'players'->1->>'wpm')::integer < 40 or (snap->'players'->1->>'elapsed')::numeric > 11 then raise exception 'Server score or elapsed invalid.'; end if;
  if snap->'players'->0 ? 'typed' or snap->'players'->1 ? 'guest_hash' then raise exception 'Peer trace or guest secret leaked.'; end if;
  -- Stale requests cannot roll completed progress backward.
  snap := public.race_action('progress',room_id,jsonb_build_object('typed','The','keystrokes',3,'errors',0,'sequence',0,'finished',false),guest_token);
  if snap->'players'->1->>'typed' <> passage then raise exception 'Stale progress overwrote final score.'; end if;
  perform set_config('request.jwt.claim.sub',host_id::text,true);
  snap := public.race_action('progress',room_id,jsonb_build_object('typed',passage,'keystrokes',length(passage),'errors',0,'sequence',1,'finished',true),null);
  if snap->>'status' <> 'finished' then raise exception 'Both-finished transition failed.'; end if;

  account_room := public.race_action('create',null,jsonb_build_object('passage',passage,'displayName','Host','inviteEmail',invited_email),null);
  if account_room ? 'inviteToken' then raise exception 'Account invite contains guest capability.'; end if;
  perform set_config('request.jwt.claim.sub',outsider_id::text,true);
  denied := false;
  begin perform public.race_action('join',(account_room->>'roomId')::uuid,'{"displayName":"Outsider"}',null);
  exception when others then denied := true; end;
  if not denied then raise exception 'Account invite accepted outsider.'; end if;
  if jsonb_array_length(public.race_action('invites',null,'{}',null)) <> 0 then raise exception 'Inbox exposed unrelated invite.'; end if;
  perform set_config('request.jwt.claim.sub',invited_id::text,true);
  if jsonb_array_length(public.race_action('invites',null,'{}',null)) <> 1 then raise exception 'Targeted account invite missing.'; end if;
  snap := public.race_action('join',(account_room->>'roomId')::uuid,'{"displayName":"Invited"}',null);
  if snap->'room'->>'selfSlot' <> '2' then raise exception 'Invited account did not join.'; end if;
  snap := public.race_action('leave',(account_room->>'roomId')::uuid,'{}',null);
  if snap->>'status' <> 'cancelled' then raise exception 'Leave did not close race.'; end if;
  raise notice 'Online race authorization, guest isolation, countdown, score and account invite smoke checks passed.';
end $smoke$;
rollback;
