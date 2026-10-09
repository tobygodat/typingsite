-- Friends board checks. Runs inside a transaction and rolls everything back.
begin;
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
    or not has_function_privilege('authenticated','public.friends_board(text,jsonb)','EXECUTE') then
    raise exception 'Board storage or helpers are exposed.';
  end if;

  -- Guests have no board.
  perform set_config('request.jwt.claim.sub','',true);
  denied := false;
  begin perform public.friends_board('board','{}');
  exception when others then denied := true; end;
  if not denied then raise exception 'Guest read a board.'; end if;

  -- An account publishes its own summary and sees only itself until a friend chooses it back.
  perform set_config('request.jwt.claim.sub',ada::text,true);
  board := public.friends_board('publish',jsonb_build_object('daily',jsonb_build_object('date',today,'version',v,'wpm',84,'accuracy',97,'attempts',2),'week',week));
  if board->>'date' <> today::text or board->>'weekStart' <> monday::text or jsonb_array_length(board->'rows') <> 1
    or not (board->'rows'->0->>'self')::boolean or board->'rows'->0->'daily'->>'wpm' <> '84'
    or board->'rows'->0->'daily'->>'version' <> v
    or board->'rows'->0->'daily'->>'attempts' <> '2' or board->'rows'->0->'week'->>'seconds' <> '1830' then
    raise exception 'Own summary was not stored: %', board;
  end if;

  -- Impossible or stale summaries are refused, published or replacing, and the stored row is left as it was.
  foreach act in array array['publish','replace'] loop
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
    jsonb_build_object('daily',null,'week',jsonb_build_object('start',monday,'seconds',60))
  ] loop
    denied := false;
    begin perform public.friends_board(act,bad);
    exception when others then denied := true; end;
    if not denied then raise exception 'Accepted an impossible summary (%): %', act, bad; end if;
  end loop;
  end loop;
  denied := false;
  begin perform public.friends_board('rank','{}');
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
    board := public.friends_board('publish',bad);
    if board->'rows'->0->'daily' is distinct from jsonb_build_object('version',v,'wpm',84,'accuracy',97,'attempts',3)
      or board->'rows'->0->'week' is distinct from jsonb_build_object('seconds',1830,'runs',41) then
      raise exception 'A stale summary lowered the stored one: % gave %', bad, board;
    end if;
  end loop;
  -- The same speed more accurately is better, and practice time and runs each keep the larger.
  board := public.friends_board('publish',jsonb_build_object('daily',jsonb_build_object('date',today,'version',v,'wpm',84,'accuracy',99,'attempts',1),
    'week',jsonb_build_object('start',monday,'seconds',1900,'runs',40)));
  if board->'rows'->0->'daily' is distinct from jsonb_build_object('version',v,'wpm',84,'accuracy',99,'attempts',3)
    or board->'rows'->0->'week' is distinct from jsonb_build_object('seconds',1900,'runs',41) then
    raise exception 'A better result or more practice was not kept: %', board;
  end if;
  -- A daily from another build is never compared, so it takes the stored one's place.
  board := public.friends_board('publish',jsonb_build_object('daily',jsonb_build_object('date',today,'version',v || '+next','wpm',61,'accuracy',95,'attempts',1),
    'week',jsonb_build_object('start',monday,'seconds',10,'runs',1)));
  if board->'rows'->0->'daily' is distinct from jsonb_build_object('version',v || '+next','wpm',61,'accuracy',95,'attempts',1)
    or board->'rows'->0->'week' is distinct from jsonb_build_object('seconds',1900,'runs',41) then
    raise exception 'A daily from another build did not replace the stored one: %', board;
  end if;
  -- A history clear and its undo replace the row, so the numbers can go down and a daily can go.
  board := public.friends_board('replace',jsonb_build_object('daily',null,'week',jsonb_build_object('start',monday,'seconds',0,'runs',0)));
  if jsonb_typeof(board->'rows'->0->'daily') <> 'null' or board->'rows'->0->'week' is distinct from jsonb_build_object('seconds',0,'runs',0) then
    raise exception 'A clear did not replace the stored summary: %', board;
  end if;
  board := public.friends_board('replace',jsonb_build_object('daily',jsonb_build_object('date',today,'version',v,'wpm',84,'accuracy',97,'attempts',2),'week',week));
  if board->'rows'->0->'daily' is distinct from jsonb_build_object('version',v,'wpm',84,'accuracy',97,'attempts',2)
    or board->'rows'->0->'week' is distinct from jsonb_build_object('seconds',1830,'runs',41) then
    raise exception 'An undo did not restore the summary: %', board;
  end if;

  -- Lin has Ada on her list, but Ada has not chosen Lin: neither sees the other.
  perform set_config('request.jwt.claim.sub',lin::text,true);
  perform public.race_action('befriend',null,jsonb_build_object('email',ada_email,'name','Ada'),null);
  board := public.friends_board('publish',jsonb_build_object('daily',jsonb_build_object('date',today,'version',v,'wpm',72,'accuracy',96,'attempts',1),
    'week',jsonb_build_object('start',monday,'seconds',754,'runs',12)));
  if jsonb_array_length(board->'rows') <> 1 then raise exception 'A one-way friend appeared on the board.'; end if;
  perform set_config('request.jwt.claim.sub',ada::text,true);
  board := public.friends_board('board','{}');
  if jsonb_array_length(board->'rows') <> 1 or board::text like '%754%' then raise exception 'Someone who added Ada appeared without being chosen back.'; end if;

  -- Once Ada adds Lin's email too, each sees the other, labelled with their own name for them.
  friends := public.race_action('befriend',null,jsonb_build_object('email',lin_email,'name','Lin'),null);
  lin_row := friends->0->>'id';
  board := public.friends_board('board','{}');
  if jsonb_array_length(board->'rows') <> 2 or board->'rows'->1->>'name' <> 'Lin' or board->'rows'->1->>'id' <> lin_row
    or (board->'rows'->1->>'self')::boolean or board->'rows'->1->'daily'->>'wpm' <> '72'
    or board->'rows'->1->'daily'->>'accuracy' <> '96' or board->'rows'->1->'week'->>'seconds' <> '754' then
    raise exception 'Mutual friend missing from the board: %', board;
  end if;
  if board::text ilike '%' || lin::text || '%' or board::text ilike '%' || lin_email || '%' or board::text ilike '%' || ada::text || '%' then
    raise exception 'The board exposed an account id or email.';
  end if;
  perform set_config('request.jwt.claim.sub',lin::text,true);
  board := public.friends_board('board','{}');
  if jsonb_array_length(board->'rows') <> 2 or board->'rows'->1->>'name' <> 'Ada' or board->'rows'->1->'daily'->>'wpm' <> '84' then
    raise exception 'Lin does not see Ada: %', board;
  end if;

  -- An unconfirmed email never resolves, in either direction.
  perform set_config('request.jwt.claim.sub',kai::text,true);
  perform public.race_action('befriend',null,jsonb_build_object('email',ada_email,'name','Ada'),null);
  board := public.friends_board('publish',jsonb_build_object('daily',null,'week',jsonb_build_object('start',monday,'seconds',300,'runs',3)));
  if jsonb_array_length(board->'rows') <> 1 then raise exception 'An unconfirmed account saw a friend.'; end if;
  perform set_config('request.jwt.claim.sub',ada::text,true);
  perform public.race_action('befriend',null,jsonb_build_object('email',kai_email,'name','Kai'),null);
  if jsonb_array_length(public.friends_board('board','{}')->'rows') <> 2 then raise exception 'An unconfirmed email resolved to an account.'; end if;

  -- Someone on the list twice (raced, and typed by email) appears once, under the raced name, even
  -- with nothing published yet.
  insert into race_private.friends(owner_id, friend_id, name) values (ada, sam, 'Sam from the race'), (sam, ada, 'Ada');
  perform public.race_action('befriend',null,jsonb_build_object('email',sam_email,'name','Sam'),null);
  board := public.friends_board('board','{}');
  if jsonb_array_length(board->'rows') <> 3 or board->'rows'->2->>'name' <> 'Sam from the race'
    or jsonb_typeof(board->'rows'->2->'daily') <> 'null' or jsonb_typeof(board->'rows'->2->'week') <> 'null' then
    raise exception 'A friend listed twice was not shown once: %', board;
  end if;

  -- Yesterday's daily and last week's practice read as nothing yet, whatever the session time zone.
  perform set_config('TimeZone','Pacific/Kiritimati',true);
  perform set_config('request.jwt.claim.sub',lin::text,true);
  perform public.friends_board('replace',jsonb_build_object('daily',jsonb_build_object('date',today - 1,'version',v,'wpm',75,'accuracy',95,'attempts',1),
    'week',jsonb_build_object('start',monday,'seconds',800,'runs',13)));
  perform set_config('request.jwt.claim.sub',ada::text,true);
  board := public.friends_board('board','{}');
  if board->>'date' <> today::text or jsonb_typeof(board->'rows'->1->'daily') <> 'null' or board->'rows'->1->'week'->>'seconds' <> '800' then
    raise exception 'Yesterday''s daily showed as today''s: %', board;
  end if;
  update race_private.summaries set week_start = monday - 7 where user_id = lin;
  if jsonb_typeof(public.friends_board('board','{}')->'rows'->1->'week') <> 'null' then raise exception 'Last week''s practice showed as this week''s.'; end if;

  -- Today's result and this week's practice take the place of yesterday's and last week's, even when
  -- lower. Today's also wins over a later day sent from a clock running ahead.
  perform set_config('request.jwt.claim.sub',lin::text,true);
  board := public.friends_board('publish',jsonb_build_object('daily',jsonb_build_object('date',today,'version',v,'wpm',60,'accuracy',94,'attempts',1),
    'week',jsonb_build_object('start',monday,'seconds',30,'runs',1)));
  if board->'rows'->0->'daily' is distinct from jsonb_build_object('version',v,'wpm',60,'accuracy',94,'attempts',1)
    or board->'rows'->0->'week' is distinct from jsonb_build_object('seconds',30,'runs',1) then
    raise exception 'A new day or week did not replace the old one: %', board;
  end if;
  update race_private.summaries set daily_date = today + 1, daily_wpm = 99 where user_id = lin;
  board := public.friends_board('publish',jsonb_build_object('daily',jsonb_build_object('date',today,'version',v,'wpm',58,'accuracy',94,'attempts',1),
    'week',jsonb_build_object('start',monday,'seconds',30,'runs',1)));
  if board->'rows'->0->'daily' is distinct from jsonb_build_object('version',v,'wpm',58,'accuracy',94,'attempts',1) then
    raise exception 'A later day kept today''s result off the board: %', board;
  end if;
  perform set_config('request.jwt.claim.sub',ada::text,true);

  -- Clearing a daily result clears it for friends too.
  perform public.friends_board('replace',jsonb_build_object('daily',null,'week',week));
  perform set_config('request.jwt.claim.sub',lin::text,true);
  board := public.friends_board('board','{}');
  if jsonb_typeof(board->'rows'->1->'daily') <> 'null' or board->'rows'->1->'week'->>'seconds' <> '1830' then raise exception 'A cleared daily still showed.'; end if;

  -- Removing someone hides you from them, and them from you.
  perform public.race_action('unfriend',null,jsonb_build_object('friendId',(public.race_action('friends',null,'{}',null)->0->>'id')),null);
  if jsonb_array_length(public.friends_board('board','{}')->'rows') <> 1 then raise exception 'A removed friend still showed.'; end if;
  perform set_config('request.jwt.claim.sub',ada::text,true);
  board := public.friends_board('board','{}');
  if jsonb_array_length(board->'rows') <> 2 or board->'rows'->1->>'name' <> 'Sam from the race' then raise exception 'Ada still sees someone who removed her: %', board; end if;
  raise notice 'Friends board privacy, mutual lists, limits, dates and merge checks passed.';
end $smoke$;
rollback;
