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
-- Turning sharing on as a browser does: sent with the sharing version its last read of the board gave.
create function pg_temp.share(p_data jsonb default '{}') returns jsonb language plpgsql as $$
begin
  return pg_temp.board('share', p_data || jsonb_build_object('version', pg_temp.board('board')->'sharingVersion'));
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
-- A profile save as a browser makes it over the API, as the caller (an upsert of its own row): the data,
-- `updated_at`, and the board column, or (p_board_too false, as an older build) only the first two.
create function pg_temp.save(p_at timestamptz, p_board jsonb, p_board_too boolean default true) returns void language plpgsql as $$
begin
  perform pg_temp.as_caller();
  begin
    if p_board_too then
      insert into public.profiles (user_id, data, updated_at, board) values (auth.uid(), '{"version":2}', p_at, p_board)
        on conflict (user_id) do update set data = excluded.data, updated_at = excluded.updated_at, board = excluded.board;
    else
      insert into public.profiles (user_id, data, updated_at) values (auth.uid(), '{"version":2}', p_at)
        on conflict (user_id) do update set data = excluded.data, updated_at = excluded.updated_at;
    end if;
  exception when others then
    perform set_config('role', 'none', true);
    raise;
  end;
  perform set_config('role', 'none', true);
end $$;
-- A browser's repair: the board column only, and only while the row is still the version stamped p_at.
-- Also any direct write an account makes to a row: how many rows it changed.
create function pg_temp.repair(p_at timestamptz, p_board jsonb, p_owner uuid default null) returns integer language plpgsql as $$
declare
  v_count integer;
begin
  perform pg_temp.as_caller();
  begin
    update public.profiles set board = p_board where user_id = coalesce(p_owner, auth.uid()) and updated_at = p_at;
    get diagnostics v_count = row_count;
  exception when others then
    perform set_config('role', 'none', true);
    raise;
  end;
  perform set_config('role', 'none', true);
  return v_count;
end $$;
-- How many of an account's profile rows the caller can read over the API.
create function pg_temp.peek(p_owner uuid) returns integer language plpgsql as $$
declare
  v_count integer;
begin
  perform pg_temp.as_caller();
  begin
    select count(*) into v_count from public.profiles where user_id = p_owner;
  exception when others then
    perform set_config('role', 'none', true);
    raise;
  end;
  perform set_config('role', 'none', true);
  return v_count;
end $$;
-- One period's entry as a summary keys it: a daily under its `date`, a week's practice under its `start`.
-- Anything else (no such key, not an object) is put in the summary as it is, standing for a malformed map.
create function pg_temp.keyed(p_part jsonb, p_key text) returns jsonb language sql as $$
  select case when p_part is null or jsonb_typeof(p_part) = 'null' then '{}'::jsonb
    when jsonb_typeof(p_part) = 'object' and jsonb_typeof(p_part->p_key) = 'string' then jsonb_build_object(p_part->>p_key, p_part - p_key)
    else p_part end
$$;
-- A summary as the browser writes it: stamped with its save in the browser's own format (milliseconds, Z),
-- with this daily and this week's practice, each keyed by its own period.
create function pg_temp.col(p_at timestamptz, p_daily jsonb, p_week jsonb) returns jsonb language sql as $$
  select jsonb_build_object('v', 1, 'at', to_char(p_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'days', pg_temp.keyed(p_daily, 'date'), 'weeks', pg_temp.keyed(p_week, 'start'))
$$;
-- A save's stamp: now, to the millisecond, as a browser's clock gives it.
create function pg_temp.stamp(p_offset interval default '0') returns timestamptz language sql as $$
  select date_trunc('milliseconds', clock_timestamp() + p_offset)
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
  -- A daily version as the browser sends it: the conditions key, then the passage.
  v text := 'quote:::punctuation:medium:any::physical-keyboard:relaxed:original-en-v5:stilltype-metrics-v1|daily-abc123@1';
  daily jsonb;
  week jsonb;
  shown_daily jsonb;
  shown_week jsonb;
  board jsonb;
  friends jsonb;
  lin_row text;
  bad jsonb;
  at timestamptz;
  old_at timestamptz;
  seconds integer;
  denied boolean;
begin
  insert into auth.users (id,email,email_confirmed_at) values
    (ada,ada_email,now()), (lin,lin_stored,now()), (sam,sam_email,now()), (kai,kai_email,null);
  daily := jsonb_build_object('date',today,'version',v,'wpm',84,'accuracy',97,'attempts',2);
  week := jsonb_build_object('start',monday,'seconds',1830,'runs',41);
  shown_daily := jsonb_build_object('version',v,'wpm',84,'accuracy',97,'attempts',2);
  shown_week := jsonb_build_object('seconds',1830,'runs',41);

  -- Membership and the helpers are out of the browser's reach; only the wrapper is callable, and only
  -- when signed in. The board column is the owner's like the rest of the row.
  if has_table_privilege('anon','race_private.board_members','SELECT')
    or has_table_privilege('authenticated','race_private.board_members','SELECT')
    or has_table_privilege('authenticated','race_private.board_members','INSERT')
    or has_table_privilege('authenticated','race_private.board_members','DELETE')
    or has_function_privilege('authenticated','race_private.board_snapshot(uuid)','EXECUTE')
    or has_function_privilege('authenticated','race_private.board_numbers(jsonb,timestamptz,date,date)','EXECUTE')
    or has_function_privilege('anon','race_private.board(text,jsonb)','EXECUTE')
    or has_function_privilege('anon','public.friends_board(text,jsonb)','EXECUTE')
    or has_column_privilege('anon','public.profiles','board','SELECT')
    or not has_column_privilege('authenticated','public.profiles','board','UPDATE')
    or not has_function_privilege('authenticated','public.friends_board(text,jsonb)','EXECUTE')
    or not has_function_privilege('authenticated','race_private.board(text,jsonb)','EXECUTE')
    or not (select relrowsecurity from pg_class where oid = 'race_private.board_members'::regclass) then
    raise exception 'Board storage or helpers are exposed.';
  end if;

  -- Guests (the anon role) have no board.
  perform set_config('request.jwt.claim.sub','',true);
  denied := false;
  begin perform pg_temp.board('board','{}');
  exception when others then denied := true; end;
  if not denied then raise exception 'Guest read a board.'; end if;

  -- Ada's profile saves carry her summary whether or not she shares. Sharing is off until chosen: her
  -- board is empty, reading it shares nothing, and an unknown action is refused.
  perform set_config('request.jwt.claim.sub',ada::text,true);
  at := pg_temp.stamp();
  perform pg_temp.save(at, pg_temp.col(at, daily, week));
  board := pg_temp.board('board','{}');
  if (board->>'sharing')::boolean or board->'rows' <> '[]'::jsonb or board ? 'clear' or board ? 'now'
    or exists(select 1 from race_private.board_members where user_id = ada) then
    raise exception 'An account that does not share was shown, or the reply says too much: %', board;
  end if;
  denied := false;
  begin perform pg_temp.board('rank','{}');
  exception when others then denied := true; end;
  if not denied then raise exception 'Unknown board action was accepted.'; end if;

  -- Sharing makes her a member; it carries no numbers (any sent are ignored), and a repeat is answered as
  -- done. She sees only herself, with what her profile row holds, until a friend chooses her back.
  board := pg_temp.share(jsonb_build_object('daily',jsonb_build_object('wpm',399),'week',week));
  board := pg_temp.share();
  if not (board->>'sharing')::boolean or board->>'date' <> today::text or board->>'weekStart' <> monday::text
    or jsonb_array_length(board->'rows') <> 1 or not (board->'rows'->0->>'self')::boolean
    or board->'rows'->0->'daily' is distinct from shown_daily or board->'rows'->0->'week' is distinct from shown_week
    or (select count(*) from race_private.board_members where user_id = ada) <> 1 then
    raise exception 'Sharing did not show the profile row''s summary: %', board;
  end if;
  -- `nextDay` counts the seconds to the service's next 00:00 UTC.
  seconds := ceil(extract(epoch from ((today + 1)::timestamp at time zone 'utc') - clock_timestamp()))::integer;
  if jsonb_typeof(board->'nextDay') <> 'number' or (board->>'nextDay')::integer not between 1 and 86400
    or abs((board->>'nextDay')::integer - seconds) > 2 then
    raise exception 'The reply did not count the seconds to midnight UTC: %', board;
  end if;

  -- The summary describes only the row it was written with. A save by an older build (no board column)
  -- moves `updated_at` and leaves the old summary, which then reads as nothing yet.
  old_at := at;
  at := pg_temp.stamp('1 second');
  perform pg_temp.save(at, null, false);
  board := pg_temp.board('board','{}');
  if jsonb_typeof(board->'rows'->0->'daily') <> 'null' or jsonb_typeof(board->'rows'->0->'week') <> 'null' then
    raise exception 'A summary showed for a row it no longer describes: %', board;
  end if;
  -- A repair counted from an older version of the row changes nothing; one from this version shows.
  if pg_temp.repair(old_at, pg_temp.col(old_at, daily, week)) <> 0 then raise exception 'A repair changed a row that had moved on.'; end if;
  if pg_temp.repair(at, pg_temp.col(old_at, daily, week)) <> 1 then raise exception 'A repair of the current row was not taken.'; end if;
  if jsonb_typeof(pg_temp.board('board','{}')->'rows'->0->'week') <> 'null' then
    raise exception 'A summary stamped for another version of the row showed.';
  end if;
  perform pg_temp.repair(at, pg_temp.col(at, daily, week));
  board := pg_temp.board('board','{}');
  if board->'rows'->0->'daily' is distinct from shown_daily or board->'rows'->0->'week' is distinct from shown_week then
    raise exception 'A repaired summary did not show: %', board;
  end if;
  -- The stamp may come back as the API writes timestamps (microseconds, an offset) too.
  perform pg_temp.repair(at, jsonb_set(pg_temp.col(at, daily, week), '{at}', to_jsonb(to_jsonb(at)#>>'{}')));
  if pg_temp.board('board','{}')->'rows'->0->'week' is distinct from shown_week then
    raise exception 'A stamp in the API''s own format was not read as the row''s.';
  end if;

  -- Each part is checked on its own, as a browser writes it: a daily out of place reads as no daily yet
  -- but leaves this week's practice showing.
  foreach bad in array array[
    jsonb_build_object('date',today,'version',v,'wpm',401,'accuracy',97,'attempts',1),
    jsonb_build_object('date',today,'version',v,'wpm',84,'accuracy',101,'attempts',1),
    jsonb_build_object('date',today,'version',v,'wpm',84.5,'accuracy',97,'attempts',1),
    jsonb_build_object('date',today,'version',v,'wpm',-1,'accuracy',97,'attempts',1),
    jsonb_build_object('date',today,'version',v,'wpm','84','accuracy',97,'attempts',1),
    jsonb_build_object('date',today,'version',v,'wpm',84,'accuracy',97,'attempts',0),
    jsonb_build_object('date',today,'version',v,'wpm',84,'accuracy',97,'attempts',1001),
    jsonb_build_object('date',today,'version',v,'wpm',99999999999999999999,'accuracy',97,'attempts',1),
    jsonb_build_object('date',today - 1,'version',v,'wpm',84,'accuracy',97,'attempts',1),
    jsonb_build_object('date',today + 1,'version',v,'wpm',84,'accuracy',97,'attempts',1),
    jsonb_build_object('date','2026-02-31','version',v,'wpm',84,'accuracy',97,'attempts',1),
    jsonb_build_object('version',v,'wpm',84,'accuracy',97,'attempts',1),
    jsonb_build_object('date',today,'wpm',84,'accuracy',97,'attempts',1),
    jsonb_build_object('date',today,'version',7,'wpm',84,'accuracy',97,'attempts',1),
    jsonb_build_object('date',today,'version',repeat('x',201),'wpm',84,'accuracy',97,'attempts',1),
    jsonb_build_object('date',today,'version',E'v1\n','wpm',84,'accuracy',97,'attempts',1),
    to_jsonb('84 wpm'::text),
    '[84]'::jsonb
  ] loop
    at := pg_temp.stamp();
    perform pg_temp.save(at, pg_temp.col(at, bad, week));
    board := pg_temp.board('board','{}');
    if jsonb_typeof(board->'rows'->0->'daily') <> 'null' or board->'rows'->0->'week' is distinct from shown_week then
      raise exception 'A daily out of place showed, or hid the week: % gave %', bad, board;
    end if;
  end loop;
  -- And a week out of place reads as nothing yet this week, leaving today's daily showing.
  foreach bad in array array[
    jsonb_build_object('start',monday + 1,'seconds',60,'runs',1),
    jsonb_build_object('start',monday - 7,'seconds',60,'runs',1),
    jsonb_build_object('start',monday,'seconds',604801,'runs',1),
    jsonb_build_object('start',monday,'seconds',-60,'runs',1),
    jsonb_build_object('start',monday,'seconds',60.5,'runs',1),
    jsonb_build_object('start',monday,'seconds',60),
    jsonb_build_object('start',monday,'seconds',60,'runs',10001),
    jsonb_build_object('start',monday,'seconds',60,'runs',2.5),
    jsonb_build_object('start',monday,'seconds',60,'runs',-1),
    jsonb_build_object('start',monday,'seconds',60,'runs','1'),
    jsonb_build_object('start','2026-13-01','seconds',60,'runs',1),
    to_jsonb(1830)
  ] loop
    at := pg_temp.stamp();
    perform pg_temp.save(at, pg_temp.col(at, daily, bad));
    board := pg_temp.board('board','{}');
    if board->'rows'->0->'daily' is distinct from shown_daily or jsonb_typeof(board->'rows'->0->'week') <> 'null' then
      raise exception 'A week out of place showed, or hid the daily: % gave %', bad, board;
    end if;
  end loop;
  -- A malformed or forged column never raises: it reads as nothing yet. An impossible stamp, one that
  -- isn't a time, a number, an empty object, or numbers without any stamp.
  foreach bad in array array[
    jsonb_build_object('v',1,'at','2026-02-31T10:00:00Z') || (pg_temp.col(at, daily, week) - 'v' - 'at'),
    jsonb_build_object('v',1,'at','2026-04-31T10:00:00.000Z') || (pg_temp.col(at, daily, week) - 'v' - 'at'),
    jsonb_build_object('v',1,'at','yesterday') || (pg_temp.col(at, daily, week) - 'v' - 'at'),
    jsonb_build_object('v',1,'at',7) || (pg_temp.col(at, daily, week) - 'v' - 'at'),
    jsonb_build_object('v',1,'at',null) || (pg_temp.col(at, daily, week) - 'v' - 'at'),
    pg_temp.col(at, daily, week) - 'at',
    '{}'::jsonb
  ] loop
    at := pg_temp.stamp();
    perform pg_temp.save(at, bad);
    board := pg_temp.board('board','{}');
    if jsonb_typeof(board->'rows'->0->'daily') <> 'null' or jsonb_typeof(board->'rows'->0->'week') <> 'null' then
      raise exception 'A forged column showed: % gave %', bad, board;
    end if;
  end loop;
  -- The column itself takes only an object of at most 16 KB, however it is written.
  foreach bad in array array['[1,2]'::jsonb, '"84 wpm"'::jsonb, '84'::jsonb,
    jsonb_build_object('v',1,'pad',(select string_agg(md5(i::text), '') from generate_series(1, 700) i))] loop
    denied := false;
    begin perform pg_temp.save(pg_temp.stamp(), bad);
    exception when check_violation then denied := true; end;
    if not denied then raise exception 'The board column took %', left(bad::text, 40); end if;
  end loop;
  -- A summary keeps the latest days and weeks its runs fall in, each by the run's own record, whatever
  -- the writer's clock said: the service shows its own today's and this week's, and only those.
  at := pg_temp.stamp();
  perform pg_temp.save(at, jsonb_build_object('v',1,'at',pg_temp.col(at, null, null)->'at',
    'days', jsonb_build_object((today + 1)::text, jsonb_build_object('version',v,'wpm',99,'accuracy',99,'attempts',1),
      today::text, daily - 'date', (today - 1)::text, jsonb_build_object('version',v,'wpm',98,'accuracy',99,'attempts',1)),
    'weeks', jsonb_build_object((monday + 7)::text, jsonb_build_object('seconds',99,'runs',9),
      monday::text, week - 'start', (monday - 7)::text, jsonb_build_object('seconds',98,'runs',8))));
  board := pg_temp.board('board','{}');
  if board->'rows'->0->'daily' is distinct from shown_daily or board->'rows'->0->'week' is distinct from shown_week then
    raise exception 'The entries for the service''s own day and week were not the ones shown: %', board;
  end if;
  at := pg_temp.stamp();
  perform pg_temp.save(at, pg_temp.col(at, daily, week));

  -- Lin has Ada on her list, but Ada has not chosen Lin: neither sees the other.
  perform set_config('request.jwt.claim.sub',lin::text,true);
  perform pg_temp.race('befriend',null,jsonb_build_object('email',ada_email,'name','Ada'),null);
  at := pg_temp.stamp();
  perform pg_temp.save(at, pg_temp.col(at, jsonb_build_object('date',today,'version',v,'wpm',72,'accuracy',96,'attempts',1),
    jsonb_build_object('start',monday,'seconds',754,'runs',12)));
  board := pg_temp.share();
  if jsonb_array_length(board->'rows') <> 1 then raise exception 'A one-way friend appeared on the board.'; end if;
  -- Nor can Lin read or change Ada's row, board column included, directly.
  if pg_temp.peek(ada) <> 0 or pg_temp.peek(lin) <> 1 then raise exception 'Lin read Ada''s profile row, or not her own.'; end if;
  if pg_temp.repair((select updated_at from public.profiles where user_id = ada), '{}'::jsonb, ada) <> 0 then
    raise exception 'Lin changed Ada''s board column.';
  end if;
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
  -- A forged column of Ada's reads as nothing yet on Lin's board, and her board still works.
  perform set_config('request.jwt.claim.sub',ada::text,true);
  at := pg_temp.stamp();
  perform pg_temp.save(at, jsonb_build_object('v',1,'at','2026-02-30T00:00:00Z','days','x','weeks',jsonb_build_object(monday::text,jsonb_build_object('seconds','1e9','runs','[]'::jsonb))));
  perform set_config('request.jwt.claim.sub',lin::text,true);
  board := pg_temp.board('board','{}');
  if jsonb_array_length(board->'rows') <> 2 or jsonb_typeof(board->'rows'->1->'week') <> 'null' or board->'rows'->0->'week'->>'seconds' <> '754' then
    raise exception 'A forged column broke a friend''s board: %', board;
  end if;
  perform set_config('request.jwt.claim.sub',ada::text,true);
  at := pg_temp.stamp();
  perform pg_temp.save(at, pg_temp.col(at, daily, week));

  -- An unconfirmed email never resolves, in either direction.
  perform set_config('request.jwt.claim.sub',kai::text,true);
  perform pg_temp.race('befriend',null,jsonb_build_object('email',ada_email,'name','Ada'),null);
  board := pg_temp.share();
  if jsonb_array_length(board->'rows') <> 1 then raise exception 'An unconfirmed account saw a friend.'; end if;
  perform set_config('request.jwt.claim.sub',ada::text,true);
  perform pg_temp.race('befriend',null,jsonb_build_object('email',kai_email,'name','Kai'),null);
  if jsonb_array_length(pg_temp.board('board','{}')->'rows') <> 2 then raise exception 'An unconfirmed email resolved to an account.'; end if;

  -- A mutual friend who doesn't share is not on the board, and sees no one on theirs, even friends who
  -- share, whatever their own profile row holds.
  insert into race_private.friends(owner_id, friend_id, name) values (ada, sam, 'Sam from the race'), (sam, ada, 'Ada');
  perform pg_temp.race('befriend',null,jsonb_build_object('email',sam_email,'name','Sam'),null);
  if jsonb_array_length(pg_temp.board('board','{}')->'rows') <> 2 then raise exception 'A friend who does not share appeared.'; end if;
  perform set_config('request.jwt.claim.sub',sam::text,true);
  board := pg_temp.board('board','{}');
  if (board->>'sharing')::boolean or board->'rows' <> '[]'::jsonb then raise exception 'Someone who does not share saw the board: %', board; end if;

  -- Once Sam shares, with no profile row yet, he shows with nothing yet; and someone on the list twice
  -- (raced, and typed by email) appears once, under the raced name.
  perform pg_temp.share();
  perform set_config('request.jwt.claim.sub',ada::text,true);
  board := pg_temp.board('board','{}');
  if jsonb_array_length(board->'rows') <> 3 or board->'rows'->2->>'name' <> 'Sam from the race'
    or jsonb_typeof(board->'rows'->2->'daily') <> 'null' or jsonb_typeof(board->'rows'->2->'week') <> 'null' then
    raise exception 'A friend listed twice, with no profile row, was not shown once with nothing yet: %', board;
  end if;

  -- Yesterday's daily and last week's practice read as nothing yet, whatever the session time zone.
  perform set_config('TimeZone','Pacific/Kiritimati',true);
  perform set_config('request.jwt.claim.sub',lin::text,true);
  at := pg_temp.stamp();
  perform pg_temp.save(at, pg_temp.col(at, jsonb_build_object('date',today - 1,'version',v,'wpm',75,'accuracy',95,'attempts',1),
    jsonb_build_object('start',monday,'seconds',800,'runs',13)));
  perform set_config('request.jwt.claim.sub',ada::text,true);
  board := pg_temp.board('board','{}');
  if board->>'date' <> today::text or jsonb_typeof(board->'rows'->1->'daily') <> 'null' or board->'rows'->1->'week'->>'seconds' <> '800' then
    raise exception 'Yesterday''s daily showed as today''s: %', board;
  end if;
  perform set_config('request.jwt.claim.sub',lin::text,true);
  at := pg_temp.stamp();
  perform pg_temp.save(at, pg_temp.col(at, null, jsonb_build_object('start',monday - 7,'seconds',800,'runs',13)));
  perform set_config('request.jwt.claim.sub',ada::text,true);
  if jsonb_typeof(pg_temp.board('board','{}')->'rows'->1->'week') <> 'null' then raise exception 'Last week''s practice showed as this week''s.'; end if;
  -- The stamp in the session's own offset is the same time.
  perform set_config('request.jwt.claim.sub',lin::text,true);
  at := pg_temp.stamp();
  perform pg_temp.save(at, jsonb_set(pg_temp.col(at, null, jsonb_build_object('start',monday,'seconds',30,'runs',1)), '{at}', to_jsonb(to_jsonb(at)#>>'{}')));
  if (select p.board->>'at' from public.profiles p where p.user_id = lin) not like '%+14:00' then raise exception 'The stamp was not written in the session''s offset.'; end if;
  perform set_config('request.jwt.claim.sub',ada::text,true);
  if pg_temp.board('board','{}')->'rows'->1->'week' is distinct from jsonb_build_object('seconds',30,'runs',1) then
    raise exception 'A stamp with an offset was not read as the row''s.';
  end if;
  perform set_config('TimeZone','UTC',true);

  -- Removing someone hides you from them, and them from you.
  perform set_config('request.jwt.claim.sub',lin::text,true);
  perform pg_temp.race('unfriend',null,jsonb_build_object('friendId',(pg_temp.race('friends',null,'{}',null)->0->>'id')),null);
  if jsonb_array_length(pg_temp.board('board','{}')->'rows') <> 1 then raise exception 'A removed friend still showed.'; end if;
  perform set_config('request.jwt.claim.sub',ada::text,true);
  board := pg_temp.board('board','{}');
  if jsonb_array_length(board->'rows') <> 2 or board->'rows'->1->>'name' <> 'Sam from the race' then raise exception 'Ada still sees someone who removed her: %', board; end if;

  -- Turning sharing off takes Ada off the board at once: friends stop seeing her and her board empties.
  -- Her summary stays only in her own profile row, beside the history it is counted from. Turning off
  -- twice is fine, and her saves meanwhile share nothing.
  perform set_config('request.jwt.claim.sub',sam::text,true);
  if jsonb_array_length(pg_temp.board('board','{}')->'rows') <> 2 then raise exception 'Sam does not see Ada.'; end if;
  perform set_config('request.jwt.claim.sub',ada::text,true);
  foreach bad in array array['{}'::jsonb, '{}'::jsonb] loop
    board := pg_temp.board('unshare', bad);
    if (board->>'sharing')::boolean or board->'rows' <> '[]'::jsonb or exists(select 1 from race_private.board_members where user_id = ada) then
      raise exception 'Turning sharing off left Ada on the board: %', board;
    end if;
  end loop;
  at := pg_temp.stamp();
  perform pg_temp.save(at, pg_temp.col(at, daily, week));
  if (select p.board->'weeks'->(monday::text) from public.profiles p where p.user_id = ada) is distinct from week - 'start' then
    raise exception 'The owner''s own row lost its summary.';
  end if;
  perform set_config('request.jwt.claim.sub',sam::text,true);
  board := pg_temp.board('board','{}');
  if jsonb_array_length(board->'rows') <> 1 or board::text like '%1830%' then raise exception 'Sam still sees Ada after she stopped sharing: %', board; end if;

  -- Turning sharing on again shows her row again, as her profile row holds it.
  perform set_config('request.jwt.claim.sub',ada::text,true);
  board := pg_temp.share();
  if not (board->>'sharing')::boolean or board->'rows'->0->'week' is distinct from shown_week then
    raise exception 'Turning sharing on again failed: %', board;
  end if;
  perform set_config('request.jwt.claim.sub',sam::text,true);
  board := pg_temp.board('board','{}');
  if jsonb_array_length(board->'rows') <> 2 or board->'rows'->1->'week' is distinct from shown_week then
    raise exception 'Sam does not see Ada once she shares again: %', board;
  end if;

  -- Deleting an account deletes its membership and its profile row with the summary.
  delete from auth.users where id = ada;
  if exists(select 1 from race_private.board_members where user_id = ada) or exists(select 1 from public.profiles where user_id = ada) then
    raise exception 'A deleted account kept its board membership or summary.';
  end if;
  raise notice 'Friends board privacy, opt-in membership, binding to the profile row, repairs, per-part limits, forged columns, mutual lists, dates and deletion checks passed.';
end $smoke$;

-- Changes to sharing apply in order, account-wide. Every share and opt-out the service applies moves the
-- account's sharing version on by one, and every reply carries it. A share counts only when sent with
-- the version the account is still at, so one that arrives after an opt-out made since is refused; an
-- opt-out always counts.
do $order$
declare
  eve uuid := gen_random_uuid();
  finn uuid := gen_random_uuid();
  gus uuid := gen_random_uuid();
  board jsonb;
  seen bigint;
  bad jsonb;
  denied boolean;
begin
  insert into auth.users (id,email,email_confirmed_at) values (eve,'board-order-' || eve::text || '@example.invalid',now()),
    (finn,'board-order-' || finn::text || '@example.invalid',now()), (gus,'board-order-' || gus::text || '@example.invalid',now());
  insert into race_private.friends(owner_id, friend_id, name) values (eve, finn, 'Finn'), (finn, eve, 'Eve');
  perform set_config('request.jwt.claim.sub',finn::text,true);
  perform pg_temp.share();
  perform set_config('request.jwt.claim.sub',eve::text,true);
  perform pg_temp.share();

  -- One device turns Eve's sharing off, reads that, and turns it on again; that share is slow on its
  -- way. Another device, still showing sharing on, turns it off, and the service confirms it. The share,
  -- sent with the version from before that newer opt-out, arrives after it: it is refused, and its reply
  -- says Eve doesn't share. Nobody sees her.
  seen := (pg_temp.board('unshare')->>'sharingVersion')::bigint;
  board := pg_temp.board('unshare');
  if (board->>'sharing')::boolean or (board->>'sharingVersion')::bigint <> seen + 1 then
    raise exception 'An opt-out from another device was not applied: %', board;
  end if;
  board := pg_temp.board('share', jsonb_build_object('version', seen));
  if (board->>'sharing')::boolean or (board->>'sharingVersion')::bigint <> seen + 1 or board->'rows' <> '[]'::jsonb
    or exists(select 1 from race_private.board_members where user_id = eve) then
    raise exception 'A share sent before a newer opt-out undid it: %', board;
  end if;
  perform set_config('request.jwt.claim.sub',finn::text,true);
  if jsonb_array_length(pg_temp.board('board')->'rows') <> 1 then raise exception 'Finn still sees Eve after her newer opt-out.'; end if;
  -- Turned on again with the version that reply gave, it shares.
  perform set_config('request.jwt.claim.sub',eve::text,true);
  board := pg_temp.board('share', jsonb_build_object('version', seen + 1));
  if not (board->>'sharing')::boolean or (board->>'sharingVersion')::bigint <> seen + 2 or jsonb_array_length(board->'rows') <> 2 then
    raise exception 'A share after reading the opt-out was refused: %', board;
  end if;

  -- An opt-out always counts, whatever it is sent with, and moves the version on even when sharing is
  -- already off: one that lands after a newer share turns sharing off, the safe way round.
  seen := seen + 2;
  foreach bad in array array['{}'::jsonb, jsonb_build_object('version', seen - 2), '{"version":"x"}'::jsonb, 'null'::jsonb, null] loop
    board := pg_temp.board('unshare', bad);
    seen := seen + 1;
    if (board->>'sharing')::boolean or jsonb_typeof(board->'sharingVersion') is distinct from 'number'
      or (board->>'sharingVersion')::bigint <> seen or board->'rows' <> '[]'::jsonb
      or exists(select 1 from race_private.board_members where user_id = eve) then
      raise exception 'An opt-out sent with % did not count: %', bad, board;
    end if;
  end loop;

  -- A share without the account's version as a whole number is refused without raising: it changes
  -- nothing, and the reply says Eve doesn't share. Text, a fraction, an older or a later version, one
  -- past any integer, or no version at all.
  foreach bad in array array['{}'::jsonb, '{"version":null}'::jsonb, jsonb_build_object('version', seen::text),
    jsonb_build_object('version', seen + 0.5), jsonb_build_object('version', seen - 1), jsonb_build_object('version', seen + 1),
    '{"version":-1}'::jsonb, '{"version":9223372036854775808}'::jsonb, '{"version":1e30}'::jsonb,
    jsonb_build_object('version', jsonb_build_array(seen)), jsonb_build_object('version', jsonb_build_object('n', seen)),
    to_jsonb(seen), jsonb_build_array(seen), '"x"'::jsonb, 'null'::jsonb, null] loop
    denied := false;
    begin board := pg_temp.board('share', bad);
    exception when others then denied := true; end;
    if denied or (board->>'sharing')::boolean or (board->>'sharingVersion')::bigint <> seen
      or exists(select 1 from race_private.board_members where user_id = eve) then
      raise exception 'A share sent with % was not refused quietly: %', bad, board;
    end if;
  end loop;

  -- A new account starts at version 0, not sharing. Two of its devices that read that both turn sharing
  -- on: the first shares, and the second is refused but answered as sharing, moving nothing. So an
  -- opt-out after both still holds against either one sent again (a repeat after a lost reply).
  perform set_config('request.jwt.claim.sub',gus::text,true);
  board := pg_temp.board('board');
  if (board->>'sharing')::boolean or board->'sharingVersion' is distinct from '0'::jsonb then
    raise exception 'A new account did not start at version 0, not sharing: %', board;
  end if;
  board := pg_temp.board('share', '{"version":0}');
  if not (board->>'sharing')::boolean or board->'sharingVersion' is distinct from '1'::jsonb then raise exception 'A first share did not share: %', board; end if;
  board := pg_temp.board('share', '{"version":0}');
  if not (board->>'sharing')::boolean or board->'sharingVersion' is distinct from '1'::jsonb then
    raise exception 'A second share from the same version was not answered as sharing, or moved the version: %', board;
  end if;
  perform pg_temp.board('unshare');
  board := pg_temp.board('share', '{"version":0}');
  if (board->>'sharing')::boolean or board->'sharingVersion' is distinct from '2'::jsonb or exists(select 1 from race_private.board_members where user_id = gus) then
    raise exception 'A share sent again after a newer opt-out undid it: %', board;
  end if;

  -- The versions are the service's own: out of the browser's reach, and deleted with the account.
  if has_table_privilege('anon','race_private.board_sharing','SELECT')
    or has_table_privilege('authenticated','race_private.board_sharing','SELECT')
    or has_table_privilege('authenticated','race_private.board_sharing','INSERT')
    or has_table_privilege('authenticated','race_private.board_sharing','UPDATE')
    or has_table_privilege('authenticated','race_private.board_sharing','DELETE')
    or not (select relrowsecurity from pg_class where oid = 'race_private.board_sharing'::regclass) then
    raise exception 'The sharing versions are exposed.';
  end if;
  delete from auth.users where id in (eve, gus);
  if exists(select 1 from race_private.board_sharing where user_id in (eve, gus)) then raise exception 'A deleted account kept its sharing version.'; end if;
  raise notice 'Friends board sharing order checks passed.';
end $order$;

-- Each opt-out carries the id its device keeps it under. Sent again after its reply was lost, while it is
-- still the last change applied, it moves nothing, so the share that follows it from that device counts
-- at the first try. Any other opt-out moves the version on, even when the account is already off the
-- board: a new id, the same id after a share since, or no valid id at all.
do $optout$
declare
  hal uuid := gen_random_uuid();
  ivy uuid := gen_random_uuid();
  board jsonb;
  seen bigint;
  bad jsonb;
  denied boolean;
begin
  insert into auth.users (id,email,email_confirmed_at) values (hal,'board-optout-' || hal::text || '@example.invalid',now()),
    (ivy,'board-optout-' || ivy::text || '@example.invalid',now());
  insert into race_private.friends(owner_id, friend_id, name) values (hal, ivy, 'Ivy'), (ivy, hal, 'Hal');
  perform set_config('request.jwt.claim.sub',ivy::text,true);
  perform pg_temp.share();
  perform set_config('request.jwt.claim.sub',hal::text,true);
  board := pg_temp.share();
  seen := (board->>'sharingVersion')::bigint;
  if not (board->>'sharing')::boolean or seen <> 1 then raise exception 'Hal did not start sharing at version 1: %', board; end if;

  -- Hal turns sharing off. The service applies it; the reply is lost, so his device sends it again.
  board := pg_temp.board('unshare', '{"id":"mgm1k2-abc123"}');
  if (board->>'sharing')::boolean or (board->>'sharingVersion')::bigint <> seen + 1 then raise exception 'An opt-out with an id was not applied: %', board; end if;
  board := pg_temp.board('unshare', '{"id":"mgm1k2-abc123"}');
  if (board->>'sharing')::boolean or (board->>'sharingVersion')::bigint <> seen + 1 or board->'rows' <> '[]'::jsonb
    or exists(select 1 from race_private.board_members where user_id = hal) then
    raise exception 'The same opt-out sent again moved the version or left Hal on the board: %', board;
  end if;
  -- So the share his device sends next, with the version that reply gave, counts at the first try.
  board := pg_temp.board('share', jsonb_build_object('version', seen + 1));
  if not (board->>'sharing')::boolean or (board->>'sharingVersion')::bigint <> seen + 2 or jsonb_array_length(board->'rows') <> 2 then
    raise exception 'The share after a repeated opt-out was refused: %', board;
  end if;
  seen := seen + 2;

  -- That opt-out arriving once more after the share (a copy slow on its way) is no longer the last change:
  -- it counts as an opt-out again, the safe way round, and moves the version, so every device can tell.
  board := pg_temp.board('unshare', '{"id":"mgm1k2-abc123"}');
  seen := seen + 1;
  if (board->>'sharing')::boolean or (board->>'sharingVersion')::bigint <> seen
    or exists(select 1 from race_private.board_members where user_id = hal) then
    raise exception 'An opt-out sent again after a share did not take Hal off the board with a new version: %', board;
  end if;

  -- A new id moves the version on although Hal is already off the board, so a share another device sent
  -- with the version from before it is refused. Its repeat moves nothing.
  board := pg_temp.board('unshare', '{"id":"mgm1k9_xyz789"}');
  if (board->>'sharingVersion')::bigint <> seen + 1 then raise exception 'A new opt-out while off the board did not move the version: %', board; end if;
  board := pg_temp.board('share', jsonb_build_object('version', seen));
  if (board->>'sharing')::boolean or (board->>'sharingVersion')::bigint <> seen + 1 or exists(select 1 from race_private.board_members where user_id = hal) then
    raise exception 'A share sent before a newer opt-out (made while off the board) undid it: %', board;
  end if;
  seen := seen + 1;
  board := pg_temp.board('unshare', '{"id":"mgm1k9_xyz789"}');
  if (board->>'sharingVersion')::bigint <> seen then raise exception 'A repeated opt-out moved the version: %', board; end if;

  -- An opt-out without a valid id is a new one each time, never raises, and is never taken for a repeat;
  -- after one, the earlier id is a new one again.
  foreach bad in array array['{}'::jsonb, '{"id":null}'::jsonb, '{"id":""}'::jsonb, jsonb_build_object('id', repeat('a', 65)),
    '{"id":"a b"}'::jsonb, '{"id":"a1\n"}'::jsonb, '{"id":"ö1"}'::jsonb, '{"id":"a1;--"}'::jsonb, '{"id":7}'::jsonb,
    '{"id":["a1"]}'::jsonb, '{"id":{"a":1}}'::jsonb, '"a1"'::jsonb, 'null'::jsonb, null, '{"id":""}'::jsonb] loop
    denied := false;
    begin board := pg_temp.board('unshare', bad);
    exception when others then denied := true; end;
    seen := seen + 1;
    if denied or (board->>'sharing')::boolean or (board->>'sharingVersion')::bigint <> seen then
      raise exception 'An opt-out with id % was not a new one: %', bad, board;
    end if;
  end loop;
  board := pg_temp.board('unshare', '{"id":"mgm1k9_xyz789"}');
  seen := seen + 1;
  if (board->>'sharingVersion')::bigint <> seen then raise exception 'An id applied before an opt-out without one was taken for a repeat: %', board; end if;
  -- The longest id there can be is still an id.
  board := pg_temp.board('unshare', jsonb_build_object('id', repeat('z', 64)));
  board := pg_temp.board('unshare', jsonb_build_object('id', repeat('z', 64)));
  if (board->>'sharingVersion')::bigint <> seen + 1 then raise exception 'A 64-character id was not recognised when sent again: %', board; end if;

  -- What the service keeps is its own: a browser can't read or set the id it keeps either.
  if has_column_privilege('authenticated','race_private.board_sharing','last_optout','SELECT')
    or has_column_privilege('authenticated','race_private.board_sharing','last_optout','UPDATE') then
    raise exception 'The last opt-out id is exposed.';
  end if;
  raise notice 'Friends board opt-out repeat checks passed.';
end $optout$;
rollback;
