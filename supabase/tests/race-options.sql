-- Race clock checks for race options. Runs inside a transaction and rolls everything back.
begin;
do $options$
declare
  ada uuid := gen_random_uuid();
  lin uuid := gen_random_uuid();
  lin_email text := 'race-test-' || lin::text || '@example.invalid';
  passage text := 'The quick brown fox jumps over the lazy dog, and the dog sleeps on.';
  timed uuid;
  plain uuid;
  next_room uuid;
  snap jsonb;
  denied boolean;
  bad text;
begin
  insert into auth.users (id,email,email_confirmed_at) values
    (ada,'race-test-'||ada::text||'@example.invalid',now()), (lin,lin_email,now());
  perform set_config('request.jwt.claim.sub',ada::text,true);

  -- A clock outside 5 to 600 seconds, or not a whole number, is refused.
  foreach bad in array array['4', '601', '30.5', '-30', '"half"', 'null'] loop
    denied := false;
    begin perform public.race_action('create',null,jsonb_build_object('passage',passage,'displayName','Ada',
      'conditions',jsonb_build_object('mode','time','duration',bad::jsonb)),null);
    exception when others then denied := true; end;
    if not denied and bad <> 'null' then raise exception 'A race clock of % was taken.', bad; end if;
  end loop;

  -- Without a clock a room keeps 60 seconds, as every room did.
  plain := (public.race_action('create',null,jsonb_build_object('passage',passage,'displayName','Ada','conditions','{"mode":"quote"}'::jsonb),null)->>'roomId')::uuid;
  if (select duration from race_private.rooms where id = plain) <> 60 then raise exception 'A room without a clock is not 60 seconds.'; end if;
  delete from race_private.rooms where id = plain;

  -- A 30-second timed race: elapsed and the finish follow its own clock.
  timed := (public.race_action('create',null,jsonb_build_object('passage',passage,'displayName','Ada','inviteEmail',lin_email,
    'conditions','{"mode":"time","duration":30}'::jsonb),null)->>'roomId')::uuid;
  snap := public.race_action('ready',timed,'{"ready":true}',null);
  if (snap->>'duration')::integer <> 30 then raise exception 'The snapshot does not carry the race clock.'; end if;
  perform set_config('request.jwt.claim.sub',lin::text,true);
  perform public.race_action('join',timed,'{"displayName":"Lin"}',null);
  perform public.race_action('ready',timed,'{"ready":true}',null);
  update race_private.rooms set start_at = clock_timestamp() - interval '31 seconds' where id = timed;
  snap := public.race_action('progress',timed,jsonb_build_object('typed',left(passage,20),'keystrokes',20,'errors',0,'finished',false,'sequence',1),null);
  if not (snap->'players'->1->>'finished')::boolean or (snap->'players'->1->>'elapsed')::numeric <> 30 then
    raise exception 'A timed race did not end on its own clock: %', snap->'players'->1;
  end if;
  -- Early, an unfinished passage still can't finish before the clock.
  perform set_config('request.jwt.claim.sub',ada::text,true);
  update race_private.rooms set start_at = clock_timestamp() - interval '20 seconds' where id = timed;
  denied := false;
  begin perform public.race_action('progress',timed,jsonb_build_object('typed',left(passage,10),'keystrokes',10,'errors',0,'finished',true,'sequence',1),null);
  exception when others then denied := true; end;
  if not denied then raise exception 'An unfinished passage finished before the clock.'; end if;
  -- The grace period follows the clock too: ten seconds past 30, Ada is settled at 30.
  update race_private.rooms set start_at = clock_timestamp() - interval '41 seconds' where id = timed;
  snap := public.race_action('get',timed,'{}',null);
  if snap->>'status' <> 'finished' or (snap->'players'->0->>'elapsed')::numeric <> 30 then raise exception 'The grace period ignored the clock.'; end if;

  -- A rematch keeps the race's conditions, and so its clock.
  perform public.race_action('rematch',timed,jsonb_build_object('passage',passage,'conditions',snap->'conditions'),null);
  perform set_config('request.jwt.claim.sub',lin::text,true);
  next_room := (public.race_action('rematch',timed,jsonb_build_object('passage',passage,'conditions',snap->'conditions'),null)->'room'->>'rematchId')::uuid;
  if (select duration from race_private.rooms where id = next_room) <> 30 then raise exception 'A rematch lost the race clock.'; end if;
  raise notice 'Race clock, timed finish, grace period and rematch clock checks passed.';
end $options$;
rollback;
