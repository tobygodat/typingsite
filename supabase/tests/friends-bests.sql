-- Friends board bests checks. Runs inside a transaction and rolls everything back.
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
-- A clear as a browser sends it: its id, when it happened and when the request was sent, by its clock.
create function pg_temp.clearing(p_id uuid, p_at timestamptz, p_sent timestamptz) returns jsonb language sql as $$
  select jsonb_build_object('id', p_id, 'at', to_jsonb(p_at)#>>'{}', 'sent', to_jsonb(p_sent)#>>'{}')
$$;
-- One best as a browser sends it.
create function pg_temp.best(p_wpm numeric, p_accuracy numeric, p_date date) returns jsonb language sql as $$
  select jsonb_build_object('wpm', p_wpm, 'accuracy', p_accuracy, 'date', p_date)
$$;
-- The key of an n-second timed test, as the app writes it.
create function pg_temp.shape(p_seconds integer) returns text language sql as $$
  select 'time:' || p_seconds || '::plain:::200:physical-keyboard:mandatory:original-en-v5:stilltype-metrics-v1'
$$;
-- A summary with bests and an empty week, naming a clear (or a clear object for a replace).
create function pg_temp.summary(p_bests jsonb, p_clear jsonb default 'null') returns jsonb language sql as $$
  select jsonb_build_object('daily', null, 'week', jsonb_build_object('start',
    (clock_timestamp() at time zone 'utc')::date - (extract(isodow from (clock_timestamp() at time zone 'utc')::date)::integer - 1),
    'seconds', 0, 'runs', 0), 'clear', p_clear, 'bests', p_bests)
$$;
-- The bests on a reply's row for the viewer themselves, and on the row a reader labels with a name.
create function pg_temp.own(p_board jsonb) returns jsonb language sql as $$
  select r->'bests' from jsonb_array_elements(p_board->'rows') r where (r->>'self')::boolean
$$;
create function pg_temp.named(p_board jsonb, p_name text) returns jsonb language sql as $$
  select r->'bests' from jsonb_array_elements(p_board->'rows') r where r->>'name' = p_name
$$;
-- The bests stored for an account, read as the owner.
create function pg_temp.stored(p_user uuid) returns jsonb language sql as $$
  select bests from race_private.summaries where user_id = p_user
$$;

do $bests$
declare
  ada uuid := gen_random_uuid();
  lin uuid := gen_random_uuid();
  ola uuid := gen_random_uuid();
  kai uuid := gen_random_uuid();
  mo uuid := gen_random_uuid();
  today date := (clock_timestamp() at time zone 'utc')::date;
  -- Condition keys as the app writes them: the test shape, then the corpus and metric version.
  k60 text := 'time:60::plain:::200:physical-keyboard:mandatory:original-en-v5:stilltype-metrics-v1';
  k30 text := 'time:30::plain:::200:physical-keyboard:mandatory:original-en-v5:stilltype-metrics-v1';
  k25 text := 'words::25:plain:::200:physical-keyboard:relaxed:original-en-v5:stilltype-metrics-v1';
  kq text := 'quote::::medium:any::physical-keyboard:mandatory:original-en-v5:stilltype-metrics-v1';
  board jsonb;
  bad jsonb;
  many jsonb := '{}';
  act text;
  msg text;
  denied boolean;
  g1 uuid := gen_random_uuid();
  g2 uuid := gen_random_uuid();
  g3 uuid := gen_random_uuid();
  g4 uuid := gen_random_uuid();
  g5 uuid := gen_random_uuid();
  g6 uuid := gen_random_uuid();
  i integer;
begin
  insert into auth.users (id,email,email_confirmed_at) values
    (ada,'bests-ada-' || ada || '@example.invalid',now()), (lin,'bests-lin-' || lin || '@example.invalid',now()),
    (ola,'bests-ola-' || ola || '@example.invalid',now()), (kai,'bests-kai-' || kai || '@example.invalid',now()),
    (mo,'bests-mo-' || mo || '@example.invalid',now());
  -- Ada and Lin, and Ada and Mo, have each other. Ada has Ola, who never added her back; Kai has Ada,
  -- whom Ada never added.
  insert into race_private.friends(owner_id, friend_id, name) values
    (ada, lin, 'Lin'), (lin, ada, 'Ada'), (ada, mo, 'Mo'), (mo, ada, 'Ada'), (ada, ola, 'Ola'), (kai, ada, 'Ada');

  -- The helpers are the board's own: no browser role may call them.
  if has_function_privilege('anon','race_private.valid_bests(jsonb)','EXECUTE')
    or has_function_privilege('authenticated','race_private.valid_bests(jsonb)','EXECUTE')
    or has_function_privilege('authenticated','race_private.sent_bests(jsonb,date)','EXECUTE')
    or has_function_privilege('authenticated','race_private.fold_bests(jsonb,jsonb)','EXECUTE')
    or has_function_privilege('authenticated','race_private.bests_since(jsonb,timestamptz)','EXECUTE')
    or has_column_privilege('authenticated','race_private.summaries','bests','SELECT')
    or has_function_privilege('anon','public.friends_board(text,jsonb)','EXECUTE')
    or not has_function_privilege('authenticated','public.friends_board(text,jsonb)','EXECUTE') then
    raise exception 'Bests storage or helpers are exposed.';
  end if;

  -- Guests (the anon role) publish nothing.
  perform set_config('request.jwt.claim.sub','',true);
  denied := false;
  begin perform pg_temp.board('share',pg_temp.summary(jsonb_build_object(k60,pg_temp.best(84,97,today))));
  exception when others then denied := true; end;
  if not denied or exists(select 1 from race_private.summaries) then raise exception 'A guest published bests.'; end if;

  -- Not sharing, an account's bests go nowhere.
  perform set_config('request.jwt.claim.sub',ada::text,true);
  board := pg_temp.board('publish',pg_temp.summary(jsonb_build_object(k60,pg_temp.best(84,97,today))));
  if board->'rows' <> '[]'::jsonb or exists(select 1 from race_private.summaries where user_id = ada) then
    raise exception 'Bests from an account that does not share were stored: %', board;
  end if;

  -- Sharing stores each shape's best as sent, written out afresh.
  board := pg_temp.board('share',pg_temp.summary(jsonb_build_object(k60,pg_temp.best(84,97,today - 2),k30,pg_temp.best(88,96,today - 1))));
  if pg_temp.own(board) is distinct from jsonb_build_object(k60,pg_temp.best(84,97,today - 2),k30,pg_temp.best(88,96,today - 1)) then
    raise exception 'Own bests were not stored: %', board;
  end if;

  -- Impossible bests are refused, however they are sent, and the stored row is left as it was.
  for i in 1..17 loop many := many || jsonb_build_object(pg_temp.shape(i), pg_temp.best(60,95,today)); end loop;
  foreach act in array array['share','publish','replace'] loop
  foreach bad in array array[
    many,
    jsonb_build_object('time 60',pg_temp.best(84,97,today)),
    jsonb_build_object(k60 || '|v2',pg_temp.best(84,97,today)),
    jsonb_build_object(repeat('x',201),pg_temp.best(84,97,today)),
    jsonb_build_object('',pg_temp.best(84,97,today)),
    jsonb_build_object('tíme:60',pg_temp.best(84,97,today)),
    jsonb_build_object(k60,pg_temp.best(401,97,today)),
    jsonb_build_object(k60,pg_temp.best(84,101,today)),
    jsonb_build_object(k60,pg_temp.best(84.5,97,today)),
    jsonb_build_object(k60,pg_temp.best(-1,97,today)),
    jsonb_build_object(k60,jsonb_build_object('wpm','84','accuracy',97,'date',today)),
    jsonb_build_object(k60,jsonb_build_object('wpm',84,'accuracy',97)),
    jsonb_build_object(k60,jsonb_build_object('wpm',84,'date',today)),
    jsonb_build_object(k60,jsonb_build_object('wpm',84,'accuracy',97,'date','yesterday')),
    jsonb_build_object(k60,jsonb_build_object('wpm',84,'accuracy',97,'date',today,'attempts',3)),
    jsonb_build_object(k60,pg_temp.best(84,97,today + 2)),
    jsonb_build_object(k60,pg_temp.best(84,97,date '2025-12-31')),
    jsonb_build_object(k60,pg_temp.best(84,97,date '0001-01-01')),
    jsonb_build_object(k60,'84 wpm'),
    jsonb_build_object(k60,jsonb_build_array(84,97)),
    jsonb_build_array(jsonb_build_object(k60,pg_temp.best(84,97,today))),
    '"84 wpm"'::jsonb
  ] loop
    denied := false;
    begin perform pg_temp.board(act,pg_temp.summary(bad,case when act = 'replace'
      then pg_temp.clearing(gen_random_uuid(),clock_timestamp(),clock_timestamp()) else 'null' end));
    exception when others then denied := true; msg := sqlerrm; end;
    if not denied or msg not in ('Invalid bests.', 'Too many bests for the board.', 'That best is outside the board limits.') then
      raise exception 'Accepted impossible bests (%): % (%)', act, bad, msg;
    end if;
  end loop;
  end loop;
  -- A date that doesn't exist is refused too.
  denied := false;
  begin perform pg_temp.board('publish',pg_temp.summary(jsonb_build_object(k60,jsonb_build_object('wpm',84,'accuracy',97,'date','2026-02-30'))));
  exception when others then denied := true; end;
  if not denied then raise exception 'Accepted a best on a date that does not exist.'; end if;
  -- The first day of 2026 is the earliest date a best can carry.
  if race_private.sent_bests(jsonb_build_object(k60,pg_temp.best(84,97,date '2026-01-01')),today)
      is distinct from jsonb_build_object(k60,pg_temp.best(84,97,date '2026-01-01')) then
    raise exception 'Refused a best dated on the first day of 2026.';
  end if;
  if pg_temp.stored(ada) is distinct from jsonb_build_object(k60,pg_temp.best(84,97,today - 2),k30,pg_temp.best(88,96,today - 1)) then
    raise exception 'Refused bests changed the row: %', pg_temp.stored(ada);
  end if;
  -- Exactly 16 shapes are fine. Folded into the two stored, that makes 18: the 16 just sent stay.
  board := pg_temp.board('publish',pg_temp.summary(many - pg_temp.shape(17)));
  if board ? 'refused' or (select count(*) from jsonb_object_keys(pg_temp.own(board))) <> 16 or pg_temp.own(board) ? k60 or pg_temp.own(board) ? k30
    or pg_temp.own(board)->pg_temp.shape(16) is distinct from pg_temp.best(60,95,today) then
    raise exception 'Sixteen shapes were refused, or not kept over older ones: %', board;
  end if;
  -- A history clear replaces the bests with what the clearing browser sends. Then a best of 0 or 400
  -- wpm, and one dated tomorrow (a clock a little ahead), are fine.
  board := pg_temp.board('replace',pg_temp.summary(jsonb_build_object(k60,pg_temp.best(84,97,today - 2),k30,pg_temp.best(88,96,today - 1)),
    pg_temp.clearing(g1,clock_timestamp() - interval '3 days',clock_timestamp())));
  if pg_temp.own(board) is distinct from jsonb_build_object(k60,pg_temp.best(84,97,today - 2),k30,pg_temp.best(88,96,today - 1)) then
    raise exception 'A clear did not replace the bests: %', board;
  end if;
  board := pg_temp.board('publish',pg_temp.summary(jsonb_build_object(k25,pg_temp.best(0,0,today),kq,pg_temp.best(400,100,today + 1)),to_jsonb(g1::text)));
  if pg_temp.own(board) is distinct from jsonb_build_object(k60,pg_temp.best(84,97,today - 2),k30,pg_temp.best(88,96,today - 1),
      k25,pg_temp.best(0,0,today),kq,pg_temp.best(400,100,today + 1)) then
    raise exception 'Edge values were not kept: %', board;
  end if;
  -- Past 16 shapes, the ones just sent stay, then the most recently set: of the four stored, the
  -- oldest (60 s) goes.
  board := pg_temp.board('publish',pg_temp.summary(many - pg_temp.shape(17) - pg_temp.shape(16) - pg_temp.shape(15) - pg_temp.shape(14),to_jsonb(g1::text)));
  if (select count(*) from jsonb_object_keys(pg_temp.own(board))) <> 16 or not pg_temp.own(board) ? pg_temp.shape(13)
    or not pg_temp.own(board) ? kq or not pg_temp.own(board) ? k25 or not pg_temp.own(board) ? k30 or pg_temp.own(board) ? k60 then
    raise exception 'Seventeen shapes were not cut to the sent ones and the newest: %', board;
  end if;

  -- Bests reach mutual friends who share, and nobody else: not a one-way friend, not someone who
  -- doesn't share, and not anyone while the reader doesn't share.
  perform set_config('request.jwt.claim.sub',lin::text,true);
  board := pg_temp.board('share',pg_temp.summary(jsonb_build_object(k60,pg_temp.best(91,98,today),kq,pg_temp.best(72,95,today - 3))));
  if pg_temp.named(board,'Ada') is distinct from pg_temp.stored(ada) then raise exception 'Lin does not see Ada''s bests: %', board; end if;
  perform set_config('request.jwt.claim.sub',kai::text,true);
  perform pg_temp.board('share',pg_temp.summary(jsonb_build_object(k60,pg_temp.best(117,99,today))));
  perform set_config('request.jwt.claim.sub',ola::text,true);
  perform pg_temp.board('share',pg_temp.summary(jsonb_build_object(k60,pg_temp.best(113,99,today))));
  perform set_config('request.jwt.claim.sub',mo::text,true);
  board := pg_temp.board('board','{}');
  if board->'rows' <> '[]'::jsonb or board::text like '%' || k60 || '%' then raise exception 'Someone who does not share saw bests: %', board; end if;
  perform set_config('request.jwt.claim.sub',ada::text,true);
  board := pg_temp.board('board','{}');
  if jsonb_array_length(board->'rows') <> 2 or pg_temp.named(board,'Lin') is distinct from jsonb_build_object(k60,pg_temp.best(91,98,today),kq,pg_temp.best(72,95,today - 3))
    or exists(select 1 from jsonb_array_elements(board->'rows') r, jsonb_each(r->'bests') b where (b.value->>'wpm')::integer in (113,117))
    or board::text like '%' || lin || '%' or board::text like '%bests-lin%' then
    raise exception 'Ada''s board shows bests it should not, or not Lin''s: %', board;
  end if;
  if exists(select 1 from jsonb_array_elements(board->'rows') r, jsonb_object_keys(r) k where k not in ('self','id','name','bests','daily','week')) then
    raise exception 'A row carries more than its fields: %', board;
  end if;

  -- Another tab or device that never saw some runs publishes a slower best, an equal one set later, and
  -- fewer shapes: on each shape the better best stays, an equal one keeps its earlier date, and the
  -- shapes it didn't send stay.
  foreach bad in array array[jsonb_build_object(k30,pg_temp.best(80,99,today)), jsonb_build_object(k30,pg_temp.best(88,96,today))] loop
    board := pg_temp.board('publish',pg_temp.summary(bad,to_jsonb(g1::text)));
    if pg_temp.own(board)->k30 is distinct from pg_temp.best(88,96,today - 1) or (select count(*) from jsonb_object_keys(pg_temp.own(board))) <> 16 then
      raise exception 'A slower or later best replaced the stored one: % gave %', bad, board;
    end if;
  end loop;
  -- Faster, or as fast and more accurate, is better.
  board := pg_temp.board('publish',pg_temp.summary(jsonb_build_object(k30,pg_temp.best(88,99,today),k25,pg_temp.best(64,90,today)),to_jsonb(g1::text)));
  if pg_temp.own(board)->k30 is distinct from pg_temp.best(88,99,today) or pg_temp.own(board)->k25 is distinct from pg_temp.best(64,90,today) then
    raise exception 'A better best was not kept: %', board;
  end if;

  -- A history clear replaces the bests with what the clearing browser counts since it: none.
  board := pg_temp.board('replace',pg_temp.summary('{}',pg_temp.clearing(g2,clock_timestamp() - interval '1 minute',clock_timestamp())));
  if pg_temp.own(board) <> '{}'::jsonb then raise exception 'A clear left bests behind: %', board; end if;
  perform set_config('request.jwt.claim.sub',lin::text,true);
  if pg_temp.named(pg_temp.board('board','{}'),'Ada') <> '{}'::jsonb then raise exception 'Lin still sees bests Ada cleared.'; end if;
  -- A device that missed the clear is refused, changing nothing, however it writes its old bests: naming
  -- the clear before, none, or another.
  perform set_config('request.jwt.claim.sub',ada::text,true);
  foreach bad in array array[to_jsonb(g1::text), 'null'::jsonb, to_jsonb(gen_random_uuid()::text)] loop
    foreach act in array array['publish','share'] loop
      board := pg_temp.board(act,pg_temp.summary(jsonb_build_object(k60,pg_temp.best(84,99,today),k30,pg_temp.best(93,94,today)),bad));
      if not coalesce((board->>'refused')::boolean, false) or pg_temp.own(board) <> '{}'::jsonb or board->'clear'->>'id' is distinct from g2::text then
        raise exception 'A % that missed the clear put bests back (%): %', act, bad, board;
      end if;
    end loop;
  end loop;
  -- Nor can it with a clear: the one before, sent again, was overtaken and changes nothing, and so does
  -- one that happened before the latest (it waited offline).
  board := pg_temp.board('replace',pg_temp.summary(jsonb_build_object(k60,pg_temp.best(84,99,today)),
    pg_temp.clearing(g1,clock_timestamp() - interval '3 days',clock_timestamp())));
  if board ? 'refused' or pg_temp.own(board) <> '{}'::jsonb or board->'clear'->>'id' is distinct from g2::text then
    raise exception 'An overtaken clear put bests back: %', board;
  end if;
  board := pg_temp.board('replace',pg_temp.summary(jsonb_build_object(k60,pg_temp.best(84,99,today)),
    pg_temp.clearing(g3,clock_timestamp() - interval '30 minutes',clock_timestamp())));
  if board ? 'refused' or pg_temp.own(board) <> '{}'::jsonb or board->'clear'->>'id' is distinct from g2::text then
    raise exception 'A clear from before the latest put bests back: %', board;
  end if;
  -- Naming the clear, the bests set since are folded in; the clear repeated after a lost reply folds its own in.
  board := pg_temp.board('publish',pg_temp.summary(jsonb_build_object(k25,pg_temp.best(66,93,today)),to_jsonb(g2::text)));
  board := pg_temp.board('replace',pg_temp.summary(jsonb_build_object(k25,pg_temp.best(64,99,today),k30,pg_temp.best(71,96,today)),
    pg_temp.clearing(g2,clock_timestamp() - interval '1 minute',clock_timestamp())));
  if board ? 'refused' or pg_temp.own(board) is distinct from jsonb_build_object(k25,pg_temp.best(66,93,today),k30,pg_temp.best(71,96,today)) then
    raise exception 'Bests since the clear were not folded in: %', board;
  end if;

  -- The undo puts back the bests it sends (the restored history's, counted from the clear before), the
  -- same way it puts back the week; repeated after a lost reply, it is answered as done.
  foreach act in array array['first','repeat'] loop
    board := pg_temp.board('replace',pg_temp.summary(jsonb_build_object(k60,pg_temp.best(84,99,today - 1),k30,pg_temp.best(93,94,today),
      k25,pg_temp.best(66,93,today)),'null') - 'clear' || jsonb_build_object('undo',g2,'before',g1));
    if board ? 'refused' or board->'clear'->>'id' is distinct from g1::text
      or pg_temp.own(board) is distinct from jsonb_build_object(k60,pg_temp.best(84,99,today - 1),k30,pg_temp.best(93,94,today),k25,pg_temp.best(66,93,today)) then
      raise exception 'The % undo did not put the bests back: %', act, board;
    end if;
  end loop;
  perform set_config('request.jwt.claim.sub',lin::text,true);
  if pg_temp.named(pg_temp.board('board','{}'),'Ada') ->> k60 is null then raise exception 'Lin does not see the bests an undo put back.'; end if;

  -- A newer clear wins: an undo of the older one is refused, and the bests stay cleared.
  perform set_config('request.jwt.claim.sub',ada::text,true);
  perform pg_temp.board('replace',pg_temp.summary('{}',pg_temp.clearing(g4,clock_timestamp(),clock_timestamp())));
  board := pg_temp.board('replace',pg_temp.summary(jsonb_build_object(k60,pg_temp.best(84,99,today - 1)),'null') - 'clear' || jsonb_build_object('undo',g2,'before',g1));
  if not coalesce((board->>'refused')::boolean, false) or pg_temp.own(board) <> '{}'::jsonb then
    raise exception 'An undo of an overtaken clear put bests back: %', board;
  end if;

  -- Only bests set since the row's clear stay, with a day's grace for the browser's clock: whether
  -- published, sent with a clear, or sent with an undo (counted from the clear it puts back).
  board := pg_temp.board('publish',pg_temp.summary(jsonb_build_object(k60,pg_temp.best(84,99,today - 3),k30,pg_temp.best(80,97,today - 1),
    k25,pg_temp.best(61,95,today)),to_jsonb(g4::text)));
  if pg_temp.own(board) is distinct from jsonb_build_object(k30,pg_temp.best(80,97,today - 1),k25,pg_temp.best(61,95,today)) then
    raise exception 'A best from before the clear was kept: %', board;
  end if;
  board := pg_temp.board('replace',pg_temp.summary(jsonb_build_object(k60,pg_temp.best(84,99,today - 9),kq,pg_temp.best(70,97,today - 5),
    k30,pg_temp.best(77,97,today)),pg_temp.clearing(g5,clock_timestamp(),clock_timestamp())));
  if board->'clear'->>'id' is distinct from g5::text or pg_temp.own(board) is distinct from jsonb_build_object(k30,pg_temp.best(77,97,today)) then
    raise exception 'A clear kept a best from before it: %', board;
  end if;
  board := pg_temp.board('replace',pg_temp.summary(jsonb_build_object(k60,pg_temp.best(84,99,today - 2),k30,pg_temp.best(80,97,today - 1)),'null')
    - 'clear' || jsonb_build_object('undo',g5,'before',g4));
  if board ? 'refused' or pg_temp.own(board) is distinct from jsonb_build_object(k30,pg_temp.best(80,97,today - 1)) then
    raise exception 'An undo kept a best from before the clear it put back: %', board;
  end if;

  -- Turning sharing off empties the bests with the rest: the marker holds none, and friends see none.
  perform pg_temp.board('unshare','{}');
  if pg_temp.stored(ada) <> '{}'::jsonb then raise exception 'The opt-out marker kept bests: %', pg_temp.stored(ada); end if;
  perform set_config('request.jwt.claim.sub',lin::text,true);
  board := pg_temp.board('board','{}');
  if jsonb_array_length(board->'rows') <> 1 or pg_temp.named(board,'Ada') is not null then raise exception 'Lin still sees Ada after she stopped sharing: %', board; end if;
  -- A device that missed the opt-out can't put bests back.
  perform set_config('request.jwt.claim.sub',ada::text,true);
  board := pg_temp.board('publish',pg_temp.summary(jsonb_build_object(k30,pg_temp.best(80,97,today)),to_jsonb(g4::text)));
  if not coalesce((board->>'refused')::boolean, false) or pg_temp.stored(ada) <> '{}'::jsonb then raise exception 'A publish after the opt-out stored bests: %', board; end if;
  -- Turning it on again shares what this browser sends now, and nothing from before.
  board := pg_temp.board('share',pg_temp.summary(jsonb_build_object(k25,pg_temp.best(68,96,today)),to_jsonb(g4::text)));
  if board ? 'refused' or pg_temp.own(board) is distinct from jsonb_build_object(k25,pg_temp.best(68,96,today)) then
    raise exception 'Sharing again did not share the bests sent: %', board;
  end if;

  -- The table itself refuses malformed bests, and bests on a marker, whoever writes them.
  foreach bad in array array[many, jsonb_build_object(k60,pg_temp.best(500,97,today)), jsonb_build_object('a b',pg_temp.best(50,97,today)),
    jsonb_build_object(k60,jsonb_build_object('wpm',50,'accuracy',97,'date',today,'note','x')), '[]'::jsonb] loop
    denied := false;
    begin update race_private.summaries set bests = bad where user_id = ada;
    exception when check_violation then denied := true; end;
    if not denied then raise exception 'The table took malformed bests: %', bad; end if;
  end loop;
  denied := false;
  begin update race_private.summaries set sharing = false, daily_date = null, daily_version = null, daily_wpm = null, daily_accuracy = null,
    daily_attempts = null, week_start = null, week_seconds = null, week_runs = null where user_id = ada;
  exception when check_violation then denied := true; end;
  if not denied then raise exception 'A marker kept bests.'; end if;

  -- Deleting an account deletes its bests with its row.
  delete from auth.users where id = ada;
  if exists(select 1 from race_private.summaries where user_id = ada) then raise exception 'A deleted account kept its bests.'; end if;
  raise notice 'Friends board bests: privacy, opt-in, limits, folding, the 16-shape cap, clears, stale devices, overtaken clears, undo, the clear boundary, opt-out and table checks passed.';
end $bests$;
rollback;
