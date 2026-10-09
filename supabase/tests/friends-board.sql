-- Friends board checks. Runs inside a transaction and rolls everything back.
begin;

-- Every call goes through these, made as PostgREST makes it: as the authenticated role with the user's
-- id in the JWT claim (set beforehand), or as anon when there is none. So a missing grant anywhere on
-- the path fails here as it would in production; setup and checks around the calls run as the owner.
create function pg_temp.as_caller() returns void language plpgsql as $$
begin
  perform set_config('role', case when coalesce(current_setting('request.jwt.claim.sub', true), '') = '' then 'anon' else 'authenticated' end, true);
end $$;
create function pg_temp.board(p_action text, p_data jsonb default '{}') returns jsonb language plpgsql as $$
declare
  v_result jsonb;
begin
  perform pg_temp.as_caller();
  begin
    v_result := public.friends_board(p_action, p_data);
  exception when others then
    perform set_config('role', 'none', true);
    raise;
  end;
  perform set_config('role', 'none', true);
  return v_result;
end $$;
create function pg_temp.race(p_action text, p_room uuid, p_data jsonb, p_guest text) returns jsonb language plpgsql as $$
declare
  v_result jsonb;
begin
  perform pg_temp.as_caller();
  begin
    v_result := public.race_action(p_action, p_room, p_data, p_guest);
  exception when others then
    perform set_config('role', 'none', true);
    raise;
  end;
  perform set_config('role', 'none', true);
  return v_result;
end $$;

-- A clear as a browser sends it: its id, when it happened and when the request was sent, by its clock.
create function pg_temp.clearing(p_id uuid, p_at timestamptz, p_sent timestamptz) returns jsonb language sql as $$
  select jsonb_build_object('id', p_id, 'at', to_jsonb(p_at)#>>'{}', 'sent', to_jsonb(p_sent)#>>'{}')
$$;
-- Two times within a second of each other (a request takes a moment to arrive).
create function pg_temp.near(p_a timestamptz, p_b timestamptz) returns boolean language sql as $$
  select abs(extract(epoch from p_a - p_b)) < 1
$$;

do $smoke$
declare
  ada uuid := gen_random_uuid();
  lin uuid := gen_random_uuid();
  sam uuid := gen_random_uuid();
  kai uuid := gen_random_uuid();
  ada_email text := 'board-test-' || ada::text || '@example.invalid';
  -- Stored with capitals, typed in lower case: resolved the way a typed invite is.
  lin_stored text := 'Board-Test-' || lin::text || '@Example.invalid';
  lin_email text := lower('Board-Test-' || lin::text || '@Example.invalid');
  sam_email text := 'board-test-' || sam::text || '@example.invalid';
  kai_email text := 'board-test-' || kai::text || '@example.invalid';
  today date := (clock_timestamp() at time zone 'utc')::date;
  monday date := (clock_timestamp() at time zone 'utc')::date - (extract(isodow from (clock_timestamp() at time zone 'utc')::date)::integer - 1);
  week jsonb;
  -- A daily version as the browser sends it: the conditions key, then the passage.
  v text := 'quote:::punctuation:medium:any::physical-keyboard:relaxed:original-en-v5:stilltype-metrics-v1|daily-abc123@1';
  board jsonb;
  friends jsonb;
  lin_row text;
  bad jsonb;
  act text;
  g1 uuid := gen_random_uuid();
  g2 uuid := gen_random_uuid();
  g3 uuid := gen_random_uuid();
  g4 uuid := gen_random_uuid();
  g5 uuid := gen_random_uuid();
  g6 uuid := gen_random_uuid();
  g7 uuid := gen_random_uuid();
  g8 uuid := gen_random_uuid();
  t text;
  t2 text;
  denied boolean;
begin
  insert into auth.users (id,email,email_confirmed_at) values
    (ada,ada_email,now()), (lin,lin_stored,now()), (sam,sam_email,now()), (kai,kai_email,null);
  week := jsonb_build_object('start',monday,'seconds',1830,'runs',41);

  if has_table_privilege('anon','race_private.summaries','SELECT')
    or has_table_privilege('authenticated','race_private.summaries','SELECT')
    or has_table_privilege('authenticated','race_private.summaries','INSERT')
    or has_function_privilege('authenticated','race_private.board_snapshot(uuid)','EXECUTE')
    or has_function_privilege('anon','race_private.board(text,jsonb)','EXECUTE')
    or has_function_privilege('anon','public.friends_board(text,jsonb)','EXECUTE')
    or not has_function_privilege('authenticated','public.friends_board(text,jsonb)','EXECUTE')
    or not has_function_privilege('authenticated','race_private.board(text,jsonb)','EXECUTE') then
    raise exception 'Board storage or helpers are exposed.';
  end if;

  -- Guests (the anon role) have no board.
  perform set_config('request.jwt.claim.sub','',true);
  denied := false;
  begin perform pg_temp.board('board','{}');
  exception when others then denied := true; end;
  if not denied then raise exception 'Guest read a board.'; end if;

  -- Sharing is off until chosen: a publish or replace from an account that doesn't share stores
  -- nothing, and its board is empty.
  perform set_config('request.jwt.claim.sub',ada::text,true);
  foreach act in array array['publish','replace'] loop
    board := pg_temp.board(act,jsonb_build_object('daily',null,'week',week,'clear',case when act = 'replace'
      then pg_temp.clearing(gen_random_uuid(),clock_timestamp(),clock_timestamp()) end));
    if (board->>'sharing')::boolean or board->'rows' <> '[]'::jsonb or exists(select 1 from race_private.summaries where user_id = ada) then
      raise exception 'A % from an account that does not share was stored: %', act, board;
    end if;
  end loop;

  -- Sharing stores the account's own summary, and it sees only itself until a friend chooses it back.
  board := pg_temp.board('share',jsonb_build_object('daily',jsonb_build_object('date',today,'version',v,'wpm',84,'accuracy',97,'attempts',2),'week',week));
  if not (board->>'sharing')::boolean or board->>'date' <> today::text or board->>'weekStart' <> monday::text or jsonb_array_length(board->'rows') <> 1
    or not (board->'rows'->0->>'self')::boolean or board->'rows'->0->'daily'->>'wpm' <> '84'
    or board->'rows'->0->'daily'->>'version' <> v
    or board->'rows'->0->'daily'->>'attempts' <> '2' or board->'rows'->0->'week'->>'seconds' <> '1830' then
    raise exception 'Own summary was not stored: %', board;
  end if;

  -- Impossible or stale summaries are refused, however they are sent, and the stored row is left as it was.
  foreach act in array array['share','publish','replace'] loop
  foreach bad in array array[
    jsonb_build_object('daily',jsonb_build_object('date',today,'version',v,'wpm',401,'accuracy',97,'attempts',1),'week',week),
    jsonb_build_object('daily',jsonb_build_object('date',today,'version',v,'wpm',84,'accuracy',101,'attempts',1),'week',week),
    jsonb_build_object('daily',jsonb_build_object('date',today,'version',v,'wpm',84.5,'accuracy',97,'attempts',1),'week',week),
    jsonb_build_object('daily',jsonb_build_object('date',today,'version',v,'wpm',84,'accuracy',97,'attempts',0),'week',week),
    jsonb_build_object('daily',jsonb_build_object('date',today - 3,'version',v,'wpm',84,'accuracy',97,'attempts',1),'week',week),
    jsonb_build_object('daily',jsonb_build_object('wpm',84,'version',v,'accuracy',97,'attempts',1),'week',week),
    jsonb_build_object('daily',jsonb_build_object('date',today,'wpm',84,'accuracy',97,'attempts',1),'week',week),
    jsonb_build_object('daily',jsonb_build_object('date',today,'version',7,'wpm',84,'accuracy',97,'attempts',1),'week',week),
    jsonb_build_object('daily',jsonb_build_object('date',today,'version',repeat('x',201),'wpm',84,'accuracy',97,'attempts',1),'week',week),
    jsonb_build_object('daily',jsonb_build_object('date',today,'version',E'v1\n','wpm',84,'accuracy',97,'attempts',1),'week',week),
    jsonb_build_object('daily','84 wpm','week',week),
    jsonb_build_object('daily',null),
    jsonb_build_object('daily',null,'week',jsonb_build_object('start',monday + 1,'seconds',60,'runs',1)),
    jsonb_build_object('daily',null,'week',jsonb_build_object('start',monday - 14,'seconds',60,'runs',1)),
    jsonb_build_object('daily',null,'week',jsonb_build_object('start',monday,'seconds',604801,'runs',1)),
    jsonb_build_object('daily',null,'week',jsonb_build_object('start',monday,'seconds',-60,'runs',1)),
    jsonb_build_object('daily',null,'week',jsonb_build_object('start',monday,'seconds',60)),
    jsonb_build_object('daily',null,'week',week,'clear','yesterday'),
    jsonb_build_object('daily',null,'week',week,'clear',7),
    jsonb_build_object('daily',null,'week',week,'clear',jsonb_build_object('id','not-an-id','at','2026-10-09T10:00:00Z','sent','2026-10-09T10:00:00Z')),
    jsonb_build_object('daily',null,'week',week,'clear',jsonb_build_object('id',gen_random_uuid(),'at','yesterday','sent','2026-10-09T10:00:00Z')),
    jsonb_build_object('daily',null,'week',week,'clear',jsonb_build_object('id',gen_random_uuid(),'at','2026-10-09T10:00:00Z'))
  ] loop
    denied := false;
    begin perform pg_temp.board(act,bad);
    exception when others then denied := true; end;
    if not denied then raise exception 'Accepted an impossible summary (%): %', act, bad; end if;
  end loop;
  end loop;
  denied := false;
  begin perform pg_temp.board('rank','{}');
  exception when others then denied := true; end;
  if not denied then raise exception 'Unknown board action was accepted.'; end if;
  if (select daily_wpm from race_private.summaries where user_id = ada) <> 84 then raise exception 'A refused summary changed the row.'; end if;

  -- Another tab or device of the same account that never saw those runs publishes less: a slower daily,
  -- no daily, less practice, yesterday's result or last week's practice. The stored numbers stay, and
  -- the larger attempt count is kept.
  foreach bad in array array[
    jsonb_build_object('daily',jsonb_build_object('date',today,'version',v,'wpm',70,'accuracy',99,'attempts',3),
      'week',jsonb_build_object('start',monday,'seconds',600,'runs',5)),
    jsonb_build_object('daily',null,'week',jsonb_build_object('start',monday,'seconds',60,'runs',1)),
    jsonb_build_object('daily',jsonb_build_object('date',today - 1,'version',v,'wpm',99,'accuracy',99,'attempts',1),
      'week',jsonb_build_object('start',monday - 7,'seconds',9000,'runs',90))
  ] loop
    board := pg_temp.board('publish',bad);
    if board->'rows'->0->'daily' is distinct from jsonb_build_object('version',v,'wpm',84,'accuracy',97,'attempts',3)
      or board->'rows'->0->'week' is distinct from jsonb_build_object('seconds',1830,'runs',41) then
      raise exception 'A stale summary lowered the stored one: % gave %', bad, board;
    end if;
  end loop;
  -- The same speed more accurately is better, and practice time and runs each keep the larger.
  board := pg_temp.board('publish',jsonb_build_object('daily',jsonb_build_object('date',today,'version',v,'wpm',84,'accuracy',99,'attempts',1),
    'week',jsonb_build_object('start',monday,'seconds',1900,'runs',40)));
  if board->'rows'->0->'daily' is distinct from jsonb_build_object('version',v,'wpm',84,'accuracy',99,'attempts',3)
    or board->'rows'->0->'week' is distinct from jsonb_build_object('seconds',1900,'runs',41) then
    raise exception 'A better result or more practice was not kept: %', board;
  end if;
  -- A daily from another build is never compared, so it takes the stored one's place.
  board := pg_temp.board('publish',jsonb_build_object('daily',jsonb_build_object('date',today,'version',v || '+next','wpm',61,'accuracy',95,'attempts',1),
    'week',jsonb_build_object('start',monday,'seconds',10,'runs',1)));
  if board->'rows'->0->'daily' is distinct from jsonb_build_object('version',v || '+next','wpm',61,'accuracy',95,'attempts',1)
    or board->'rows'->0->'week' is distinct from jsonb_build_object('seconds',1900,'runs',41) then
    raise exception 'A daily from another build did not replace the stored one: %', board;
  end if;
  -- A history clear replaces the row, so the numbers can go down and a daily can go. It keeps the id the
  -- browser gave it, and runs count from when it happened, in the service's time: this one was sent ten
  -- minutes after it happened, by a clock that reads right.
  board := pg_temp.board('replace',jsonb_build_object('daily',null,'week',jsonb_build_object('start',monday,'seconds',0,'runs',0),
    'clear',pg_temp.clearing(g1,clock_timestamp() - interval '10 minutes',clock_timestamp())));
  t := board->'clear'->>'from';
  if board->'clear'->>'id' is distinct from g1::text or not pg_temp.near(t::timestamptz, clock_timestamp() - interval '10 minutes')
    or jsonb_typeof(board->'rows'->0->'daily') <> 'null' or board->'rows'->0->'week' is distinct from jsonb_build_object('seconds',0,'runs',0) then
    raise exception 'A delayed clear lost the time it happened: %', board;
  end if;
  -- Sent again after a lost reply, the same clear is answered as done and keeps its time. What it sends
  -- is the runs since the clear (by then one more), so that is folded in.
  board := pg_temp.board('replace',jsonb_build_object('daily',null,'week',jsonb_build_object('start',monday,'seconds',60,'runs',1),
    'clear',pg_temp.clearing(g1,clock_timestamp() - interval '10 minutes',clock_timestamp())));
  if board ? 'refused' or board->'clear'->>'id' is distinct from g1::text or board->'clear'->>'from' is distinct from t
    or board->'rows'->0->'week' is distinct from jsonb_build_object('seconds',60,'runs',1) then
    raise exception 'A repeated clear was not answered as done with its runs folded in: %', board;
  end if;
  -- A browser that missed the clear (it knows none, or another) is refused, changing nothing, however
  -- it writes, and the reply names the clear it missed.
  foreach bad in array array[
    jsonb_build_object('daily',jsonb_build_object('date',today,'version',v,'wpm',84,'accuracy',97,'attempts',2),'week',week),
    jsonb_build_object('daily',jsonb_build_object('date',today,'version',v,'wpm',84,'accuracy',97,'attempts',2),'week',week,'clear',null),
    jsonb_build_object('daily',jsonb_build_object('date',today,'version',v,'wpm',84,'accuracy',97,'attempts',2),'week',week,'clear',gen_random_uuid())
  ] loop
    foreach act in array array['publish','share'] loop
      board := pg_temp.board(act,bad);
      if not coalesce((board->>'refused')::boolean, false) or board->'clear'->>'id' is distinct from g1::text or not (board->>'sharing')::boolean
        or board->'rows'->0->'week' is distinct from jsonb_build_object('seconds',60,'runs',1) or jsonb_typeof(board->'rows'->0->'daily') <> 'null' then
        raise exception 'A % that missed the clear was taken: % gave %', act, bad, board;
      end if;
    end loop;
  end loop;
  -- Naming the clear, a browser's runs since then are folded in as usual.
  board := pg_temp.board('publish',jsonb_build_object('daily',null,'week',jsonb_build_object('start',monday,'seconds',60,'runs',1),'clear',g1));
  if board ? 'refused' or board->'rows'->0->'week' is distinct from jsonb_build_object('seconds',60,'runs',1) then
    raise exception 'A publish that named the clear was refused: %', board;
  end if;
  -- A device whose clock reads an hour behind clears just now: runs count from now, not an hour ago.
  board := pg_temp.board('replace',jsonb_build_object('daily',null,'week',jsonb_build_object('start',monday,'seconds',0,'runs',0),
    'clear',pg_temp.clearing(g2,clock_timestamp() - interval '1 hour',clock_timestamp() - interval '1 hour')));
  t2 := board->'clear'->>'from';
  if board ? 'refused' or board->'clear'->>'id' is distinct from g2::text or not pg_temp.near(t2::timestamptz, clock_timestamp()) then
    raise exception 'A clear from a clock an hour behind was placed an hour early: %', board;
  end if;
  -- That newer clear wins: an undo of the first one is refused, changing nothing.
  board := pg_temp.board('replace',jsonb_build_object('daily',jsonb_build_object('date',today,'version',v,'wpm',84,'accuracy',97,'attempts',2),'week',week,'undo',g1,'before',null));
  if not coalesce((board->>'refused')::boolean, false) or board->'clear'->>'id' is distinct from g2::text
    or board->'rows'->0->'week' is distinct from jsonb_build_object('seconds',0,'runs',0) or jsonb_typeof(board->'rows'->0->'daily') <> 'null' then
    raise exception 'An undo overtook a newer clear: %', board;
  end if;
  -- A clear that happened half an hour ago and is sent only now (it waited offline, or another tab's went
  -- first) happened before the latest one: it is answered as done and changes nothing, so the runs it
  -- counts, from before the latest clear, don't come back.
  board := pg_temp.board('replace',jsonb_build_object('daily',null,'week',jsonb_build_object('start',monday,'seconds',600,'runs',10),
    'clear',pg_temp.clearing(g4,clock_timestamp() - interval '30 minutes',clock_timestamp())));
  if board ? 'refused' or board->'clear'->>'id' is distinct from g2::text or board->'clear'->>'from' is distinct from t2
    or board->'rows'->0->'week' is distinct from jsonb_build_object('seconds',0,'runs',0) then
    raise exception 'A clear that happened before the latest one changed the row: %', board;
  end if;
  -- The reply names the clear before the latest one, which an undo of it puts back.
  if board->'undo'->>'id' is distinct from g1::text or board->'undo'->>'from' is distinct from t then
    raise exception 'The reply did not name the clear before the latest: %', board;
  end if;
  -- An undo of the latest clear puts back the numbers it sends and the clear before it, with its time;
  -- repeated after a lost reply, it is answered as done and the same numbers change nothing.
  foreach act in array array['first','repeat'] loop
    board := pg_temp.board('replace',jsonb_build_object('daily',jsonb_build_object('date',today,'version',v,'wpm',84,'accuracy',97,'attempts',2),'week',week,'undo',g2,'before',g1));
    if board ? 'refused' or board->'clear'->>'id' is distinct from g1::text or board->'clear'->>'from' is distinct from t
      or board->'rows'->0->'daily' is distinct from jsonb_build_object('version',v,'wpm',84,'accuracy',97,'attempts',2)
      or board->'rows'->0->'week' is distinct from jsonb_build_object('seconds',1830,'runs',41) then
      raise exception 'The % undo did not leave the summary and the clear before it: %', act, board;
    end if;
  end loop;
  -- A clock running ahead can't place a clear in the future.
  board := pg_temp.board('replace',jsonb_build_object('daily',jsonb_build_object('date',today,'version',v,'wpm',84,'accuracy',97,'attempts',2),'week',week,
    'clear',pg_temp.clearing(g3,clock_timestamp() + interval '1 day',clock_timestamp())));
  if board->'clear'->>'id' is distinct from g3::text or (board->'clear'->>'from')::timestamptz > clock_timestamp() then
    raise exception 'A clear was placed in the future: %', board;
  end if;
  board := pg_temp.board('replace',jsonb_build_object('daily',jsonb_build_object('date',today,'version',v,'wpm',84,'accuracy',97,'attempts',2),'week',week,'undo',g3,'before',g1));
  if board ? 'refused' or board->'clear'->>'id' is distinct from g1::text then raise exception 'Undoing the clear from ahead failed: %', board; end if;
  -- Another device clears (g5) after this browser last heard from the board, and this browser then clears
  -- (g6) still taking g2 for the clear before. The reply to its clear names g5. An undo that counted its
  -- runs from another clear than g5 (g2, or none) is refused, changing nothing, and the reply names g5
  -- again; so the runs g5 removed can't come back with g5 put back as the latest.
  board := pg_temp.board('replace',jsonb_build_object('daily',null,'week',jsonb_build_object('start',monday,'seconds',0,'runs',0),
    'clear',pg_temp.clearing(g5,clock_timestamp(),clock_timestamp())));
  t := board->'clear'->>'from';
  board := pg_temp.board('replace',jsonb_build_object('daily',null,'week',jsonb_build_object('start',monday,'seconds',0,'runs',0),
    'clear',pg_temp.clearing(g6,clock_timestamp(),clock_timestamp())));
  if board ? 'refused' or board->'clear'->>'id' is distinct from g6::text or board->'undo'->>'id' is distinct from g5::text
    or board->'undo'->>'from' is distinct from t then
    raise exception 'The reply to a clear did not name the clear before it: %', board;
  end if;
  foreach bad in array array[to_jsonb(g2), 'null'::jsonb] loop
    board := pg_temp.board('replace',jsonb_build_object('daily',jsonb_build_object('date',today,'version',v,'wpm',84,'accuracy',97,'attempts',2),
      'week',week,'undo',g6,'before',bad));
    if not coalesce((board->>'refused')::boolean, false) or board->'clear'->>'id' is distinct from g6::text or board->'undo'->>'id' is distinct from g5::text
      or board->'rows'->0->'week' is distinct from jsonb_build_object('seconds',0,'runs',0) or jsonb_typeof(board->'rows'->0->'daily') <> 'null' then
      raise exception 'An undo that counted from % was taken: %', bad, board;
    end if;
  end loop;
  -- Counted from g5, it is taken: g5 is the latest again, with the runs since it.
  board := pg_temp.board('replace',jsonb_build_object('daily',null,'week',jsonb_build_object('start',monday,'seconds',60,'runs',1),'undo',g6,'before',g5));
  if board ? 'refused' or board->'clear'->>'id' is distinct from g5::text or board->'clear'->>'from' is distinct from t
    or board->'rows'->0->'week' is distinct from jsonb_build_object('seconds',60,'runs',1) then
    raise exception 'An undo that counted from the clear before was refused: %', board;
  end if;
  -- Repeated after a lost reply, with a run more since g5, it is answered as done and the run is folded in.
  board := pg_temp.board('replace',jsonb_build_object('daily',null,'week',jsonb_build_object('start',monday,'seconds',120,'runs',2),'undo',g6,'before',g5));
  if board ? 'refused' or board->'clear'->>'id' is distinct from g5::text
    or board->'rows'->0->'week' is distinct from jsonb_build_object('seconds',120,'runs',2) then
    raise exception 'A repeated undo was not answered as done with its runs folded in: %', board;
  end if;
  -- And the clear it undid, sent again by a tab that never heard of the undo, is answered as done: g5
  -- stays the latest and nothing is lowered.
  board := pg_temp.board('replace',jsonb_build_object('daily',null,'week',jsonb_build_object('start',monday,'seconds',0,'runs',0),
    'clear',pg_temp.clearing(g6,clock_timestamp(),clock_timestamp())));
  if board ? 'refused' or board->'clear'->>'id' is distinct from g5::text
    or board->'rows'->0->'week' is distinct from jsonb_build_object('seconds',120,'runs',2) then
    raise exception 'A clear repeated after its undo brought it back: %', board;
  end if;
  -- An undo that names no clear before it, or a malformed one, is not a request at all.
  foreach bad in array array[
    jsonb_build_object('daily',null,'week',jsonb_build_object('start',monday,'seconds',0,'runs',0),'undo',g5),
    jsonb_build_object('daily',null,'week',jsonb_build_object('start',monday,'seconds',0,'runs',0),'undo',g5,'before','nope'),
    jsonb_build_object('daily',null,'week',jsonb_build_object('start',monday,'seconds',0,'runs',0),'undo',g5,'before',1)
  ] loop
    denied := false;
    begin perform pg_temp.board('replace',bad);
    exception when others then denied := true; end;
    if not denied then raise exception 'A malformed undo was accepted: %', bad; end if;
  end loop;
  -- A clear whose reply was lost (g7) is overtaken by another device's clear (g8) before it goes again.
  -- Sent again with the runs made since it, which g8 removed, it is answered as done and changes
  -- nothing: g8 stays the latest, with its time, and those runs stay off the board.
  board := pg_temp.board('replace',jsonb_build_object('daily',null,'week',jsonb_build_object('start',monday,'seconds',0,'runs',0),
    'clear',pg_temp.clearing(g7,clock_timestamp(),clock_timestamp())));
  board := pg_temp.board('replace',jsonb_build_object('daily',null,'week',jsonb_build_object('start',monday,'seconds',0,'runs',0),
    'clear',pg_temp.clearing(g8,clock_timestamp(),clock_timestamp())));
  t := board->'clear'->>'from';
  board := pg_temp.board('replace',jsonb_build_object('daily',null,'week',jsonb_build_object('start',monday,'seconds',1800,'runs',12),
    'clear',pg_temp.clearing(g7,clock_timestamp() - interval '40 minutes',clock_timestamp())));
  if board ? 'refused' or board->'clear'->>'id' is distinct from g8::text or board->'clear'->>'from' is distinct from t
    or board->'undo'->>'id' is distinct from g7::text or board->'rows'->0->'week' is distinct from jsonb_build_object('seconds',0,'runs',0) then
    raise exception 'A clear sent again after a newer one became the latest again: %', board;
  end if;
  -- Ada's daily and week, published again since g8, for the friends below.
  board := pg_temp.board('publish',jsonb_build_object('daily',jsonb_build_object('date',today,'version',v,'wpm',84,'accuracy',97,'attempts',2),'week',week,'clear',g8));
  if board ? 'refused' then raise exception 'A publish naming the latest clear was refused: %', board; end if;

  -- Lin has Ada on her list, but Ada has not chosen Lin: neither sees the other.
  perform set_config('request.jwt.claim.sub',lin::text,true);
  perform pg_temp.race('befriend',null,jsonb_build_object('email',ada_email,'name','Ada'),null);
  board := pg_temp.board('share',jsonb_build_object('daily',jsonb_build_object('date',today,'version',v,'wpm',72,'accuracy',96,'attempts',1),
    'week',jsonb_build_object('start',monday,'seconds',754,'runs',12)));
  if jsonb_array_length(board->'rows') <> 1 then raise exception 'A one-way friend appeared on the board.'; end if;
  perform set_config('request.jwt.claim.sub',ada::text,true);
  board := pg_temp.board('board','{}');
  if jsonb_array_length(board->'rows') <> 1 or (board->'rows')::text like '%754%' then raise exception 'Someone who added Ada appeared without being chosen back.'; end if;

  -- Once Ada adds Lin's email too, each sees the other, labelled with their own name for them.
  friends := pg_temp.race('befriend',null,jsonb_build_object('email',lin_email,'name','Lin'),null);
  lin_row := friends->0->>'id';
  board := pg_temp.board('board','{}');
  if jsonb_array_length(board->'rows') <> 2 or board->'rows'->1->>'name' <> 'Lin' or board->'rows'->1->>'id' <> lin_row
    or (board->'rows'->1->>'self')::boolean or board->'rows'->1->'daily'->>'wpm' <> '72'
    or board->'rows'->1->'daily'->>'accuracy' <> '96' or board->'rows'->1->'week'->>'seconds' <> '754' then
    raise exception 'Mutual friend missing from the board: %', board;
  end if;
  if board::text ilike '%' || lin::text || '%' or board::text ilike '%' || lin_email || '%' or board::text ilike '%' || ada::text || '%' then
    raise exception 'The board exposed an account id or email.';
  end if;
  perform set_config('request.jwt.claim.sub',lin::text,true);
  board := pg_temp.board('board','{}');
  if jsonb_array_length(board->'rows') <> 2 or board->'rows'->1->>'name' <> 'Ada' or board->'rows'->1->'daily'->>'wpm' <> '84' then
    raise exception 'Lin does not see Ada: %', board;
  end if;

  -- An unconfirmed email never resolves, in either direction.
  perform set_config('request.jwt.claim.sub',kai::text,true);
  perform pg_temp.race('befriend',null,jsonb_build_object('email',ada_email,'name','Ada'),null);
  board := pg_temp.board('share',jsonb_build_object('daily',null,'week',jsonb_build_object('start',monday,'seconds',300,'runs',3)));
  if jsonb_array_length(board->'rows') <> 1 then raise exception 'An unconfirmed account saw a friend.'; end if;
  perform set_config('request.jwt.claim.sub',ada::text,true);
  perform pg_temp.race('befriend',null,jsonb_build_object('email',kai_email,'name','Kai'),null);
  if jsonb_array_length(pg_temp.board('board','{}')->'rows') <> 2 then raise exception 'An unconfirmed email resolved to an account.'; end if;

  -- A mutual friend who doesn't share is not on the board, and sees no one on theirs, even friends who share.
  insert into race_private.friends(owner_id, friend_id, name) values (ada, sam, 'Sam from the race'), (sam, ada, 'Ada');
  perform pg_temp.race('befriend',null,jsonb_build_object('email',sam_email,'name','Sam'),null);
  if jsonb_array_length(pg_temp.board('board','{}')->'rows') <> 2 then raise exception 'A friend who does not share appeared.'; end if;
  perform set_config('request.jwt.claim.sub',sam::text,true);
  board := pg_temp.board('board','{}');
  if (board->>'sharing')::boolean or board->'rows' <> '[]'::jsonb then raise exception 'Someone who does not share saw the board: %', board; end if;

  -- Once Sam shares, someone on the list twice (raced, and typed by email) appears once, under the raced name.
  perform pg_temp.board('share',jsonb_build_object('daily',null,'week',jsonb_build_object('start',monday,'seconds',0,'runs',0)));
  perform set_config('request.jwt.claim.sub',ada::text,true);
  board := pg_temp.board('board','{}');
  if jsonb_array_length(board->'rows') <> 3 or board->'rows'->2->>'name' <> 'Sam from the race'
    or jsonb_typeof(board->'rows'->2->'daily') <> 'null' or board->'rows'->2->'week' is distinct from jsonb_build_object('seconds',0,'runs',0) then
    raise exception 'A friend listed twice was not shown once: %', board;
  end if;

  -- Yesterday's daily and last week's practice read as nothing yet, whatever the session time zone.
  perform set_config('TimeZone','Pacific/Kiritimati',true);
  perform set_config('request.jwt.claim.sub',lin::text,true);
  update race_private.summaries set daily_date = today - 1, daily_wpm = 75, daily_accuracy = 95, daily_attempts = 1,
    week_seconds = 800, week_runs = 13 where user_id = lin;
  perform set_config('request.jwt.claim.sub',ada::text,true);
  board := pg_temp.board('board','{}');
  if board->>'date' <> today::text or jsonb_typeof(board->'rows'->1->'daily') <> 'null' or board->'rows'->1->'week'->>'seconds' <> '800' then
    raise exception 'Yesterday''s daily showed as today''s: %', board;
  end if;
  update race_private.summaries set week_start = monday - 7 where user_id = lin;
  if jsonb_typeof(pg_temp.board('board','{}')->'rows'->1->'week') <> 'null' then raise exception 'Last week''s practice showed as this week''s.'; end if;

  -- Today's result and this week's practice take the place of yesterday's and last week's, even when
  -- lower. Today's also wins over a later day sent from a clock running ahead.
  perform set_config('request.jwt.claim.sub',lin::text,true);
  board := pg_temp.board('publish',jsonb_build_object('daily',jsonb_build_object('date',today,'version',v,'wpm',60,'accuracy',94,'attempts',1),
    'week',jsonb_build_object('start',monday,'seconds',30,'runs',1)));
  if board->'rows'->0->'daily' is distinct from jsonb_build_object('version',v,'wpm',60,'accuracy',94,'attempts',1)
    or board->'rows'->0->'week' is distinct from jsonb_build_object('seconds',30,'runs',1) then
    raise exception 'A new day or week did not replace the old one: %', board;
  end if;
  update race_private.summaries set daily_date = today + 1, daily_wpm = 99 where user_id = lin;
  board := pg_temp.board('publish',jsonb_build_object('daily',jsonb_build_object('date',today,'version',v,'wpm',58,'accuracy',94,'attempts',1),
    'week',jsonb_build_object('start',monday,'seconds',30,'runs',1)));
  if board->'rows'->0->'daily' is distinct from jsonb_build_object('version',v,'wpm',58,'accuracy',94,'attempts',1) then
    raise exception 'A later day kept today''s result off the board: %', board;
  end if;
  perform set_config('request.jwt.claim.sub',ada::text,true);

  -- Clearing a daily result clears it for friends too.
  perform pg_temp.board('replace',jsonb_build_object('daily',null,'week',week,
    'clear',pg_temp.clearing(gen_random_uuid(),clock_timestamp(),clock_timestamp())));
  perform set_config('request.jwt.claim.sub',lin::text,true);
  board := pg_temp.board('board','{}');
  if jsonb_typeof(board->'rows'->1->'daily') <> 'null' or board->'rows'->1->'week'->>'seconds' <> '1830' then raise exception 'A cleared daily still showed.'; end if;

  -- Removing someone hides you from them, and them from you.
  perform pg_temp.race('unfriend',null,jsonb_build_object('friendId',(pg_temp.race('friends',null,'{}',null)->0->>'id')),null);
  if jsonb_array_length(pg_temp.board('board','{}')->'rows') <> 1 then raise exception 'A removed friend still showed.'; end if;
  perform set_config('request.jwt.claim.sub',ada::text,true);
  board := pg_temp.board('board','{}');
  if jsonb_array_length(board->'rows') <> 2 or board->'rows'->1->>'name' <> 'Sam from the race' then raise exception 'Ada still sees someone who removed her: %', board; end if;

  -- Turning sharing off empties the row down to a marker with no numbers: friends stop seeing it and the
  -- board empties. A publish or replace from a browser that missed the change is refused and doesn't
  -- share again, and turning off twice is fine.
  perform set_config('request.jwt.claim.sub',sam::text,true);
  board := pg_temp.board('unshare','{}');
  if (board->>'sharing')::boolean or board->'rows' <> '[]'::jsonb
    or not exists(select 1 from race_private.summaries where user_id = sam and not sharing and week_start is null and week_seconds is null
      and week_runs is null and daily_date is null and daily_wpm is null) then
    raise exception 'Turning sharing off kept numbers: %', board;
  end if;
  foreach act in array array['publish','replace'] loop
    board := pg_temp.board(act,jsonb_build_object('daily',null,'week',week,'clear',case when act = 'replace'
      then pg_temp.clearing(gen_random_uuid(),clock_timestamp(),clock_timestamp()) end));
    if not coalesce((board->>'refused')::boolean, false) or (board->>'sharing')::boolean or board->'rows' <> '[]'::jsonb then
      raise exception 'A % after turning sharing off was taken: %', act, board;
    end if;
  end loop;
  perform pg_temp.board('unshare','{}');
  if exists(select 1 from race_private.summaries where user_id = sam and (sharing or week_start is not null)) then raise exception 'A write after turning sharing off shared again.'; end if;
  perform set_config('request.jwt.claim.sub',ada::text,true);
  if jsonb_array_length(pg_temp.board('board','{}')->'rows') <> 1 then raise exception 'Ada still sees someone who stopped sharing.'; end if;

  -- Turning sharing on again shares this browser's summary, and friends see it again.
  perform set_config('request.jwt.claim.sub',sam::text,true);
  board := pg_temp.board('share',jsonb_build_object('daily',null,'week',jsonb_build_object('start',monday,'seconds',120,'runs',2)));
  if not (board->>'sharing')::boolean or board ? 'refused' or board->'rows'->0->'week' is distinct from jsonb_build_object('seconds',120,'runs',2) then
    raise exception 'Turning sharing on again failed: %', board;
  end if;
  perform set_config('request.jwt.claim.sub',ada::text,true);
  board := pg_temp.board('board','{}');
  if jsonb_array_length(board->'rows') <> 2 or board->'rows'->1->'week' is distinct from jsonb_build_object('seconds',120,'runs',2) then
    raise exception 'Ada does not see someone who shares again: %', board;
  end if;

  -- Deleting an account deletes its row.
  delete from auth.users where id = ada;
  if exists(select 1 from race_private.summaries where user_id = ada) then raise exception 'A deleted account kept its board row.'; end if;
  raise notice 'Friends board privacy, opt-in sharing, missed, delayed, repeated, out-of-order and overtaken clears, clocks off, opt-outs, mutual lists, limits, dates and merge checks passed.';
end $smoke$;
rollback;
