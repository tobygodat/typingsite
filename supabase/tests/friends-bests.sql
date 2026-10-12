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
-- Turning sharing on as a browser does: sent with the sharing version its last read of the board gave.
create function pg_temp.share() returns jsonb language plpgsql as $$
begin
  return pg_temp.board('share', jsonb_build_object('version', pg_temp.board('board')->'sharingVersion'));
end $$;
-- A profile save as a browser makes it over the API, as the caller: the data, `updated_at`, and the
-- board column with these bests, stamped with the save (or, p_board_too false, as an older build, no
-- board column at all).
create function pg_temp.save(p_bests jsonb, p_board_too boolean default true) returns void language plpgsql as $$
declare
  -- At least a millisecond after the row's last save, so two saves made within one millisecond here
  -- still move the row on, as two saves from a browser always do.
  v_at timestamptz := greatest(date_trunc('milliseconds', clock_timestamp()),
    (select p.updated_at + interval '1 millisecond' from public.profiles p where p.user_id = auth.uid()));
  v_monday date := (clock_timestamp() at time zone 'utc')::date - (extract(isodow from (clock_timestamp() at time zone 'utc')::date)::integer - 1);
  v_board jsonb := jsonb_build_object('v', 2, 'at', to_char(v_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), 'days', '{}'::jsonb,
    'weeks', jsonb_build_object(v_monday::text, jsonb_build_object('seconds', 600, 'runs', 9)), 'bests', p_bests);
begin
  perform pg_temp.as_caller();
  begin
    if p_board_too then
      insert into public.profiles (user_id, data, updated_at, board) values (auth.uid(), '{"version":2}', v_at, v_board)
        on conflict (user_id) do update set data = excluded.data, updated_at = excluded.updated_at, board = excluded.board;
    else
      insert into public.profiles (user_id, data, updated_at) values (auth.uid(), '{"version":2}', v_at)
        on conflict (user_id) do update set data = excluded.data, updated_at = excluded.updated_at;
    end if;
  exception when others then
    perform set_config('role', 'none', true);
    raise;
  end;
  perform set_config('role', 'none', true);
end $$;
-- One best as a browser writes it.
create function pg_temp.best(p_wpm numeric, p_accuracy numeric, p_date text) returns jsonb language sql as $$
  select jsonb_build_object('wpm', p_wpm, 'accuracy', p_accuracy, 'date', p_date)
$$;
-- The key of an n-second timed test, as the app writes it.
create function pg_temp.shape(p_seconds integer) returns text language sql as $$
  select 'time:' || p_seconds || '::plain:::200:physical-keyboard:mandatory:original-en-v5:stilltype-metrics-v1'
$$;
-- The bests on a reply's row for the viewer themselves, and on the row a reader labels with a name.
create function pg_temp.own(p_board jsonb) returns jsonb language sql as $$
  select r->'bests' from jsonb_array_elements(p_board->'rows') r where (r->>'self')::boolean
$$;
create function pg_temp.named(p_board jsonb, p_name text) returns jsonb language sql as $$
  select r->'bests' from jsonb_array_elements(p_board->'rows') r where r->>'name' = p_name
$$;

do $bests$
declare
  ada uuid := gen_random_uuid();
  lin uuid := gen_random_uuid();
  ola uuid := gen_random_uuid();
  kai uuid := gen_random_uuid();
  k60 text := pg_temp.shape(60);
  k30 text := pg_temp.shape(30);
  -- A numbers test's key carries a plus on its text part.
  knum text := 'time:60::plain+numbers:::200:physical-keyboard:mandatory:original-en-v5:stilltype-metrics-v1';
  good jsonb := pg_temp.best(84, 97, '2026-10-08');
  mine jsonb;
  board jsonb;
  bad jsonb;
  sixteen jsonb := '{}';
  i integer;
begin
  insert into auth.users (id,email,email_confirmed_at) values
    (ada,'bests-' || ada || '@example.invalid',now()), (lin,'bests-' || lin || '@example.invalid',now()),
    (ola,'bests-' || ola || '@example.invalid',now()), (kai,'bests-' || kai || '@example.invalid',now());
  -- Ada and Lin have each other. Ada has Ola, who never added her back; Kai has Ada, whom Ada never added.
  insert into race_private.friends(owner_id, friend_id, name) values
    (ada, lin, 'Lin'), (lin, ada, 'Ada'), (ada, ola, 'Ola'), (kai, ada, 'Ada');

  -- The reader is the board's own: no browser role may call it.
  if has_function_privilege('anon','race_private.board_bests(jsonb)','EXECUTE')
    or has_function_privilege('authenticated','race_private.board_bests(jsonb)','EXECUTE') then
    raise exception 'The bests reader is exposed.';
  end if;

  -- Ada's saves carry her bests whether or not she shares. Not sharing, they go nowhere.
  mine := jsonb_build_object(k60, good, k30, pg_temp.best(91, 98, '2026-10-02'), knum, pg_temp.best(70, 95, '2026-09-30'));
  perform set_config('request.jwt.claim.sub',ada::text,true);
  perform pg_temp.save(mine);
  board := pg_temp.board('board');
  if board->'rows' <> '[]'::jsonb then raise exception 'Bests of an account that does not share were shown: %', board; end if;
  -- Sharing, her row shows each shape's best as her profile row holds it.
  board := pg_temp.share();
  if pg_temp.own(board) is distinct from mine then raise exception 'Own bests were not shown as saved: %', board; end if;
  -- Alongside the rest of the summary.
  if board->'rows'->0->'week' is distinct from jsonb_build_object('seconds', 600, 'runs', 9) then
    raise exception 'Bests hid the week: %', board;
  end if;

  -- Each shape is checked on its own: one out of place reads as no best on that shape, and the others
  -- still show. Too fast, negative, fractional, a string, too accurate, a date that is not a date, a
  -- missing part, a key the app never writes, a value that is not an object, and numbers too large to cast.
  foreach bad in array array[
    pg_temp.best(401, 97, '2026-10-08'),
    pg_temp.best(-1, 97, '2026-10-08'),
    pg_temp.best(84.5, 97, '2026-10-08'),
    jsonb_build_object('wpm', '84', 'accuracy', 97, 'date', '2026-10-08'),
    pg_temp.best(84, 101, '2026-10-08'),
    pg_temp.best(84, 97.5, '2026-10-08'),
    pg_temp.best(84, 97, '2026-10-8'),
    pg_temp.best(84, 97, 'yesterday'),
    jsonb_build_object('wpm', 84, 'accuracy', 97, 'date', 20261008),
    jsonb_build_object('wpm', 84, 'accuracy', 97),
    jsonb_build_object('accuracy', 97, 'date', '2026-10-08'),
    pg_temp.best(99999999999999999999, 97, '2026-10-08'),
    to_jsonb('84 wpm'::text),
    '[84, 97]'::jsonb,
    'null'::jsonb
  ] loop
    perform pg_temp.save(jsonb_build_object(k60, good, k30, bad));
    board := pg_temp.board('board');
    if pg_temp.own(board) is distinct from jsonb_build_object(k60, good) then
      raise exception 'A best out of place showed, or hid another: % gave %', bad, board;
    end if;
  end loop;
  foreach bad in array array[to_jsonb('time 60 s'::text), to_jsonb(repeat('t', 201)), to_jsonb('time:60:: plain'::text)] loop
    perform pg_temp.save(jsonb_build_object(k60, good, bad#>>'{}', good));
    if pg_temp.own(pg_temp.board('board')) is distinct from jsonb_build_object(k60, good) then
      raise exception 'A best under a key the app never writes showed: %', bad;
    end if;
  end loop;
  -- Only the three parts are shown, whatever else an entry holds.
  perform pg_temp.save(jsonb_build_object(k60, good || '{"note":"fastest ever"}'::jsonb));
  if pg_temp.own(pg_temp.board('board')) is distinct from jsonb_build_object(k60, good) then raise exception 'A best showed more than its parts.'; end if;
  -- The edges are fine: 0 and 400 wpm, 0 and 100% accuracy.
  perform pg_temp.save(jsonb_build_object(k60, pg_temp.best(400, 100, '2026-10-08'), k30, pg_temp.best(0, 0, '2026-10-08')));
  if pg_temp.own(pg_temp.board('board')) is distinct from jsonb_build_object(k60, pg_temp.best(400, 100, '2026-10-08'), k30, pg_temp.best(0, 0, '2026-10-08')) then
    raise exception 'Edge values were not shown.';
  end if;

  -- Exactly 16 shapes show; more than 16 (a column no browser writes) show none. Bests that are not an
  -- object show none either. None of it raises.
  for i in 1..16 loop sixteen := sixteen || jsonb_build_object(pg_temp.shape(i), pg_temp.best(60 + i, 95, '2026-10-01')); end loop;
  perform pg_temp.save(sixteen);
  if pg_temp.own(pg_temp.board('board')) is distinct from sixteen then raise exception 'Sixteen shapes did not all show.'; end if;
  foreach bad in array array[sixteen || jsonb_build_object(k60, good), '[]'::jsonb, '"fast"'::jsonb, '7'::jsonb, 'null'::jsonb, '{}'::jsonb] loop
    perform pg_temp.save(bad);
    if pg_temp.own(pg_temp.board('board')) <> '{}'::jsonb then raise exception 'Malformed bests showed: %', left(bad::text, 60); end if;
  end loop;

  -- A save by a build that doesn't write the column moves the row on: its old bests no longer describe
  -- it, so none show.
  perform pg_temp.save(mine);
  perform pg_temp.save(null, false);
  if pg_temp.own(pg_temp.board('board')) is not null then raise exception 'Bests showed for a row they no longer describe.'; end if;
  perform pg_temp.save(mine);

  -- Bests reach mutual friends who share, and nobody else: not a one-way friend, not someone who doesn't
  -- share, and not anyone while the reader doesn't share.
  perform set_config('request.jwt.claim.sub',lin::text,true);
  perform pg_temp.save(jsonb_build_object(k60, pg_temp.best(78, 96, '2026-10-06')));
  board := pg_temp.share();
  if pg_temp.named(board,'Ada') is distinct from mine then raise exception 'Lin does not see Ada''s bests: %', board; end if;
  perform set_config('request.jwt.claim.sub',ola::text,true);
  perform pg_temp.save(jsonb_build_object(k60, pg_temp.best(105, 99, '2026-10-06')));
  perform pg_temp.share();
  perform set_config('request.jwt.claim.sub',kai::text,true);
  perform pg_temp.save(jsonb_build_object(k60, pg_temp.best(99, 97, '2026-10-06')));
  board := pg_temp.board('board');
  if board->'rows' <> '[]'::jsonb or board::text like '%' || k60 || '%' then raise exception 'Someone who does not share saw bests: %', board; end if;
  perform pg_temp.share();
  perform set_config('request.jwt.claim.sub',ada::text,true);
  board := pg_temp.board('board');
  if jsonb_array_length(board->'rows') <> 2 or pg_temp.named(board,'Lin') is distinct from jsonb_build_object(k60, pg_temp.best(78, 96, '2026-10-06'))
    or board::text like '%105%' or board::text like '%"wpm": 99%' then
    raise exception 'Ada''s board shows bests it should not, or not Lin''s: %', board;
  end if;

  -- A forged bests column of Ada's reads as no bests on Lin's board, and Lin's board still works.
  perform pg_temp.save(jsonb_build_object(k60, jsonb_build_object('wpm', '1e400', 'accuracy', '[]', 'date', '2026-99-99'),
    k30, jsonb_build_object('wpm', 99999999999999999999999999, 'accuracy', 97, 'date', '2026-10-08')));
  perform set_config('request.jwt.claim.sub',lin::text,true);
  board := pg_temp.board('board');
  if pg_temp.named(board,'Ada') <> '{}'::jsonb or pg_temp.own(board) is distinct from jsonb_build_object(k60, pg_temp.best(78, 96, '2026-10-06')) then
    raise exception 'A forged bests column broke a friend''s board: %', board;
  end if;

  -- A history clear is a save of an empty history: its summary has no bests, and the board shows none.
  perform set_config('request.jwt.claim.sub',ada::text,true);
  perform pg_temp.save('{}'::jsonb);
  perform set_config('request.jwt.claim.sub',lin::text,true);
  if pg_temp.named(pg_temp.board('board'),'Ada') <> '{}'::jsonb then raise exception 'Lin still sees bests Ada cleared.'; end if;
  -- Its undo is a save of the history put back, and its bests show again.
  perform set_config('request.jwt.claim.sub',ada::text,true);
  perform pg_temp.save(mine);
  perform set_config('request.jwt.claim.sub',lin::text,true);
  if pg_temp.named(pg_temp.board('board'),'Ada') is distinct from mine then raise exception 'Lin does not see the bests an undo put back.'; end if;

  -- Turning sharing off takes Ada's bests off Lin's board at once.
  perform set_config('request.jwt.claim.sub',ada::text,true);
  perform pg_temp.board('unshare');
  perform set_config('request.jwt.claim.sub',lin::text,true);
  board := pg_temp.board('board');
  if jsonb_array_length(board->'rows') <> 1 or board::text like '%2026-10-02%' then raise exception 'Lin still sees Ada''s bests after she stopped sharing: %', board; end if;
  raise notice 'Friends board bests: privacy, per-shape limits, malformed and forged columns, binding to the row, clear and undo checks passed.';
end $bests$;
rollback;
