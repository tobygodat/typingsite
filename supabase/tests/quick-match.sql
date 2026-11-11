-- Quick match, the race rating and the trace check (20261110120000_quick_match.sql). Runs inside a
-- transaction and rolls everything back.
begin;
create function pg_temp.as_user(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claim.sub', coalesce(p_user::text, ''), true)
$$;
-- A run on a room's passage: its first p_count letters, a key every p_step ms after a first key at 500 ms,
-- ending on the 30-second clock.
create function pg_temp.trace_of(p_text text, p_count integer, p_step integer) returns jsonb language sql as $$
  select jsonb_build_object('v', 1, 'k', left(p_text, p_count),
    't', (select jsonb_agg(case when n = 1 then 500 else p_step end order by n) from generate_series(1, p_count) n), 'e', 30000)
$$;
-- Both seats ask about the room (arriving), its start passes, and each finishes with its run.
create function pg_temp.race(p_room uuid, p_one uuid, p_two uuid, p_trace_one jsonb, p_trace_two jsonb) returns jsonb language plpgsql as $$
declare
  v_passage text := (select passage from race_private.rooms where id = p_room);
  v_snap jsonb;
begin
  perform pg_temp.as_user(p_one);
  perform public.race_action('get', p_room, '{}', null);
  perform pg_temp.as_user(p_two);
  perform public.race_action('get', p_room, '{}', null);
  update race_private.rooms set start_at = clock_timestamp() - interval '31 seconds' where id = p_room;
  perform pg_temp.as_user(p_one);
  perform public.race_action('progress', p_room, jsonb_build_object('typed', left(v_passage, char_length(p_trace_one->>'k')),
    'keystrokes', char_length(p_trace_one->>'k'), 'errors', 0, 'finished', true, 'sequence', 1, 'trace', p_trace_one), null);
  perform pg_temp.as_user(p_two);
  v_snap := public.race_action('progress', p_room, jsonb_build_object('typed', left(v_passage, char_length(p_trace_two->>'k')),
    'keystrokes', char_length(p_trace_two->>'k'), 'errors', 0, 'finished', true, 'sequence', 1, 'trace', p_trace_two), null);
  return v_snap;
end $$;
-- One seat's part in a started race, by kind: fast and slow finish with passing runs (98 and 80 wpm), late sends
-- progress with no trace after the clock and then its fast finish with the trace (a slow link), pasted finishes
-- with a run whose keys all came at once, bare finishes with no trace (as after a reload), absent never finishes
-- (the page closed), leaves presses Leave race before finishing, and done-leaves finishes fast, then leaves. A
-- request a closed race refuses is the race refusing it, so it is let go.
create function pg_temp.seat(p_room uuid, p_user uuid, p_kind text) returns void language plpgsql as $$
declare
  v_passage text := (select passage from race_private.rooms where id = p_room);
  v_count integer := case p_kind when 'slow' then 200 when 'bare' then 200 when 'pasted' then 300 else 245 end;
  v_trace jsonb := case p_kind when 'bare' then null when 'pasted' then pg_temp.trace_of(v_passage, 300, 0)
    when 'slow' then pg_temp.trace_of(v_passage, 200, 148) else pg_temp.trace_of(v_passage, 245, 120) end;
begin
  perform pg_temp.as_user(p_user);
  if p_kind = 'absent' then return; end if;
  if p_kind = 'late' then
    perform public.race_action('progress', p_room, jsonb_build_object('typed', left(v_passage, 240), 'keystrokes', 240,
      'errors', 0, 'finished', false, 'sequence', 1), null);
  end if;
  if p_kind <> 'leaves' then
    begin
      perform public.race_action('progress', p_room, jsonb_build_object('typed', left(v_passage, v_count), 'keystrokes', v_count,
        'errors', 0, 'finished', true, 'sequence', 2, 'trace', v_trace), null);
    exception when others then null;
    end;
  end if;
  if p_kind in ('leaves', 'done-leaves') then perform public.race_action('leave', p_room, '{}', null); end if;
end $$;
-- A settled room as the settlement table writes it: rated or not, then each seat's outcome, reason and change.
create function pg_temp.settled(p_room uuid) returns text language sql as $$
  select case when bool_and(rated) then 'rated' when not bool_or(rated) then 'unrated' else 'mixed' end || ': '
    || string_agg(format('%s %s %s', coalesce(rr.outcome, 'none'), coalesce(rr.reason, '-'), case when rr.delta > 0 then '+' else '' end || rr.delta), ', ' order by p.slot)
  from race_private.rated_results rr join race_private.players p on p.room_id = rr.room_id and p.user_id = rr.user_id
  where rr.room_id = p_room
$$;
-- Two players who pair, the first waiting and the second asking: the room's id.
create function pg_temp.pair(p_one uuid, p_two uuid) returns uuid language plpgsql as $$
declare v_reply jsonb;
begin
  perform pg_temp.as_user(p_one);
  if public.quick_match('queue', '{"displayName":"One"}')->>'state' <> 'waiting' then raise exception 'The first player did not wait.'; end if;
  perform pg_temp.as_user(p_two);
  v_reply := public.quick_match('queue', '{"displayName":"Two"}');
  if v_reply->>'state' <> 'paired' then raise exception 'Two waiting players did not pair: %', v_reply; end if;
  return (v_reply->>'roomId')::uuid;
end $$;

do $quick$
declare
  ada uuid := gen_random_uuid();
  lin uuid := gen_random_uuid();
  kai uuid := gen_random_uuid();
  ola uuid := gen_random_uuid();
  sam uuid := gen_random_uuid();
  tom uuid := gen_random_uuid();
  uma uuid := gen_random_uuid();
  vic uuid := gen_random_uuid();
  bystander uuid := gen_random_uuid();
  one uuid;
  two uuid;
  row record;
  got text;
  ratings_before text;
  table_rooms uuid[] := '{}';
  reply jsonb;
  snap jsonb;
  room uuid;
  passage text;
  denied boolean;
  verdicts text;
  denied_count integer;
  shortest integer;
  longest integer;
  pia uuid := gen_random_uuid();
  quinn uuid := gen_random_uuid();
  rio uuid := gen_random_uuid();
  main uuid := gen_random_uuid();
  alt uuid := gen_random_uuid();
  ratings_after text;
  xan uuid := gen_random_uuid();
  yul uuid := gen_random_uuid();
  pair_rooms uuid[] := '{}';
begin
  insert into auth.users (id, email, email_confirmed_at)
    select id, 'quick-test-' || id || '@example.invalid', now() from unnest(array[ada, lin, kai, ola, sam, tom, uma, vic, bystander, pia, quinn, rio, main, alt, xan, yul]) id;

  -- Browsers reach the queue only through the RPC, signed in; the tables and helpers are private.
  if has_table_privilege('authenticated', 'race_private.match_queue', 'SELECT')
    or has_table_privilege('authenticated', 'race_private.ratings', 'SELECT')
    or has_table_privilege('authenticated', 'race_private.rated_results', 'SELECT')
    or has_table_privilege('anon', 'race_private.ratings', 'SELECT')
    or not (select bool_and(relrowsecurity) from pg_class where oid in
      ('race_private.match_queue'::regclass, 'race_private.ratings'::regclass, 'race_private.rated_results'::regclass))
    or has_function_privilege('anon', 'public.quick_match(text,jsonb)', 'EXECUTE')
    or not has_function_privilege('authenticated', 'public.quick_match(text,jsonb)', 'EXECUTE')
    or has_function_privilege('authenticated', 'race_private.rate(uuid,integer)', 'EXECUTE')
    or has_function_privilege('authenticated', 'race_private.trace_check(text,jsonb,integer,integer)', 'EXECUTE')
    or has_function_privilege('authenticated', 'race_private.quick_passage()', 'EXECUTE') then
    raise exception 'Quick match privileges are too broad.';
  end if;
  perform pg_temp.as_user(null);
  denied := false;
  begin perform race_private.quick_action('queue', '{"displayName":"Guest"}'); exception when others then denied := true; end;
  if not denied then raise exception 'A guest joined the queue.'; end if;

  -- A new account starts at 1500 with no rated races.
  perform pg_temp.as_user(ada);
  if public.quick_match('rating', '{}') <> '{"rating":1500,"races":0}'::jsonb then raise exception 'A new rating is not 1500 with no races.'; end if;
  denied := false;
  begin perform public.quick_match('queue', '{"displayName":""}'); exception when others then denied := true; end;
  if not denied then raise exception 'An empty race name joined the queue.'; end if;

  -- Alone, Ada waits however often she asks, and holds one place: never paired with herself.
  perform public.quick_match('queue', '{"displayName":"Ada"}');
  reply := public.quick_match('queue', '{"displayName":"Ada"}');
  if reply->>'state' <> 'waiting' or (select count(*) from race_private.match_queue where user_id = ada) <> 1 then
    raise exception 'A lone player did not wait in one place: %', reply;
  end if;
  denied := false;
  begin insert into race_private.match_queue (user_id, name, rating) values (ada, 'Ada', 1500); exception when unique_violation then denied := true; end;
  if not denied then raise exception 'The queue held a second place for one account.'; end if;

  -- Lin asks and is paired with Ada at once: one quick room on the standard setup, counting down.
  perform pg_temp.as_user(lin);
  reply := public.quick_match('queue', '{"displayName":"Lin"}');
  room := (reply->>'roomId')::uuid;
  if reply->>'state' <> 'paired' or reply->'room'->>'status' <> 'countdown' or not (reply->'room'->>'quick')::boolean
    or (reply->'room'->>'selfSlot')::integer <> 2 or reply->'room'->'conditions' <> race_private.quick_conditions()
    or (reply->'room'->>'duration')::integer <> 30 then
    raise exception 'Pairing did not open a standard quick room: %', reply;
  end if;
  if exists(select 1 from race_private.match_queue where user_id in (ada, lin)) then raise exception 'A paired player stayed in the queue.'; end if;
  if (select array_agg(user_id order by slot) from race_private.players where room_id = room) <> array[ada, lin] then
    raise exception 'The room did not seat the waiting player first and the asker second.';
  end if;
  if reply::text like '%quick-test-%' or reply::text like '%' || ada::text || '%' then raise exception 'The pairing reply showed an email or account id.'; end if;
  -- The service drew the passage: the 200 words, none equal to either of the two before, at most 1000 letters.
  passage := (select r.passage from race_private.rooms r where r.id = room);
  if length(passage) > 1000 or length(passage) < 900 or exists(
      select 1 from (select w, lag(w) over (order by n) a, lag(w, 2) over (order by n) b
        from unnest(string_to_array(passage, ' ')) with ordinality as words(w, n)) s where w in (a, b)) then
    raise exception 'The quick passage is not a standard 30-second text.';
  end if;
  -- And every one of 2000 draws: single spaces between words and none at either end, so the text typed as read
  -- never sticks; lowercase letters only, as the standard setup has no punctuation or numbers; and 991 to 1000
  -- characters, past the 875 a run at the 350 wpm cap types in 30 seconds, so no checked run reaches the end.
  select count(*) filter (where t ~ '(^ | $|  )' or t ~ '[^a-z ]' or length(t) not between 991 and 1000),
    min(length(t)), max(length(t)) into denied_count, shortest, longest
    from (select race_private.quick_passage() t from generate_series(1, 2000)) draws;
  if denied_count <> 0 or exists(select 1 from (select race_private.quick_passage() t from generate_series(1, 200)) d,
      unnest(string_to_array(d.t, ' ')) w where w = '') then
    raise exception '% of 2000 quick passages are malformed (lengths % to %).', denied_count, shortest, longest;
  end if;
  raise notice 'quick passages: 2000 drawn, lengths % to %', shortest, longest;
  -- Ada's next ask finds the same room, as seat 1, and leaves her out of the queue.
  perform pg_temp.as_user(ada);
  reply := public.quick_match('queue', '{"displayName":"Ada"}');
  if reply->>'state' <> 'paired' or (reply->>'roomId')::uuid <> room or (reply->'room'->>'selfSlot')::integer <> 1 then
    raise exception 'The waiting player was not told of the pairing: %', reply;
  end if;

  -- Kai asks next: nobody paired is paired again, so Kai waits.
  perform pg_temp.as_user(kai);
  if public.quick_match('queue', '{"displayName":"Kai"}')->>'state' <> 'waiting' then raise exception 'A third player was paired with a paired player.'; end if;
  if (select count(*) from race_private.players p join race_private.rooms r on r.id = p.room_id
      where r.quick and r.status in ('countdown', 'racing') and p.user_id in (ada, lin)) <> 2 then
    raise exception 'A player is seated in two quick matches.';
  end if;

  -- The gap widens with waiting: Ola at 1900 doesn't pair with Kai at 1500 at once, but does once Kai has
  -- waited 31 seconds (100 + 10 × 31 = 410).
  insert into race_private.ratings (user_id, rating, rated) values (ola, 1900, 12);
  perform pg_temp.as_user(ola);
  if public.quick_match('queue', '{"displayName":"Ola"}')->>'state' <> 'waiting' then raise exception 'Ratings 400 apart paired at once.'; end if;
  update race_private.match_queue set joined_at = clock_timestamp() - interval '31 seconds' where user_id = kai;
  delete from race_private.match_queue where user_id = ola;
  if public.quick_match('queue', '{"displayName":"Ola"}')->>'state' <> 'paired' then raise exception 'A long wait did not widen the gap.'; end if;

  -- A player not heard from for ten seconds leaves the queue and is never paired.
  perform pg_temp.as_user(sam);
  perform public.quick_match('queue', '{"displayName":"Sam"}');
  update race_private.match_queue set seen_at = clock_timestamp() - interval '11 seconds' where user_id = sam;
  perform pg_temp.as_user(tom);
  reply := public.quick_match('queue', '{"displayName":"Tom"}');
  if reply->>'state' <> 'waiting' or exists(select 1 from race_private.match_queue where user_id = sam) then
    raise exception 'A stale player was paired or kept: % %', reply, (select array_agg(name) from race_private.match_queue);
  end if;
  -- Uma pairs with Tom; Tom stops looking before his browser ever asks about the room, so it is called off.
  perform pg_temp.as_user(uma);
  room := (public.quick_match('queue', '{"displayName":"Uma"}')->>'roomId')::uuid;
  perform pg_temp.as_user(tom);
  reply := public.quick_match('unqueue', '{}');
  if reply <> '{"state":"idle"}'::jsonb or (select status from race_private.rooms where id = room) <> 'cancelled' then
    raise exception 'Leaving the queue did not call off a room the seat never came to.';
  end if;
  if exists(select 1 from race_private.rated_results where room_id = room) then raise exception 'A room called off before its start was rated.'; end if;
  -- Leaving again changes nothing.
  if public.quick_match('unqueue', '{}') <> '{"state":"idle"}'::jsonb then raise exception 'A second leave failed.'; end if;

  -- A seat that never arrives: Vic pairs with Uma, only Uma asks about the room, and the start calls it off.
  room := pg_temp.pair(uma, vic);
  perform pg_temp.as_user(uma);
  perform public.race_action('get', room, '{}', null);
  update race_private.rooms set start_at = clock_timestamp() - interval '1 second' where id = room;
  if public.race_action('get', room, '{}', null)->>'status' <> 'cancelled' then raise exception 'A race started with a seat that never came.'; end if;

  -- The Ada and Lin race: both honest, Ada at 98 wpm and Lin at 80. Rated, decided by the traces: equal
  -- ratings at K 40 move by 20 each way.
  room := (select p.room_id from race_private.players p join race_private.rooms r on r.id = p.room_id where r.quick and p.user_id = ada and r.status = 'countdown');
  passage := (select r.passage from race_private.rooms r where r.id = room);
  snap := pg_temp.race(room, ada, lin, pg_temp.trace_of(passage, 245, 120), pg_temp.trace_of(passage, 200, 148));
  if snap->>'status' <> 'finished' or snap->'rating' <> jsonb_build_object('rated', true, 'reason', null, 'outcome', 'lost',
      'before', 1500, 'after', 1480, 'delta', -20, 'races', 1) then
    raise exception 'The loser''s rated result is wrong: %', snap->'rating';
  end if;
  perform pg_temp.as_user(ada);
  snap := public.race_action('get', room, '{}', null);
  if snap->'rating'->>'delta' <> '20' or public.quick_match('rating', '{}') - 'last' <> '{"rating":1520,"races":1}'::jsonb then
    raise exception 'The winner''s rating did not rise by 20.';
  end if;
  if public.race_action('get', room, '{}', null)->'tally' <> '[1, 0]'::jsonb then raise exception 'A quick match did not count in the head-to-head tally.'; end if;
  -- Settling and rating the same room again changes nothing.
  perform race_private.rate(room, null);
  perform race_private.settle(room);
  if (select array_agg(rating order by rating) from race_private.ratings where user_id in (ada, lin)) <> array[1480, 1520]
    or (select sum(rated) from race_private.ratings where user_id in (ada, lin)) <> 2
    or (select count(*) from race_private.rated_results where room_id = room) <> 2 then
    raise exception 'Replaying a result moved the rating again.';
  end if;

  -- Rematch keeps racing them, unrated: the next room is not a quick match.
  perform public.race_action('rematch', room, jsonb_build_object('passage', passage, 'conditions', race_private.quick_conditions()), null);
  perform pg_temp.as_user(lin);
  snap := public.race_action('rematch', room, jsonb_build_object('passage', passage, 'conditions', race_private.quick_conditions()), null);
  if snap->'room'->>'rematchId' is null or (select quick from race_private.rooms where rematch_of = room) then
    raise exception 'A rematch of a quick match was missing or rated.';
  end if;
  update race_private.rooms set status = 'finished' where rematch_of = room;

  -- A run whose keys came all at once can't be checked, so it loses to a run that can, rated, though it typed
  -- further: Lin (1480) loses to Ada (1520), each at K 40, 18 each way (40 × (1 − 0.557)).
  room := pg_temp.pair(ada, lin);
  passage := (select r.passage from race_private.rooms r where r.id = room);
  snap := pg_temp.race(room, ada, lin, pg_temp.trace_of(passage, 245, 120), pg_temp.trace_of(passage, 300, 0));
  if (snap->'rating') - 'races' <> jsonb_build_object('rated', true, 'reason', 'intervals', 'outcome', 'lost', 'before', 1480, 'after', 1462, 'delta', -18) then
    raise exception 'A pasted run was not a rated loss: %', snap->'rating';
  end if;
  perform pg_temp.as_user(ada);
  snap := public.race_action('get', room, '{}', null);
  if snap->'rating'->>'reason' <> 'opponent-unchecked' or snap->'rating'->>'outcome' <> 'won'
    or public.quick_match('rating', '{}') - 'last' <> '{"rating":1538,"races":2}'::jsonb then
    raise exception 'The racer whose run passed did not win against a pasted run: %', snap->'rating';
  end if;

  -- Both connections drop: both seats are finished after the grace period, and with no run from either, unrated.
  room := pg_temp.pair(ada, lin);
  perform pg_temp.as_user(ada);
  perform public.race_action('get', room, '{}', null);
  perform pg_temp.as_user(lin);
  perform public.race_action('get', room, '{}', null);
  update race_private.rooms set start_at = clock_timestamp() - interval '41 seconds' where id = room;
  if (public.race_action('get', room, '{}', null)->'rating') - 'races' <> jsonb_build_object('rated', false, 'reason', 'unfinished',
      'outcome', null, 'before', 1462, 'after', 1462, 'delta', 0) then
    raise exception 'A race with no run from either seat was rated: %', public.race_action('get', room, '{}', null)->'rating';
  end if;

  -- Leaving during the countdown calls the race off, unrated; leaving after the start forfeits: a rated loss for
  -- the leaver at once, while the race goes on for the other racer, who wins rated with their own checked run.
  room := pg_temp.pair(ada, lin);
  perform pg_temp.as_user(ada);
  perform public.race_action('get', room, '{}', null);
  perform public.race_action('leave', room, '{}', null);
  if exists(select 1 from race_private.rated_results where room_id = room) then raise exception 'Leaving before the start was rated.'; end if;
  room := pg_temp.pair(ada, lin);
  perform public.race_action('get', room, '{}', null);
  perform pg_temp.as_user(ada);
  perform public.race_action('get', room, '{}', null);
  update race_private.rooms set start_at = clock_timestamp() - interval '2 seconds' where id = room;
  perform public.race_action('leave', room, '{}', null);
  if (select row(outcome, rated, reason) from race_private.rated_results where room_id = room and user_id = ada)
    is distinct from row('lost'::text, true, 'forfeit'::text) then raise exception 'A forfeit was not a rated loss for the leaver at once.'; end if;
  -- Ada asking to race again meanwhile waits: she is still seated in the race she left until it settles.
  if public.quick_match('queue', '{"displayName":"Ada"}')->>'state' <> 'waiting' or exists(select 1 from race_private.match_queue where user_id = ada) then
    raise exception 'A racer who left was queued while the race she left was still on.';
  end if;
  perform pg_temp.as_user(lin);
  snap := public.race_action('get', room, '{}', null);
  if snap->>'status' <> 'racing' or snap->'rating' <> 'null'::jsonb or not (snap->'players'->0->>'left')::boolean then
    raise exception 'A forfeit ended the race for the racer who stayed: %', snap;
  end if;
  passage := (select r.passage from race_private.rooms r where r.id = room);
  update race_private.rooms set start_at = clock_timestamp() - interval '31 seconds' where id = room;
  snap := public.race_action('progress', room, jsonb_build_object('typed', left(passage, 200), 'keystrokes', 200, 'errors', 0,
    'finished', true, 'sequence', 1, 'trace', pg_temp.trace_of(passage, 200, 148)), null);
  if snap->>'status' <> 'finished' or snap->'rating'->>'outcome' <> 'won' or snap->'rating'->>'reason' <> 'forfeit'
    or snap->'rating'->>'rated' <> 'true' or (snap->'rating'->>'delta')::integer <= 0 then
    raise exception 'The racer who stayed and finished a checked run did not win, rated: %', snap->'rating';
  end if;

  -- K shrinks after ten rated races: Ola (12 races, 1900) beating Kai (none, 1500) moves Ola by 20 × E.
  room := (select p.room_id from race_private.players p join race_private.rooms r on r.id = p.room_id where r.quick and p.user_id = ola and r.status = 'countdown');
  passage := (select r.passage from race_private.rooms r where r.id = room);
  snap := pg_temp.race(room, kai, ola, pg_temp.trace_of(passage, 200, 148), pg_temp.trace_of(passage, 245, 120));
  -- Ola expected 1 / (1 + 10^(-400/400)) = 0.909: +2 at K 20 (20 × 0.091 = 1.8); Kai −4 at K 40 (40 × 0.091 = 3.6).
  if (select rating from race_private.ratings where user_id = ola) <> 1902 or (select rating from race_private.ratings where user_id = kai) <> 1496 then
    raise exception 'K did not follow the rated race count: %', (select array_agg(rating) from race_private.ratings where user_id in (ola, kai));
  end if;

  -- The settlement table, shared with tests/quick-match.test.js, which plays every row through the e2e fake.
  -- Fresh accounts race each row: both seats arrive, the start passes, each seat plays its kind (pg_temp.seat),
  -- and then only someone else's request, after the clock and its grace, settles what is left.
  for row in select * from (values
    -- settlement table begins
    ('fast', 'slow', 'rated: won - +20, lost - -20'),
    ('slow', 'fast', 'rated: lost - -20, won - +20'),
    ('fast', 'absent', 'rated: won opponent-absent +20, lost unfinished -20'),
    ('late', 'slow', 'rated: won - +20, lost - -20'),
    ('slow', 'late', 'rated: lost - -20, won - +20'),
    ('late', 'pasted', 'rated: won opponent-unchecked +20, lost intervals -20'),
    ('absent', 'slow', 'rated: lost unfinished -20, won opponent-absent +20'),
    ('slow', 'pasted', 'rated: won opponent-unchecked +20, lost intervals -20'),
    ('bare', 'fast', 'rated: lost no-trace -20, won opponent-unchecked +20'),
    ('pasted', 'absent', 'unrated: none intervals 0, none unfinished 0'),
    ('pasted', 'bare', 'unrated: none intervals 0, none no-trace 0'),
    ('absent', 'absent', 'unrated: none unfinished 0, none unfinished 0'),
    ('leaves', 'fast', 'rated: lost forfeit -20, won forfeit +20'),
    ('slow', 'leaves', 'rated: won forfeit +20, lost forfeit -20'),
    ('pasted', 'leaves', 'mixed: none intervals 0, lost forfeit -20'),
    ('leaves', 'absent', 'mixed: lost forfeit -20, none unfinished 0'),
    ('absent', 'leaves', 'mixed: none unfinished 0, lost forfeit -20'),
    ('leaves', 'leaves', 'mixed: lost forfeit -20, none unfinished 0'),
    ('leaves', 'bare', 'mixed: lost forfeit -20, none no-trace 0'),
    ('done-leaves', 'absent', 'rated: won opponent-absent +20, lost unfinished -20'),
    ('slow', 'done-leaves', 'rated: lost - -20, won - +20')
    -- settlement table ends
  ) as t(one_kind, two_kind, expected) loop
    one := gen_random_uuid();
    two := gen_random_uuid();
    insert into auth.users (id, email, email_confirmed_at) values (one, 'quick-row-' || one || '@example.invalid', now()),
      (two, 'quick-row-' || two || '@example.invalid', now());
    room := pg_temp.pair(one, two);
    table_rooms := table_rooms || room;
    perform pg_temp.as_user(one);
    perform public.race_action('get', room, '{}', null);
    perform pg_temp.as_user(two);
    perform public.race_action('get', room, '{}', null);
    update race_private.rooms set start_at = clock_timestamp() - interval '31 seconds' where id = room;
    perform pg_temp.seat(room, one, row.one_kind);
    perform pg_temp.seat(room, two, row.two_kind);
    -- Inside the grace period nothing waiting on an absent seat is settled, even by a stranger's request: only a
    -- forfeit's own loss is in.
    perform pg_temp.as_user(bystander);
    perform public.quick_match('rating', '{}');
    if row.one_kind = 'absent' or row.two_kind = 'absent' then
      if exists(select 1 from race_private.rated_results where room_id = room and reason is distinct from 'forfeit') then
        raise exception 'A race was settled before its grace period ended (% %).', row.one_kind, row.two_kind;
      end if;
    end if;
    update race_private.rooms set start_at = clock_timestamp() - interval '41 seconds' where id = room and status in ('countdown', 'racing');
    perform public.quick_match('rating', '{}');
    got := pg_temp.settled(room);
    if got is distinct from row.expected then raise exception 'Settling % against % gave "%", not "%".', row.one_kind, row.two_kind, got, row.expected; end if;
    -- The one record of who won: the tally counts the seat whose rated result won, and nothing when none did; each
    -- seat's card reads its own result, and a run that couldn't be checked is never the winner.
    perform pg_temp.as_user(one);
    snap := public.race_action('get', room, '{}', null);
    if snap->'tally' is distinct from (select case max(p.slot) filter (where rr.outcome = 'won') when 1 then '[1, 0]'::jsonb when 2 then '[0, 1]'::jsonb
          else '[0, 0]'::jsonb end
        from race_private.rated_results rr join race_private.players p on p.room_id = rr.room_id and p.user_id = rr.user_id where rr.room_id = room)
      or exists(select 1 from jsonb_array_elements(snap->'players') pl where pl->>'outcome' = 'won' and not (pl->>'checked')::boolean)
      or (select array_agg(coalesce(pl->>'outcome', 'none') order by (pl->>'slot')::integer) from jsonb_array_elements(snap->'players') pl)
        <> (select array_agg(coalesce(outcome, 'none') order by p.slot) from race_private.rated_results rr
          join race_private.players p on p.room_id = rr.room_id and p.user_id = rr.user_id where rr.room_id = room) then
      raise exception 'Settling % against % named another winner: tally %, cards %', row.one_kind, row.two_kind, snap->'tally', snap->'players';
    end if;
    perform pg_temp.as_user(bystander);
  end loop;
  -- Every race both seats were rated in moved the pair by Elo: fresh accounts at K 40 and a sure result move 20 each
  -- way, a sum of zero. A race only one seat was rated in is a forfeit's loss alone: it lowers the leaver and moves
  -- nobody else.
  if exists(select 1 from race_private.rated_results where room_id = any(table_rooms) group by room_id having bool_and(rated) and sum(delta) <> 0)
    or exists(select 1 from race_private.rated_results where room_id = any(table_rooms) group by room_id
      having count(*) filter (where rated) = 1 and not bool_and(not rated or (reason = 'forfeit' and outcome = 'lost' and delta < 0))) then
    raise exception 'A rated race did not follow Elo: both seats summing to zero, or a forfeit''s loss alone.';
  end if;
  -- A rating only rises with its own checked run.
  if exists(select 1 from race_private.rated_results rr join race_private.players p on p.room_id = rr.room_id and p.user_id = rr.user_id
      where rr.delta > 0 and p.trace_verdict is distinct from 'ok') then
    raise exception 'A rating rose without its own checked run.';
  end if;
  -- And no started race ended without a rated result unless neither seat had a run that passed.
  if exists(select 1 from race_private.rated_results rr join race_private.players p on p.room_id = rr.room_id and p.user_id = rr.user_id
      where not rr.rated and p.trace_verdict = 'ok') then
    raise exception 'A race with a passing run was left unrated.';
  end if;

  -- Abandoning: Kai closes the page mid-race and never asks again; Sam finishes with a passing run and closes his
  -- too. Nobody else asks about the room. Kai's next request, from a new page, settles it first: his rating
  -- read shows the rated loss and why, and the queue pairs on the lowered rating.
  insert into race_private.ratings (user_id) values (sam) on conflict do nothing;
  room := pg_temp.pair(sam, kai);
  passage := (select r.passage from race_private.rooms r where r.id = room);
  perform pg_temp.as_user(sam);
  perform public.race_action('get', room, '{}', null);
  perform pg_temp.as_user(kai);
  perform public.race_action('get', room, '{}', null);
  update race_private.rooms set start_at = clock_timestamp() - interval '31 seconds' where id = room;
  perform pg_temp.seat(room, sam, 'fast');
  update race_private.rooms set start_at = clock_timestamp() - interval '41 seconds' where id = room;
  ratings_before := (select string_agg(rating || '/' || rated, ' ' order by user_id) from race_private.ratings where user_id in (sam, kai));
  perform pg_temp.as_user(kai);
  reply := public.quick_match('rating', '{}');
  if (reply->'last') - 'races' <> jsonb_build_object('roomId', room, 'rated', true, 'reason', 'unfinished', 'outcome', 'lost',
      'before', 1496, 'after', 1476, 'delta', -20) or (reply->>'rating')::integer <> 1476 then
    raise exception 'The racer who left did not see a rated loss on return: %', reply;
  end if;
  if public.quick_match('queue', '{"displayName":"Kai"}')->>'rating' <> '1476' then raise exception 'The queue did not pair on the settled rating.'; end if;
  perform public.quick_match('unqueue', '{}');
  perform pg_temp.as_user(sam);
  snap := public.race_action('get', room, '{}', null);
  if snap->>'status' <> 'finished' or snap->'rating'->>'reason' <> 'opponent-absent' or snap->'rating'->>'outcome' <> 'won' or (snap->'rating'->>'delta')::integer <= 0 then
    raise exception 'The racer who stayed did not get a rated win: %', snap->'rating';
  end if;
  -- A finish from Kai's old page, arriving now with a passing run, changes no verdict, rating or result, and
  -- the reply says how the race ended.
  ratings_before := (select string_agg(rating || '/' || rated, ' ' order by user_id) from race_private.ratings where user_id in (sam, kai));
  got := pg_temp.settled(room);
  perform pg_temp.as_user(kai);
  snap := public.race_action('progress', room, jsonb_build_object('typed', left(passage, 245), 'keystrokes', 245, 'errors', 0,
    'finished', true, 'sequence', 9, 'trace', pg_temp.trace_of(passage, 245, 120)), null);
  if snap->'rating'->>'reason' <> 'unfinished' or snap->'rating'->>'outcome' <> 'lost' or pg_temp.settled(room) <> got
    or (select string_agg(rating || '/' || rated, ' ' order by user_id) from race_private.ratings where user_id in (sam, kai)) <> ratings_before
    or (select trace_verdict from race_private.players where room_id = room and user_id = kai) is not null then
    raise exception 'A finish after the race was settled changed it: % %', snap->'rating', pg_temp.settled(room);
  end if;
  -- Replaying every request and every settling step changes nothing.
  perform race_private.settle_due(clock_timestamp());
  perform race_private.rate(room, null);
  perform race_private.rate(room, 2);
  perform race_private.settle(room);
  perform public.race_action('leave', room, '{}', null);
  perform pg_temp.as_user(sam);
  perform public.race_action('get', room, '{}', null);
  perform public.race_action('leave', room, '{}', null);
  if pg_temp.settled(room) <> got or (select string_agg(rating || '/' || rated, ' ' order by user_id) from race_private.ratings where user_id in (sam, kai)) <> ratings_before then
    raise exception 'Replaying requests moved a settled race.';
  end if;

  -- A race both racers left long ago, which no quick match request has touched since, is settled by the next
  -- room anyone opens, before old rooms are deleted: its result outlives the room.
  room := pg_temp.pair(uma, vic);
  passage := (select r.passage from race_private.rooms r where r.id = room);
  perform pg_temp.as_user(uma);
  perform public.race_action('get', room, '{}', null);
  perform pg_temp.as_user(vic);
  perform public.race_action('get', room, '{}', null);
  update race_private.rooms set start_at = clock_timestamp() - interval '31 seconds' where id = room;
  perform pg_temp.seat(room, vic, 'slow');
  update race_private.rooms set start_at = clock_timestamp() - interval '2 days', created_at = clock_timestamp() - interval '2 days',
    expires_at = clock_timestamp() - interval '2 days' where id = room;
  perform pg_temp.as_user(tom);
  perform public.race_action('create', null, jsonb_build_object('displayName', 'Tom', 'passage', repeat('the race goes on ', 4),
    'conditions', '{"mode":"time","duration":30}'::jsonb), null);
  if exists(select 1 from race_private.rooms where id = room) or pg_temp.settled(room) <> 'rated: lost unfinished -20, won opponent-absent +20' then
    raise exception 'An old abandoned race was deleted unsettled: %', pg_temp.settled(room);
  end if;

  -- Repeat pairings count less: between the same two accounts only the first three rated results in any 24 hours
  -- move ratings. The fourth race still runs and has its result, for the cards and the tally, unrated for both.
  for i in 1 .. 4 loop
    if i = 4 then ratings_before := (select string_agg(rating || '/' || rated, ' ' order by user_id) from race_private.ratings where user_id in (pia, quinn)); end if;
    room := pg_temp.pair(pia, quinn);
    pair_rooms := pair_rooms || room;
    passage := (select r.passage from race_private.rooms r where r.id = room);
    -- They take turns winning, so their ratings stay within the pairing gap.
    snap := pg_temp.race(room, pia, quinn, pg_temp.trace_of(passage, case i % 2 when 1 then 245 else 200 end, case i % 2 when 1 then 120 else 148 end),
      pg_temp.trace_of(passage, case i % 2 when 1 then 200 else 245 end, case i % 2 when 1 then 148 else 120 end));
  end loop;
  if (snap->'rating') - 'races' - 'before' - 'after' <> jsonb_build_object('rated', false, 'reason', null, 'outcome', 'won', 'delta', 0)
    or (select string_agg(rating || '/' || rated, ' ' order by user_id) from race_private.ratings where user_id in (pia, quinn)) <> ratings_before
    or snap->'tally' <> '[2, 2]'::jsonb then
    raise exception 'A fourth rated race in a day between the same pair moved ratings: % %', snap->'rating', snap->'tally';
  end if;
  -- The 24 hours roll: once the first of the three is more than a day old, the next race counts again.
  update race_private.rated_results set settled_at = clock_timestamp() - interval '25 hours' where room_id = pair_rooms[1];
  room := pg_temp.pair(pia, quinn);
  passage := (select r.passage from race_private.rooms r where r.id = room);
  snap := pg_temp.race(room, pia, quinn, pg_temp.trace_of(passage, 245, 120), pg_temp.trace_of(passage, 200, 148));
  if not (snap->'rating'->>'rated')::boolean or (snap->'rating'->>'delta')::integer >= 0 then
    raise exception 'A race after the 24 hours rolled on was not rated: %', snap->'rating';
  end if;

  -- Pairing passes over the racer either player last raced while anyone else is in range: P and Q just raced, so P
  -- pairs with R at 50 points' gap rather than Q at none. With R out of range, P pairs with Q.
  for i in 1 .. 2 loop
    delete from race_private.match_queue;
    insert into race_private.match_queue (user_id, name, rating) values
      (quinn, 'Q', (select rating from race_private.ratings where user_id = pia)),
      (rio, 'R', (select rating from race_private.ratings where user_id = pia) + case i when 1 then 50 else 500 end);
    perform pg_temp.as_user(pia);
    reply := public.quick_match('queue', '{"displayName":"P"}');
    if (select user_id from race_private.players where room_id = (reply->>'roomId')::uuid and slot = 1) <> (case i when 1 then rio else quinn end) then
      raise exception 'Pairing chose % (case %).', (select name from race_private.players where room_id = (reply->>'roomId')::uuid and slot = 1), i;
    end if;
    perform public.quick_match('unqueue', '{}');
  end loop;
  delete from race_private.match_queue;

  -- One person with two accounts can't raise a rating by forfeiting: Alt leaves right after each start while Main
  -- never types. Each forfeit lowers Alt, rated, and Main's own run never came, so Main's rating doesn't move. From
  -- the fourth on, past the pair's three rated results today, not even Alt's moves.
  for i in 1 .. 4 loop
    room := pg_temp.pair(main, alt);
    perform pg_temp.as_user(main);
    perform public.race_action('get', room, '{}', null);
    perform pg_temp.as_user(alt);
    perform public.race_action('get', room, '{}', null);
    update race_private.rooms set start_at = clock_timestamp() - interval '1 second' where id = room;
    perform public.race_action('leave', room, '{}', null);
    update race_private.rooms set start_at = clock_timestamp() - interval '41 seconds' where id = room;
    perform public.quick_match('rating', '{}');
    if pg_temp.settled(room) <> (case when i < 4 then 'mixed: none unfinished 0, lost forfeit ' || (select delta from race_private.rated_results where room_id = room and user_id = alt)
        else 'unrated: none unfinished 0, lost forfeit 0' end) then
      raise exception 'Forfeit % between two accounts settled as %.', i, pg_temp.settled(room);
    end if;
  end loop;
  if (select row(rating, rated) from race_private.ratings where user_id = main) is distinct from row(1500, 0)
    or (select rating from race_private.ratings where user_id = alt) <> 1443 then
    raise exception 'Forfeits between two accounts moved Main to % or Alt to %.', (select rating from race_private.ratings where user_id = main),
      (select rating from race_private.ratings where user_id = alt);
  end if;

  -- The one-sided case's arithmetic. X (1600, 12 rated races, K 20) leaves after the start; Y (1500, none, K 40)
  -- never finishes. X's expectation is 1 / (1 + 10^(-100/400)) = 0.640, so X moves by round(20 × (0 − 0.640)) = −13
  -- and Y not at all. Then X (1587) leaves again and Y finishes a checked run: Y's expectation is
  -- 1 / (1 + 10^(87/400)) = 0.377, so Y gains round(40 × 0.623) = +25 and X loses round(20 × (0 − 0.623)) = −12,
  -- each from the ratings before the race, X's loss written when X left.
  insert into race_private.ratings (user_id, rating, rated) values (xan, 1600, 12), (yul, 1500, 0);
  for i in 1 .. 2 loop
    room := pg_temp.pair(xan, yul);
    passage := (select r.passage from race_private.rooms r where r.id = room);
    perform pg_temp.as_user(xan);
    perform public.race_action('get', room, '{}', null);
    perform pg_temp.as_user(yul);
    perform public.race_action('get', room, '{}', null);
    update race_private.rooms set start_at = clock_timestamp() - interval '31 seconds' where id = room;
    perform pg_temp.as_user(xan);
    perform public.race_action('leave', room, '{}', null);
    if i = 2 then perform pg_temp.seat(room, yul, 'slow'); end if;
    update race_private.rooms set start_at = clock_timestamp() - interval '41 seconds' where id = room and status = 'racing';
    perform public.quick_match('rating', '{}');
    if pg_temp.settled(room) <> (case i when 1 then 'mixed: lost forfeit -13, none unfinished 0' else 'rated: lost forfeit -12, won forfeit +25' end) then
      raise exception 'The one-sided case % settled as %.', i, pg_temp.settled(room);
    end if;
  end loop;
  if (select string_agg(rating || '/' || rated, ' ' order by rating) from race_private.ratings where user_id in (xan, yul)) <> '1525/1 1575/14' then
    raise exception 'The one-sided ratings are %.', (select string_agg(rating || '/' || rated, ' ' order by rating) from race_private.ratings where user_id in (xan, yul));
  end if;

  -- The trace check's table, the same one tests/quick-match.test.js pins for traceCheck.
  passage := 'the quick brown fox jumps over the lazy dog and then the fox runs back home again';
  select string_agg(format('%s=%s', name, race_private.trace_check(text, trace, 30, correct)), ' ' order by ord) into verdicts from (
    select ord, name, trace, correct, coalesce(own, passage) as text from (values
    (1, 'honest', jsonb_build_object('v', 1, 'k', passage, 't', (select jsonb_agg(case when n = 1 then 400 when n % 7 = 0 then 15 else 45 + n % 30 end order by n) from generate_series(1, length(passage)) n), 'e', 30000), length(passage), null),
    (2, 'pasted', jsonb_build_object('v', 1, 'k', passage, 't', (select jsonb_agg(case when n = 1 then 400 else 0 end order by n) from generate_series(1, length(passage)) n), 'e', 30000), length(passage), null),
    (3, 'superhuman', jsonb_build_object('v', 1, 'k', left(repeat(passage || ' ', 13), 1000), 't', (select jsonb_agg(case when n = 1 then 0 else 30 end order by n) from generate_series(1, 1000) n), 'e', 30000), 1000, left(repeat(passage || ' ', 13), 1000)),
    (4, 'wrong-text', jsonb_build_object('v', 1, 'k', upper(passage), 't', (select jsonb_agg(60) from generate_series(1, length(passage))), 'e', 30000), length(passage), null),
    (5, 'empty', null, 0, null),
    (6, 'missing-times', jsonb_build_object('v', 1, 'k', passage, 't', '[60, 60]'::jsonb, 'e', 30000), length(passage), null),
    (7, 'off-clock', jsonb_build_object('v', 1, 'k', passage, 't', (select jsonb_agg(60) from generate_series(1, length(passage))), 'e', 29000), length(passage), null),
    (8, 'unreadable', jsonb_build_object('v', 2, 'k', passage, 't', '[]'::jsonb, 'e', 30000), length(passage), null)
  ) as cases(ord, name, trace, correct, own)) as checked;
  if verdicts <> 'honest=ok pasted=intervals superhuman=speed wrong-text=wrong-text empty=no-trace missing-times=times off-clock=times unreadable=unreadable' then
    raise exception 'The trace check table changed: %', verdicts;
  end if;

  -- Deleting an account deletes its place in the queue, its rating and its rated results, and leaves the
  -- other racer's own results.
  perform pg_temp.as_user(ada);
  perform public.quick_match('queue', '{"displayName":"Ada"}');
  delete from auth.users where id = ada;
  if exists(select 1 from race_private.match_queue where user_id = ada) or exists(select 1 from race_private.ratings where user_id = ada)
    or exists(select 1 from race_private.rated_results where user_id = ada) then
    raise exception 'A deleted account''s quick match rows survived.';
  end if;
  if (select count(*) from race_private.rated_results where user_id = lin) < 4 then raise exception 'Deleting an account removed the other racer''s results.'; end if;
end $quick$;
rollback;
