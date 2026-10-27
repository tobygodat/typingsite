-- Head-to-head tally and keystroke trace checks. Runs inside a transaction and rolls everything back.
begin;
do $tally$
declare
  ada uuid := gen_random_uuid();
  lin uuid := gen_random_uuid();
  outsider uuid := gen_random_uuid();
  lin_email text := 'race-test-' || lin::text || '@example.invalid';
  passage text := 'The quick brown fox jumps over the lazy dog.';
  first_room uuid;
  second_room uuid;
  third_room uuid;
  guest_room uuid;
  created jsonb;
  joined jsonb;
  snap jsonb;
  traces jsonb;
  denied boolean;
  seen integer;
  full_trace jsonb;
  short_trace jsonb;
begin
  insert into auth.users (id,email,email_confirmed_at) values
    (ada,'race-test-'||ada::text||'@example.invalid',now()), (lin,lin_email,now()),
    (outsider,'race-test-'||outsider::text||'@example.invalid',now());
  -- The passage typed in full, and its first 20 letters, a key every 100 ms from the shared start.
  full_trace := jsonb_build_object('v',1,'k',passage,'t',(select jsonb_agg(100) from generate_series(1,length(passage))),'e',length(passage)*100);
  short_trace := jsonb_build_object('v',1,'k',left(passage,20),'t',(select jsonb_agg(100) from generate_series(1,20)),'e',2000);

  -- Browsers can read a tally row only through row-level security, and never write one.
  if has_table_privilege('anon','race_private.head_to_head','SELECT')
    or has_table_privilege('authenticated','race_private.head_to_head','INSERT')
    or has_table_privilege('authenticated','race_private.head_to_head','UPDATE')
    or has_table_privilege('authenticated','race_private.head_to_head','DELETE')
    or not has_table_privilege('authenticated','race_private.head_to_head','SELECT')
    or not (select relrowsecurity from pg_class where oid = 'race_private.head_to_head'::regclass)
    or has_function_privilege('authenticated','race_private.settle(uuid)','EXECUTE')
    or has_function_privilege('authenticated','race_private.keep_trace(uuid,integer,jsonb)','EXECUTE')
    or has_function_privilege('authenticated','race_private.winner(uuid)','EXECUTE') then
    raise exception 'Tally privileges are too broad.';
  end if;

  -- Race 1: Ada invites Lin. Both reach the 60-second clock; Ada typed the passage, Lin 20 letters.
  perform set_config('request.jwt.claim.sub',ada::text,true);
  first_room := (public.race_action('create',null,jsonb_build_object('passage',passage,'displayName','Ada','inviteEmail',lin_email),null)->>'roomId')::uuid;
  perform public.race_action('ready',first_room,'{"ready":true}',null);
  perform set_config('request.jwt.claim.sub',lin::text,true);
  perform public.race_action('join',first_room,'{"displayName":"Lin"}',null);
  perform public.race_action('ready',first_room,'{"ready":true}',null);
  update race_private.rooms set start_at = clock_timestamp() - interval '61 seconds' where id = first_room;
  denied := false;
  begin perform public.race_action('traces',first_room,'{}',null);
  exception when others then denied := true; end;
  if not denied then raise exception 'Traces were readable before the race finished.'; end if;
  perform set_config('request.jwt.claim.sub',ada::text,true);
  snap := public.race_action('progress',first_room,jsonb_build_object('typed',passage,'keystrokes',length(passage),'errors',0,
    'finished',true,'sequence',1,'trace',full_trace),null);
  if snap->>'status' <> 'racing' or snap->'tally' <> 'null'::jsonb then raise exception 'A race in progress showed a tally.'; end if;
  if (select trace from race_private.players where room_id = first_room and slot = 1) is distinct from full_trace then raise exception 'A trace that replays to the result was not kept.'; end if;
  if snap::text like '%"k":%' then raise exception 'A snapshot carries a trace.'; end if;
  -- Lin's trace says the whole passage, which is not what Lin typed: it is dropped and the result stands.
  perform set_config('request.jwt.claim.sub',lin::text,true);
  snap := public.race_action('progress',first_room,jsonb_build_object('typed',left(passage,20),'keystrokes',20,'errors',0,
    'finished',false,'sequence',1,'trace',full_trace),null);
  if snap->>'status' <> 'finished' or (snap->'players'->1->>'wpm')::integer <> 4 then raise exception 'A trace that does not match changed the result.'; end if;
  if (select trace from race_private.players where room_id = first_room and slot = 2) is not null then raise exception 'A trace that does not replay to the result was kept.'; end if;
  if snap->'tally' <> '[0, 1]'::jsonb then raise exception 'The loser''s tally is wrong: %', snap->'tally'; end if;
  perform set_config('request.jwt.claim.sub',ada::text,true);
  if public.race_action('get',first_room,'{}',null)->'tally' <> '[1, 0]'::jsonb then raise exception 'The winner''s tally is wrong.'; end if;
  -- Settled once: reading the finished race again adds nothing.
  perform public.race_action('get',first_room,'{}',null);
  if (select a_wins + b_wins from race_private.head_to_head where a_id = least(ada, lin) and b_id = greatest(ada, lin)) <> 1 then
    raise exception 'A finished race was counted twice.';
  end if;
  -- A trace can come after the progress that finished the racer; a malformed one is ignored without failing.
  perform set_config('request.jwt.claim.sub',lin::text,true);
  perform public.race_action('progress',first_room,jsonb_build_object('typed',left(passage,20),'keystrokes',20,'errors',0,
    'finished',true,'sequence',2,'trace',jsonb_build_object('v',1,'k','x','t','[]'::jsonb,'e',1)),null);
  perform public.race_action('progress',first_room,jsonb_build_object('typed',left(passage,20),'keystrokes',20,'errors',0,
    'finished',true,'sequence',3,'trace','"not a trace"'::jsonb),null);
  if (select trace from race_private.players where room_id = first_room and slot = 2) is not null then raise exception 'A malformed trace was kept.'; end if;
  perform public.race_action('progress',first_room,jsonb_build_object('typed',left(passage,20),'keystrokes',20,'errors',0,
    'finished',true,'sequence',4,'trace',short_trace),null);
  traces := public.race_action('traces',first_room,'{}',null)->'traces';
  if traces->0->'trace' <> full_trace or traces->1->'trace' <> short_trace or traces->0->>'slot' <> '1' then raise exception 'Both seats cannot read both traces.'; end if;
  -- A kept trace is never replaced.
  perform public.race_action('progress',first_room,jsonb_build_object('typed',left(passage,20),'keystrokes',20,'errors',0,
    'finished',true,'sequence',5,'trace',jsonb_set(short_trace,'{e}','2500')),null);
  if (select trace from race_private.players where room_id = first_room and slot = 2) <> short_trace then raise exception 'A kept trace was replaced.'; end if;
  perform set_config('request.jwt.claim.sub',outsider::text,true);
  denied := false;
  begin perform public.race_action('traces',first_room,'{}',null);
  exception when others then denied := true; end;
  if not denied then raise exception 'An outsider read the traces.'; end if;

  -- Only the pair reads their row, through row-level security as PostgREST calls.
  perform set_config('request.jwt.claim.sub',lin::text,true);
  set local role authenticated;
  select count(*) into seen from race_private.head_to_head;
  reset role;
  if seen <> 1 then raise exception 'A racer cannot read their own tally.'; end if;
  perform set_config('request.jwt.claim.sub',outsider::text,true);
  set local role authenticated;
  select count(*) into seen from race_private.head_to_head;
  denied := false;
  begin update race_private.head_to_head set a_wins = 99;
  exception when others then denied := true; end;
  reset role;
  if seen <> 0 then raise exception 'An outsider read a tally.'; end if;
  if not denied then raise exception 'A browser wrote a tally.'; end if;

  -- Race 2, a rematch: Lin finishes the passage early; Ada never returns and is settled by the grace period.
  perform set_config('request.jwt.claim.sub',ada::text,true);
  perform public.race_action('rematch',first_room,jsonb_build_object('passage',passage),null);
  perform set_config('request.jwt.claim.sub',lin::text,true);
  second_room := (public.race_action('rematch',first_room,jsonb_build_object('passage',passage),null)->'room'->>'rematchId')::uuid;
  update race_private.rooms set start_at = clock_timestamp() - interval '30 seconds', status = 'racing' where id = second_room;
  perform public.race_action('progress',second_room,jsonb_build_object('typed',passage,'keystrokes',length(passage),'errors',0,
    'finished',true,'sequence',1),null);
  perform set_config('request.jwt.claim.sub',ada::text,true);
  perform public.race_action('progress',second_room,jsonb_build_object('typed',left(passage,10),'keystrokes',10,'errors',0,
    'finished',false,'sequence',1),null);
  update race_private.rooms set start_at = clock_timestamp() - interval '71 seconds' where id = second_room;
  snap := public.race_action('get',second_room,'{}',null);
  if snap->>'status' <> 'finished' or snap->'tally' <> '[1, 1]'::jsonb then raise exception 'A race settled by the grace period was not counted: %', snap->'tally'; end if;
  if (public.race_action('traces',second_room,'{}',null)->'traces'->0->'trace') <> 'null'::jsonb then raise exception 'A race without traces has one.'; end if;

  -- Race 3, a tie on wpm and accuracy: it counts for neither.
  perform public.race_action('rematch',second_room,jsonb_build_object('passage',passage),null);
  perform set_config('request.jwt.claim.sub',lin::text,true);
  third_room := (public.race_action('rematch',second_room,jsonb_build_object('passage',passage),null)->'room'->>'rematchId')::uuid;
  update race_private.rooms set start_at = clock_timestamp() - interval '61 seconds', status = 'racing' where id = third_room;
  perform public.race_action('progress',third_room,jsonb_build_object('typed',left(passage,30),'keystrokes',31,'errors',1,'finished',true,'sequence',1),null);
  perform set_config('request.jwt.claim.sub',ada::text,true);
  snap := public.race_action('progress',third_room,jsonb_build_object('typed',left(passage,30),'keystrokes',31,'errors',1,'finished',true,'sequence',1),null);
  if snap->>'status' <> 'finished' or snap->'tally' <> '[1, 1]'::jsonb then raise exception 'A tie was counted: %', snap->'tally'; end if;
  -- Accuracy breaks a wpm tie, as the results show it.
  update race_private.players set errors = 3, keystrokes = 33 where room_id = third_room and slot = 1;
  if race_private.winner(third_room) <> 2 then raise exception 'Accuracy did not break a wpm tie.'; end if;

  -- A guest has no tally, and a race with one adds no row.
  created := public.race_action('create',null,jsonb_build_object('passage',passage,'displayName','Ada'),null);
  guest_room := (created->>'roomId')::uuid;
  perform public.race_action('ready',guest_room,'{"ready":true}',null);
  perform set_config('request.jwt.claim.sub','',true);
  joined := public.race_action('join',guest_room,jsonb_build_object('displayName','Guest','inviteToken',created->>'inviteToken'),null);
  perform public.race_action('ready',guest_room,'{"ready":true}',joined->>'guestToken');
  update race_private.rooms set start_at = clock_timestamp() - interval '61 seconds' where id = guest_room;
  perform public.race_action('progress',guest_room,jsonb_build_object('typed',left(passage,10),'keystrokes',10,'errors',0,'finished',true,'sequence',1),joined->>'guestToken');
  perform set_config('request.jwt.claim.sub',ada::text,true);
  snap := public.race_action('progress',guest_room,jsonb_build_object('typed',passage,'keystrokes',length(passage),'errors',0,'finished',true,'sequence',1),null);
  if snap->>'status' <> 'finished' or snap->'tally' <> 'null'::jsonb then raise exception 'A race with a guest showed a tally.'; end if;
  if (select count(*) from race_private.head_to_head where ada in (a_id, b_id)) <> 1 then raise exception 'A race with a guest added a tally row.'; end if;

  -- The tally goes with either account. Lin can be deleted although Lin opened a rematch of a race Lin
  -- was invited to, and that rematch stays as Ada's room.
  delete from auth.users where id = lin;
  if exists(select 1 from race_private.head_to_head where ada in (a_id, b_id)) then raise exception 'A tally outlived an account.'; end if;
  if (select opened_by from race_private.rooms where id = second_room) <> 'deleted' then raise exception 'A deleted account''s rematch kept its quota key.'; end if;
  raise notice 'Head-to-head tally, settling, privileges, guests, ties and keystroke trace checks passed.';
end $tally$;
rollback;
