-- Quick match and a race rating (TOB-421, docs/adr/0014-quick-match-and-race-rating.md).
-- Queue: a signed-in player asks to race, and keeps asking about once a second while waiting
-- (public.quick_match 'queue'). A request pairs the asker with the waiting player whose race rating is
-- closest, within a gap that widens the longer either has waited. Every queue request takes one
-- transaction lock, so two requests never pair at once: nobody is paired twice, with themselves, or while
-- seated in another quick match. A player not heard from for ten seconds leaves the queue.
-- Room: a pair becomes an ordinary two-player race room (quick), already counting down, on the standard
-- setup, with a passage the service draws itself so neither racer picks the text. A seat counts as there
-- once its browser asks the race about the room; a room whose other seat never came is called off at the
-- start, so nobody races a racer who isn't there. Leaving the queue calls off a room the seat never came to.
-- Rating: Elo, one number per account, moved only by quick matches. Once a race has started it is settled by
-- the clock: when both seats have finished, or ten seconds after the race clock ends. A seat counts only with a
-- finished run whose keystroke trace passes race_private.trace_check. Both pass: the traces decide. One passes:
-- a rated win for it and a rated loss for the other, whatever the other did or didn't send. Neither: unrated.
-- Leaving before finishing, after the start, is a rated loss (a forfeit). A request about a room settles it once
-- due, and every quick match request and every room opened settles every due race first (settle_due), so nobody
-- waits on a racer who has gone and no rating is read unsettled. The result is written once per room
-- (race_private.rated_results): a replay or a late finish changes nothing.
-- Every new table cascades from auth.users and is reached only through these functions.

alter table race_private.rooms add column quick boolean not null default false;
alter table race_private.players add column trace_verdict text
  check (trace_verdict in ('ok', 'no-trace', 'unreadable', 'times', 'intervals', 'wrong-text', 'speed'));

create table race_private.match_queue (
  user_id uuid primary key references auth.users(id) on delete cascade,
  name text not null check (length(name) between 1 and 40),
  rating integer not null,
  joined_at timestamptz not null default now(),
  seen_at timestamptz not null default now()
);
create table race_private.ratings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  rating integer not null default 1500,
  rated integer not null default 0 check (rated >= 0),
  updated_at timestamptz not null default now()
);
-- One row per seat of each settled quick match. It outlives the room, which is deleted a day after it
-- expires, and keeps no id of the other racer, so it goes with its own account only.
create table race_private.rated_results (
  room_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  outcome text not null check (outcome in ('won', 'lost', 'tied')),
  rated boolean not null,
  -- Why the result is what it is, for this seat: null when both runs passed and the traces decided.
  reason text check (reason in ('forfeit', 'opponent-absent', 'opponent-unchecked', 'no-trace', 'unreadable', 'times',
    'intervals', 'wrong-text', 'speed', 'unfinished')),
  rating_before integer not null,
  rating_after integer not null,
  delta integer not null default 0,
  settled_at timestamptz not null default clock_timestamp(),
  primary key (room_id, user_id)
);
create index rated_results_user on race_private.rated_results (user_id, settled_at desc);
-- The quick matches a request may have to settle: live, oldest start first.
create index rooms_quick_live on race_private.rooms (start_at) where quick and status in ('countdown', 'racing');
alter table race_private.match_queue enable row level security;
alter table race_private.ratings enable row level security;
alter table race_private.rated_results enable row level security;
revoke all on race_private.match_queue, race_private.ratings, race_private.rated_results from public, anon, authenticated;

-- The standard setup's text: 30 seconds of Monkeytype's 200 English words (src/words.js), no word equal to
-- either of the two before it, cut at a word's end to what 400 wpm types in 30 seconds (1000 characters),
-- as src/race-options.js racePassage cuts a timed passage.
create function race_private.quick_passage()
returns text language plpgsql volatile set search_path = '' as $$
declare
  v_words text[] := regexp_split_to_array(btrim($words$
  the be of and a to in he have it that for they i with as not on she at by this we you do but from or which
  one would all will there say who make when can more if no man out other so what time up go about than into
  could state only new year some take come these know see use get like then first any work now may such give
  over think most even find day also after way many must look before great back through long where much should
  well people down own just because good each those feel seem how high too place little world very still nation
  hand old life tell write become here show house both between need mean call develop under last right move
  thing general school never same another begin while number part turn real leave might want point form off
  child few small since against ask late home interest large person end open public follow during present
  without again hold govern around possible head consider word program problem however lead system set order
  eye plan run keep face fact group play stand increase early course change help line
$words$), '\s+');
  v_text text := '';
  v_word text;
  v_one text := '';
  v_two text := '';
begin
  loop
    v_word := v_words[1 + floor(random() * array_length(v_words, 1))::integer];
    continue when v_word in (v_one, v_two);
    exit when length(v_text) + length(v_word) + 1 > 1000;
    v_text := case when v_text = '' then v_word else v_text || ' ' || v_word end;
    v_two := v_one;
    v_one := v_word;
  end loop;
  return v_text;
end $$;
revoke all on function race_private.quick_passage() from public, anon, authenticated;

-- What src/quick-match.js quickConditions() sends for a race on the standard setup.
create function race_private.quick_conditions()
returns jsonb language sql immutable set search_path = '' as $$
  select '{"mode":"time","duration":30,"punctuation":false,"numbers":false,"wordList":"200","correctionPolicy":"mandatory","onlineRace":true,"language":"en","inputClass":"physical-keyboard","corpus":"original-en-v6","metricVersion":"stilltype-metrics-v1"}'::jsonb
$$;
revoke all on function race_private.quick_conditions() from public, anon, authenticated;

-- Whether a finished run could be a person typing this passage, mirrored by traceCheck in
-- src/quick-match.js: 'ok' or the first reason it can't be rated. It is a floor, not anti-cheat, and never
-- raises. The limits, kept equal to TRACE_CHECK there: at most 6000 keys, ten minutes and 999999 ms a step;
-- 20 keys in a row each under 20 ms after the one before (600 wpm held for four words, which key rollover
-- never sustains), or more than a hundred keys a second; over 350 wpm.
create function race_private.trace_check(p_passage text, p_trace jsonb, p_duration integer, p_correct integer)
returns text language plpgsql immutable set search_path = '' as $$
declare
  v_keys text;
  v_times jsonb;
  v_count integer;
  v_end bigint;
  v_sum bigint := 0;
  v_run integer := 0;
  v_step text;
  v_score jsonb;
begin
  if p_trace is null or jsonb_typeof(p_trace) <> 'object' then return 'no-trace'; end if;
  if coalesce(p_trace->>'v', '') <> '1' or jsonb_typeof(p_trace->'k') is distinct from 'string'
    or jsonb_typeof(p_trace->'e') is distinct from 'number' or coalesce(p_trace->>'e', '') !~ '^[0-9]{1,6}$'
    or (p_trace->>'e')::bigint > 600000 then
    return 'unreadable';
  end if;
  v_keys := p_trace->>'k';
  v_count := char_length(v_keys);
  v_end := (p_trace->>'e')::bigint;
  if v_count = 0 or v_count > 6000 or v_keys ~ ('[^ -~' || chr(8) || ']') then return 'unreadable'; end if;
  v_times := p_trace->'t';
  if jsonb_typeof(v_times) is distinct from 'array' or jsonb_array_length(v_times) <> v_count then return 'times'; end if;
  for i in 0 .. v_count - 1 loop
    v_step := v_times->>i;
    if jsonb_typeof(v_times->i) <> 'number' or v_step !~ '^[0-9]{1,6}$' then return 'times'; end if;
    v_sum := v_sum + v_step::bigint;
  end loop;
  if v_end < v_sum or (p_duration is not null and v_end <> p_duration * 1000) then return 'times'; end if;
  for i in 1 .. v_count - 1 loop
    v_run := case when (v_times->>i)::integer < 20 then v_run + 1 else 0 end;
    if v_run >= 20 then return 'intervals'; end if;
  end loop;
  if v_count > floor(v_end / 10.0) + 20 then return 'intervals'; end if;
  begin
    v_score := race_private.trace_score(p_passage, p_trace, null, false);
  exception when others then
    return 'unreadable';
  end;
  if (v_score->>'correct')::integer is distinct from p_correct then return 'wrong-text'; end if;
  if (v_score->>'wpm')::integer > 350 then return 'speed'; end if;
  return 'ok';
end $$;
revoke all on function race_private.trace_check(text, jsonb, integer, integer) from public, anon, authenticated;

-- Elo's K, kept equal to kFactor in src/quick-match.js: 40 for an account's first ten rated races, then 20.
create function race_private.rating_k(p_rated integer)
returns integer language sql immutable set search_path = '' as $$
  select case when p_rated < 10 then 40 else 20 end
$$;
revoke all on function race_private.rating_k(integer) from public, anon, authenticated;

-- Settles a quick match once. A forfeit (p_forfeit, the seat that left after the start before finishing) is a
-- rated loss for that seat. Otherwise each seat counts only with a finished run whose trace passed the check:
-- both, and the traces decide (more wpm, then more accuracy); one, and it wins, rated; neither, and the match is
-- unrated, the race result still shown. Called with the room row locked; the rows it writes make every later
-- call for the room change nothing.
create function race_private.rate(p_room_id uuid, p_forfeit integer)
returns void language plpgsql set search_path = '' as $$
declare
  v_room race_private.rooms%rowtype;
  v_one race_private.players%rowtype;
  v_two race_private.players%rowtype;
  v_r1 race_private.ratings%rowtype;
  v_r2 race_private.ratings%rowtype;
  v_why1 text;
  v_why2 text;
  v_rated boolean;
  v_score float8;
  v_expected float8;
  v_d1 integer := 0;
  v_d2 integer := 0;
  v_s1 jsonb;
  v_s2 jsonb;
begin
  select * into v_room from race_private.rooms where id = p_room_id;
  if not found or not v_room.quick or exists(select 1 from race_private.rated_results where room_id = p_room_id) then return; end if;
  select * into v_one from race_private.players where room_id = p_room_id and slot = 1;
  select * into v_two from race_private.players where room_id = p_room_id and slot = 2;
  if v_one.user_id is null or v_two.user_id is null or v_one.user_id = v_two.user_id then return; end if;
  insert into race_private.ratings (user_id) values (v_one.user_id), (v_two.user_id) on conflict (user_id) do nothing;
  perform 1 from race_private.ratings where user_id in (v_one.user_id, v_two.user_id) order by user_id for update;
  select * into v_r1 from race_private.ratings where user_id = v_one.user_id;
  select * into v_r2 from race_private.ratings where user_id = v_two.user_id;
  if p_forfeit is not null then
    v_rated := true;
    v_why1 := 'forfeit';
    v_why2 := 'forfeit';
    v_score := case when p_forfeit = 1 then 0 else 1 end;
  else
    v_why1 := coalesce(v_one.trace_verdict, 'unfinished');
    v_why2 := coalesce(v_two.trace_verdict, 'unfinished');
    -- A seat whose kept trace can't be scored counts as unreadable: it fails alone, never both seats.
    if v_why1 = 'ok' then
      begin v_s1 := race_private.trace_score(v_room.passage, v_one.trace, null, false);
      exception when others then v_why1 := 'unreadable'; end;
    end if;
    if v_why2 = 'ok' then
      begin v_s2 := race_private.trace_score(v_room.passage, v_two.trace, null, false);
      exception when others then v_why2 := 'unreadable'; end;
    end if;
    v_rated := v_why1 = 'ok' or v_why2 = 'ok';
    if v_why1 = 'ok' and v_why2 = 'ok' then
      v_score := case when ((v_s1->>'wpm')::integer, (v_s1->>'accuracy')::integer) > ((v_s2->>'wpm')::integer, (v_s2->>'accuracy')::integer) then 1
        when ((v_s1->>'wpm')::integer, (v_s1->>'accuracy')::integer) < ((v_s2->>'wpm')::integer, (v_s2->>'accuracy')::integer) then 0 else 0.5 end;
      v_why1 := null;
      v_why2 := null;
    elsif v_rated then
      v_score := case when v_why1 = 'ok' then 1 else 0 end;
      if v_why1 = 'ok' then v_why1 := case when v_why2 = 'unfinished' then 'opponent-absent' else 'opponent-unchecked' end;
      else v_why2 := case when v_why1 = 'unfinished' then 'opponent-absent' else 'opponent-unchecked' end; end if;
    else
      v_score := case race_private.winner(p_room_id) when 1 then 1 when 2 then 0 else 0.5 end;
    end if;
  end if;
  if v_rated then
    v_expected := 1 / (1 + 10 ^ ((v_r2.rating - v_r1.rating) / 400.0::float8));
    v_d1 := round((race_private.rating_k(v_r1.rated) * (v_score - v_expected))::numeric);
    v_d2 := round((race_private.rating_k(v_r2.rated) * ((1 - v_score) - (1 - v_expected)))::numeric);
    update race_private.ratings set rating = rating + v_d1, rated = rated + 1, updated_at = clock_timestamp() where user_id = v_one.user_id;
    update race_private.ratings set rating = rating + v_d2, rated = rated + 1, updated_at = clock_timestamp() where user_id = v_two.user_id;
  end if;
  insert into race_private.rated_results (room_id, user_id, outcome, rated, reason, rating_before, rating_after, delta) values
    (p_room_id, v_one.user_id, case v_score when 1 then 'won' when 0 then 'lost' else 'tied' end, v_rated, v_why1, v_r1.rating, v_r1.rating + v_d1, v_d1),
    (p_room_id, v_two.user_id, case v_score when 1 then 'lost' when 0 then 'won' else 'tied' end, v_rated, v_why2, v_r2.rating, v_r2.rating + v_d2, v_d2);
end $$;
revoke all on function race_private.rate(uuid, integer) from public, anon, authenticated;

-- The queue. Every request first settles every quick match whose clock has run out, so the ratings it reads
-- and pairs on are settled. 'rating' reads the asker's rating and their last quick match result; 'queue' joins
-- or keeps a place and pairs when it can; 'unqueue' leaves, calling off a paired room this seat never came to.
-- 'queue' and 'unqueue' hold the one quick-match lock for their transaction.
create function race_private.quick_action(p_action text, p_data jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_now timestamptz := clock_timestamp();
  v_name text;
  v_rating integer;
  v_rated integer;
  v_me race_private.match_queue%rowtype;
  v_them race_private.match_queue%rowtype;
  v_room race_private.rooms%rowtype;
  v_slot integer;
  v_wait numeric;
begin
  if v_uid is null or not exists(select 1 from auth.users where id = v_uid) then raise exception 'Sign in to race someone new.'; end if;
  if p_data is null or jsonb_typeof(p_data) <> 'object' then raise exception 'Invalid quick match request.'; end if;
  if p_action not in ('rating', 'queue', 'unqueue') then raise exception 'Unknown quick match action.'; end if;
  if p_action <> 'rating' then perform pg_advisory_xact_lock(hashtextextended('quick-match', 0)); end if;
  perform race_private.settle_due(v_now);
  select coalesce((select rating from race_private.ratings where user_id = v_uid), 1500),
    coalesce((select rated from race_private.ratings where user_id = v_uid), 0) into v_rating, v_rated;
  if p_action = 'rating' then
    -- The last settled quick match, so a racer who closed the page mid-race learns how it ended.
    return jsonb_build_object('rating', v_rating, 'races', v_rated) || coalesce((select jsonb_build_object('last',
        jsonb_build_object('roomId', rr.room_id, 'rated', rr.rated, 'reason', rr.reason, 'outcome', rr.outcome,
          'before', rr.rating_before, 'after', rr.rating_after, 'delta', rr.delta, 'races', v_rated))
      from race_private.rated_results rr where rr.user_id = v_uid order by rr.settled_at desc limit 1), '{}'::jsonb);
  end if;

  delete from race_private.match_queue where seen_at < v_now - interval '10 seconds';
  -- This account's live quick match, if it has one.
  select r.* into v_room from race_private.rooms r join race_private.players p on p.room_id = r.id
    where r.quick and p.user_id = v_uid and r.status in ('countdown', 'racing') and r.expires_at > v_now
    order by r.created_at desc limit 1;
  select slot into v_slot from race_private.players where room_id = v_room.id and user_id = v_uid;

  if p_action = 'unqueue' then
    delete from race_private.match_queue where user_id = v_uid;
    if v_room.id is not null and not (select ready from race_private.players where room_id = v_room.id and slot = v_slot) then
      update race_private.rooms set status = 'cancelled' where id = v_room.id;
    end if;
    return jsonb_build_object('state', 'idle');
  end if;

  if v_room.id is not null then
    delete from race_private.match_queue where user_id = v_uid;
    return jsonb_build_object('state', 'paired', 'roomId', v_room.id, 'room', race_private.snapshot(v_room.id, v_slot));
  end if;
  v_name := btrim(coalesce(p_data->>'displayName', ''));
  if length(v_name) not between 1 and 40 or v_name ~ '[[:cntrl:]]' then raise exception 'Use a racer name of 1 to 40 characters.'; end if;
  insert into race_private.match_queue (user_id, name, rating, joined_at, seen_at) values (v_uid, v_name, v_rating, v_now, v_now)
    on conflict (user_id) do update set name = excluded.name, rating = excluded.rating, seen_at = excluded.seen_at
    returning * into v_me;
  -- The closest rating within the gap for the longer wait: 100, and 10 more for every second waited
  -- (acceptableGap in src/quick-match.js); then the longest wait.
  select * into v_them from race_private.match_queue q where q.user_id <> v_uid
    and abs(q.rating - v_me.rating) <= 100 + 10 * floor(extract(epoch from v_now - least(q.joined_at, v_me.joined_at)))
    order by abs(q.rating - v_me.rating), q.joined_at, q.user_id limit 1 for update;
  if v_them.user_id is null then
    v_wait := round(extract(epoch from v_now - v_me.joined_at) * 1000);
    return jsonb_build_object('state', 'waiting', 'rating', v_rating, 'races', v_rated, 'waitedMs', v_wait);
  end if;

  delete from race_private.match_queue where user_id in (v_uid, v_them.user_id);
  -- Terminal room data is transient, as in open_room; rated results outlive it.
  delete from race_private.rooms where expires_at < v_now - interval '1 day';
  insert into race_private.rooms (host_id, invited_id, invite_kind, passage, conditions, opened_by, duration, quick, status, start_at)
    values (v_them.user_id, v_uid, 'account', race_private.quick_passage(), race_private.quick_conditions(), 'quick', 30, true,
      'countdown', v_now + interval '5 seconds')
    returning * into v_room;
  -- Neither seat is there until its browser asks the race about the room.
  insert into race_private.players (room_id, slot, user_id, name, ready, last_seen) values
    (v_room.id, 1, v_them.user_id, v_them.name, false, v_them.seen_at),
    (v_room.id, 2, v_uid, v_name, false, v_now);
  return jsonb_build_object('state', 'paired', 'roomId', v_room.id, 'room', race_private.snapshot(v_room.id, 2));
end $$;
revoke all on function race_private.quick_action(text, jsonb) from public, anon, authenticated;
grant execute on function race_private.quick_action(text, jsonb) to authenticated;

create function public.quick_match(p_action text, p_data jsonb default '{}')
returns jsonb language sql security invoker set search_path = '' as $$
  select race_private.quick_action(p_action, p_data)
$$;
revoke all on function public.quick_match(text, jsonb) from public, anon, authenticated;
grant execute on function public.quick_match(text, jsonb) to authenticated;

-- The snapshot also says whether the room is a quick match and, once settled, this seat's rated result.
create or replace function race_private.snapshot(p_room_id uuid, p_slot integer)
returns jsonb language sql set search_path = '' as $$
 select jsonb_build_object(
   'id', r.id, 'status', r.status, 'passage', r.passage, 'conditions', r.conditions,
   'duration', r.duration, 'startAt', r.start_at, 'serverNow', clock_timestamp(),
   'expiresAt', r.expires_at, 'selfSlot', p_slot, 'inviteKind', r.invite_kind,
   'rematchOf', r.rematch_of, 'rematchId', r.rematch_id, 'quick', r.quick,
   -- This seat's settled quick match: rated or not and why, the outcome, and its rating after it.
   'rating', (select jsonb_build_object('rated', rr.rated, 'reason', rr.reason, 'outcome', rr.outcome,
       'before', rr.rating_before, 'after', rr.rating_after, 'delta', rr.delta, 'races', coalesce(g.rated, 0))
     from race_private.players me
     join race_private.rated_results rr on rr.room_id = me.room_id and rr.user_id = me.user_id
     left join race_private.ratings g on g.user_id = rr.user_id
     where me.room_id = r.id and me.slot = p_slot),
   -- The pair's wins once the race is finished, this seat's first. Null when either racer is a guest.
   'tally', (select case when me.user_id = h.a_id then jsonb_build_array(h.a_wins, h.b_wins)
       else jsonb_build_array(h.b_wins, h.a_wins) end
     from race_private.players me
     join race_private.players them on them.room_id = me.room_id and them.slot <> me.slot
     join race_private.head_to_head h on h.a_id = least(me.user_id, them.user_id) and h.b_id = greatest(me.user_id, them.user_id)
     where me.room_id = r.id and me.slot = p_slot and r.status = 'finished'),
   'players', coalesce((select jsonb_agg(jsonb_build_object(
     'slot', p.slot, 'name', p.name, 'ready', p.ready,
     'progress', round(p.correct::numeric / length(r.passage) * 100, 1),
     'finished', p.finished, 'elapsed', p.elapsed,
     'wpm', case when p.elapsed > 0 then round(p.correct::numeric / 5 / (p.elapsed / 60)) else 0 end,
     'accuracy', case when p.keystrokes > 0 then round((p.keystrokes - p.errors)::numeric / p.keystrokes * 100) else 100 end,
     'connected', p.last_seen > clock_timestamp() - interval '10 seconds',
     'rematch', p.rematch, 'left', p.left_race,
     'account', p.user_id is not null,
     'friend', p.user_id is not null and exists(select 1 from race_private.friends f where f.friend_id = p.user_id
       and f.owner_id = (select s.user_id from race_private.players s where s.room_id = r.id and s.slot = p_slot))
   ) || case when p.slot = p_slot then jsonb_build_object('typed', p.typed, 'keystrokes', p.keystrokes,
     'errors', p.errors, 'sequence', p.sequence) else '{}'::jsonb end order by p.slot)
     from race_private.players p where p.room_id = r.id), '[]'::jsonb))
 from race_private.rooms r where r.id = p_room_id
$$;
revoke all on function race_private.snapshot(uuid, integer) from public, anon, authenticated;

-- A quick room's first trace from a finished racer is checked, and the verdict kept, whether or not it replays.
-- Once the room is settled no verdict changes: a finish that arrives after it moves nothing.
create or replace function race_private.keep_trace(p_room_id uuid, p_slot integer, p_trace jsonb)
returns void language plpgsql set search_path = '' as $$
declare
  v_player race_private.players%rowtype;
  v_score jsonb;
  v_room race_private.rooms%rowtype;
begin
  select * into v_room from race_private.rooms where id = p_room_id;
  select * into v_player from race_private.players where room_id = p_room_id and slot = p_slot;
  if v_room.quick and v_player.finished and v_player.trace_verdict is null
    and not exists(select 1 from race_private.rated_results where room_id = p_room_id) then
    update race_private.players set trace_verdict = race_private.trace_check(v_room.passage, p_trace, v_room.duration, v_player.correct)
      where room_id = p_room_id and slot = p_slot;
  end if;
  if p_trace is null or jsonb_typeof(p_trace) <> 'object' then return; end if;
  if not v_player.finished or v_player.trace is not null then return; end if;
  begin
    v_score := race_private.trace_score((select passage from race_private.rooms where id = p_room_id), p_trace, null, true);
  exception when others then
    return;
  end;
  if (v_score->>'correct')::integer <> v_player.correct then return; end if;
  update race_private.players set trace = p_trace where room_id = p_room_id and slot = p_slot;
end $$;
revoke all on function race_private.keep_trace(uuid, integer, jsonb) from public, anon, authenticated;

-- The clock's own moves for one room, locked by the caller, applied before any request reads it: an invitation
-- past its time expires (never a quick match, which only the clock ends); the countdown's end starts the race,
-- or calls off a quick match with a seat that never came; and ten seconds after the race clock, a grace period
-- for the last progress, every seat still racing is finished on its last progress and the race is settled.
create function race_private.advance(p_room_id uuid, p_now timestamptz)
returns text language plpgsql set search_path = '' as $$
declare
  v_room race_private.rooms%rowtype;
begin
  select * into v_room from race_private.rooms where id = p_room_id;
  if v_room.status in ('waiting','countdown','racing') and v_room.expires_at <= p_now and not v_room.quick then
    update race_private.rooms set status='expired' where id=p_room_id; v_room.status := 'expired';
  end if;
  if v_room.status='countdown' and v_room.start_at <= p_now then
    if v_room.quick and exists(select 1 from race_private.players where room_id=p_room_id and not ready) then
      update race_private.rooms set status='cancelled' where id=p_room_id; v_room.status := 'cancelled';
    else
      update race_private.rooms set status='racing' where id=p_room_id; v_room.status := 'racing';
    end if;
  end if;
  -- A small grace period accepts the final network packet; server elapsed stays capped at the race clock.
  if v_room.status='racing' and p_now >= v_room.start_at + make_interval(secs => v_room.duration + 10) then
    update race_private.players set finished=true,elapsed=v_room.duration where room_id=p_room_id and not finished;
    update race_private.rooms set status='finished' where id=p_room_id; v_room.status := 'finished';
    perform race_private.settle(p_room_id);
  end if;
  return v_room.status;
end $$;
revoke all on function race_private.advance(uuid, timestamptz) from public, anon, authenticated;

-- Every quick match whose clock and grace have run out, settled now. Every quick match request calls it first,
-- and open_room before it deletes old rooms, so a race whose racers have both gone is settled by the next
-- request anyone makes, and before any rating is read again. A room another request holds is skipped: that
-- request is settling it, or rolls back and leaves it for the next one.
create function race_private.settle_due(p_now timestamptz)
returns void language plpgsql set search_path = '' as $$
declare
  v_id uuid;
begin
  for v_id in select id from race_private.rooms where quick and status in ('countdown','racing')
      and start_at + make_interval(secs => duration + 10) <= p_now order by start_at for update skip locked loop
    perform race_private.advance(v_id, p_now);
  end loop;
end $$;
revoke all on function race_private.settle_due(timestamptz) from public, anon, authenticated;

-- open_room as in 20261027130000_race_options.sql, settling due quick matches before it deletes old rooms.
create or replace function race_private.open_room(p_host uuid, p_invited uuid, p_kind text, p_hash text,
  p_passage text, p_conditions jsonb, p_rematch_of uuid, p_opener text)
returns race_private.rooms language plpgsql set search_path = '' as $$
declare
  v_now timestamptz := clock_timestamp();
  v_room race_private.rooms%rowtype;
begin
  -- Serialize per requester to make quotas reliable under concurrent requests.
  perform pg_advisory_xact_lock(hashtextextended(p_opener, 0));
  -- Terminal room data is transient; opportunistic cleanup needs no scheduler.
  -- A rematch's source room stays: the new room points back at it.
  perform race_private.settle_due(v_now);
  delete from race_private.rooms where expires_at < v_now - interval '1 day' and id is distinct from p_rematch_of;
  if (select count(*) from race_private.rooms where opened_by = p_opener and created_at > v_now - interval '1 hour') >= 10 then
    raise exception 'You have created several races. Please wait before hosting another.';
  end if;
  if (select count(*) from race_private.rooms where opened_by = p_opener and status in ('waiting','countdown','racing') and expires_at > v_now) >= 3 then
    raise exception 'Close an existing race before creating another.';
  end if;
  if p_passage is null or length(p_passage) not between 40 and 8000 or p_passage ~ '[^ -~]' then raise exception 'Use a passage of 40 to 8000 ordinary English characters.'; end if;
  if jsonb_typeof(coalesce(p_conditions,'{}')) <> 'object' or octet_length(coalesce(p_conditions,'{}')::text) > 2000
    or coalesce(p_conditions->>'duration', '60') !~ '^[0-9]{1,3}$' or coalesce(p_conditions->>'duration', '60')::integer not between 5 and 600 then
    raise exception 'Invalid race conditions.';
  end if;
  -- The race clock: a timed race's own length, or the limit on a race to the end of its passage.
  insert into race_private.rooms(host_id, invited_id, invite_kind, invite_hash, passage, conditions, rematch_of, opened_by, duration)
    values (p_host, p_invited, p_kind, p_hash, p_passage, coalesce(p_conditions, '{}'), p_rematch_of, p_opener,
      coalesce(p_conditions->>'duration', '60')::integer)
    returning * into v_room;
  return v_room;
end $$;
revoke all on function race_private.open_room(uuid,uuid,text,text,text,jsonb,uuid,text) from public, anon, authenticated;

-- Settling a quick match also rates it.
create or replace function race_private.settle(p_room_id uuid)
returns void language plpgsql set search_path = '' as $$
declare
  v_one uuid;
  v_two uuid;
  v_winner integer;
begin
  perform race_private.rate(p_room_id, null);
  select user_id into v_one from race_private.players where room_id = p_room_id and slot = 1;
  select user_id into v_two from race_private.players where room_id = p_room_id and slot = 2;
  if v_one is null or v_two is null or v_one = v_two then return; end if;
  v_winner := race_private.winner(p_room_id);
  insert into race_private.head_to_head (a_id, b_id, a_wins, b_wins)
    values (least(v_one, v_two), greatest(v_one, v_two),
      case when (v_winner = 1 and v_one < v_two) or (v_winner = 2 and v_two < v_one) then 1 else 0 end,
      case when (v_winner = 1 and v_one > v_two) or (v_winner = 2 and v_two > v_one) then 1 else 0 end)
    on conflict (a_id, b_id) do update
      set a_wins = race_private.head_to_head.a_wins + excluded.a_wins,
        b_wins = race_private.head_to_head.b_wins + excluded.b_wins;
end $$;
revoke all on function race_private.settle(uuid) from public, anon, authenticated;

-- race_action as in 20261027130000_race_options.sql, with the clock's moves in race_private.advance and three
-- changes for quick rooms: a seat arrives with its first request, the start calls off a room with a seat that
-- never arrived (and only the clock ends one), and leaving after the start, before finishing, forfeits.
create or replace function race_private.action(p_action text, p_room_id uuid, p_data jsonb, p_guest_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_room race_private.rooms%rowtype;
  v_next race_private.rooms%rowtype;
  v_player race_private.players%rowtype;
  v_rival race_private.players%rowtype;
  v_friend race_private.friends%rowtype;
  v_now timestamptz := clock_timestamp();
  v_name text;
  v_token text;
  v_hash text;
  v_email text;
  v_invited uuid;
  v_other uuid;
  v_slot integer;
  v_typed text;
  v_keys integer;
  v_errors integer;
  v_sequence integer;
  v_correct integer;
  v_added integer;
  v_elapsed numeric;
  v_finished boolean;
  v_result jsonb;
begin
  if p_data is null or jsonb_typeof(p_data) <> 'object' then raise exception 'Invalid race request.'; end if;
  if p_guest_token is not null then
    if p_guest_token !~ '^[0-9a-f]{64}$' then raise exception 'That guest seat is not valid.'; end if;
    v_hash := encode(extensions.digest(p_guest_token, 'sha256'), 'hex');
  end if;

  if p_action = 'create' then
    if v_uid is null or not exists(select 1 from auth.users where id = v_uid) then raise exception 'Sign in to host an online race.'; end if;
    v_name := btrim(coalesce(p_data->>'displayName', ''));
    v_email := lower(btrim(coalesce(p_data->>'inviteEmail', '')));
    if length(v_name) not between 1 and 40 or v_name ~ '[[:cntrl:]]' then raise exception 'Use a racer name of 1 to 40 characters.'; end if;
    if coalesce(p_data->>'friendId', '') <> '' then
      if p_data->>'friendId' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'That friend is no longer on your list.'; end if;
      select * into v_friend from race_private.friends where id = (p_data->>'friendId')::uuid and owner_id = v_uid;
      if not found then raise exception 'That friend is no longer on your list.'; end if;
      v_invited := v_friend.friend_id;
      v_email := coalesce(v_friend.email, '');
    end if;
    if v_email <> '' then
      if length(v_email) > 254 or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'Enter a valid account email.'; end if;
      select id into v_invited from auth.users where lower(email) = v_email and email_confirmed_at is not null limit 1;
      if v_invited = v_uid then raise exception 'Invite someone other than yourself.'; end if;
    elsif v_friend.id is null then
      v_token := encode(extensions.gen_random_bytes(32), 'hex');
    end if;
    v_room := race_private.open_room(v_uid, v_invited, case when v_token is null then 'account' else 'guest' end,
      case when v_token is not null then encode(extensions.digest(v_token,'sha256'),'hex') end,
      p_data->>'passage', p_data->'conditions', null, 'user:' || v_uid::text);
    insert into race_private.players(room_id,slot,user_id,name) values(v_room.id,1,v_uid,v_name);
    return jsonb_build_object('roomId',v_room.id,'room',race_private.snapshot(v_room.id,1))
      || case when v_token is not null then jsonb_build_object('inviteToken',v_token) else '{}'::jsonb end;
  end if;

  if p_action = 'invites' then
    if v_uid is null then raise exception 'Sign in to see race invites.'; end if;
    -- The other seated racer names the invitation: the host for a new race, either player for a rematch.
    select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'hostName',p.name,'createdAt',r.created_at,
        'expiresAt',r.expires_at,'rematch',r.rematch_of is not null) order by r.created_at desc),'[]'::jsonb)
      into v_result from race_private.rooms r
      join race_private.players p on p.room_id=r.id and p.user_id is distinct from v_uid
      where r.invited_id=v_uid and r.status='waiting' and r.expires_at > v_now
        -- Accepted invitations drop out: a joined seat, or a rematch seat its holder has opened.
        and not exists(select 1 from race_private.players s where s.room_id=r.id and s.user_id=v_uid
          and s.last_seen > '-infinity'::timestamptz);
    return v_result;
  end if;

  if p_action in ('friends','befriend','unfriend') and p_room_id is null then
    if v_uid is null or not exists(select 1 from auth.users where id = v_uid) then raise exception 'Sign in to keep a friend list.'; end if;
    if p_action = 'befriend' then
      v_email := lower(btrim(coalesce(p_data->>'email', '')));
      v_name := btrim(coalesce(p_data->>'name', ''));
      if length(v_email) > 254 or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'Enter a valid account email.'; end if;
      if v_email = (select lower(email) from auth.users where id = v_uid) then raise exception 'That’s your own account.'; end if;
      if v_name = '' then v_name := left(split_part(v_email, '@', 1), 40); end if;
      if length(v_name) not between 1 and 40 or v_name ~ '[[:cntrl:]]' then raise exception 'Use a friend name of 1 to 40 characters.'; end if;
      -- Serialize per owner so concurrent adds cannot pass the cap together.
      perform pg_advisory_xact_lock(hashtextextended('friends:' || v_uid::text, 0));
      if not exists(select 1 from race_private.friends where owner_id = v_uid and email = v_email)
        and (select count(*) from race_private.friends where owner_id = v_uid) >= 100 then raise exception 'Your friend list is full. Remove someone first.'; end if;
      insert into race_private.friends(owner_id, email, name) values (v_uid, v_email, v_name)
        on conflict (owner_id, email) where email is not null do update set name = excluded.name;
    elsif p_action = 'unfriend' then
      if coalesce(p_data->>'friendId','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'That friend is no longer on your list.'; end if;
      delete from race_private.friends where id = (p_data->>'friendId')::uuid and owner_id = v_uid;
    end if;
    return race_private.friend_list(v_uid);
  end if;

  select * into v_room from race_private.rooms where id=p_room_id for update;
  if not found then raise exception 'That race is unavailable or has expired.'; end if;
  select * into v_player from race_private.players where room_id=p_room_id
    and ((v_uid is not null and user_id=v_uid) or (v_hash is not null and guest_hash=v_hash)) limit 1;
  v_slot := v_player.slot;

  if p_action = 'join' and v_slot is null then
    if v_room.expires_at <= v_now or v_room.status <> 'waiting' then raise exception 'This race is no longer accepting racers.'; end if;
    if exists(select 1 from race_private.players where room_id=p_room_id and slot=2) then raise exception 'This race already has two racers.'; end if;
    if v_room.invite_kind='account' then
      if v_uid is null or v_room.invited_id is distinct from v_uid then raise exception 'This invite belongs to another account.'; end if;
    elsif coalesce(p_data->>'inviteToken','') !~ '^[0-9a-f]{64}$'
      or encode(extensions.digest(p_data->>'inviteToken','sha256'),'hex') is distinct from v_room.invite_hash then
      raise exception 'That race link is not valid.';
    end if;
    v_name := btrim(coalesce(p_data->>'displayName',''));
    if length(v_name) not between 1 and 40 or v_name ~ '[[:cntrl:]]' then raise exception 'Use a racer name of 1 to 40 characters.'; end if;
    if v_uid is null then v_token := encode(extensions.gen_random_bytes(32), 'hex'); end if;
    insert into race_private.players(room_id,slot,user_id,guest_hash,name) values(p_room_id,2,v_uid,
      case when v_token is not null then encode(extensions.digest(v_token,'sha256'),'hex') end,v_name);
    return jsonb_build_object('roomId',p_room_id,'room',race_private.snapshot(p_room_id,2))
      || case when v_token is not null then jsonb_build_object('guestToken',v_token) else '{}'::jsonb end;
  end if;

  if v_slot is null then raise exception 'You do not have a place in this race.'; end if;
  update race_private.players set last_seen=v_now where room_id=p_room_id and slot=v_slot;
  -- A quick match seat is there once its browser asks about the room.
  if v_room.quick and not v_player.ready then
    update race_private.players set ready=true where room_id=p_room_id and slot=v_slot;
  end if;
  v_room.status := race_private.advance(p_room_id, v_now);

  if p_action='join' then
    return jsonb_build_object('roomId',p_room_id,'room',race_private.snapshot(p_room_id,v_slot))
      || case when v_player.guest_hash is not null then jsonb_build_object('guestToken',p_guest_token) else '{}'::jsonb end;
  elsif p_action='get' then null;
  elsif p_action='leave' then
    -- Leaving a quick match after its start, before finishing, is a forfeit, rated as a loss. A seat that has
    -- finished has its run in and just goes; the clock settles the race. Before the start, the race is off.
    if v_room.quick and v_room.status='racing' and not v_player.finished then
      update race_private.rooms set status='cancelled' where id=p_room_id;
      perform race_private.rate(p_room_id, v_slot);
    elsif v_room.quick and v_room.status='racing' then
      update race_private.players set left_race=true where room_id=p_room_id and slot=v_slot;
    elsif v_room.status in ('waiting','countdown','racing') then
      update race_private.rooms set status='cancelled' where id=p_room_id;
    else
      update race_private.players set left_race=true, rematch=false where room_id=p_room_id and slot=v_slot;
    end if;
  elsif p_action='ready' then
    if v_room.status <> 'waiting' then raise exception 'The race has already started or closed.'; end if;
    if jsonb_typeof(p_data->'ready') <> 'boolean' or not (p_data ? 'ready') then raise exception 'Invalid ready state.'; end if;
    update race_private.players set ready=(p_data->>'ready')::boolean where room_id=p_room_id and slot=v_slot;
    if (select count(*) from race_private.players where room_id=p_room_id and ready) = 2 then
      update race_private.rooms set status='countdown',start_at=v_now + interval '5 seconds' where id=p_room_id;
    end if;
  elsif p_action='progress' then
    -- A trace may come with the progress that finishes this racer, or after it.
    if v_room.status='finished' or v_player.finished then
      perform race_private.keep_trace(p_room_id, v_slot, p_data->'trace');
      return race_private.snapshot(p_room_id,v_slot);
    end if;
    if v_room.status <> 'racing' or v_now < v_room.start_at then raise exception 'Wait for the shared countdown to finish.'; end if;
    if jsonb_typeof(p_data->'typed') <> 'string' or not (p_data ? 'typed') then raise exception 'Invalid typing progress.'; end if;
    v_typed := p_data->>'typed';
    if coalesce(p_data->>'keystrokes','') !~ '^[0-9]{1,5}$' or coalesce(p_data->>'errors','') !~ '^[0-9]{1,5}$'
      or coalesce(p_data->>'sequence','') !~ '^[0-9]{1,9}$' or jsonb_typeof(p_data->'finished') <> 'boolean' then raise exception 'Invalid typing counters.'; end if;
    v_keys := (p_data->>'keystrokes')::integer; v_errors := (p_data->>'errors')::integer;
    v_sequence := (p_data->>'sequence')::integer;
    if v_sequence <= v_player.sequence then return race_private.snapshot(p_room_id,v_slot); end if;
    v_elapsed := least(v_room.duration, greatest(0.001, extract(epoch from v_now-v_room.start_at)));
    if length(v_typed) > length(v_room.passage) or v_typed ~ '[^ -~]' or v_keys < length(v_typed)
      or v_keys < v_player.keystrokes or v_keys > 50000 or v_errors < v_player.errors or v_errors > v_keys
      or v_keys > floor(v_elapsed * 100) + 20 then raise exception 'Typing progress is outside the race limits.'; end if;
    select count(*) into v_correct from generate_series(1,length(v_typed)) n where substr(v_typed,n,1)=substr(v_room.passage,n,1);
    select length(v_typed) - coalesce(min(n)-1,length(v_typed)) into v_added
      from generate_series(1,length(v_typed)) n where substr(v_typed,n,1) <> substr(v_player.typed,n,1);
    if v_errors < length(v_typed) - v_correct or v_correct > v_keys - v_errors
      or v_keys - v_player.keystrokes < v_added then raise exception 'Typing counters do not match the submitted text.'; end if;
    v_finished := (p_data->>'finished')::boolean;
    if v_finished and v_elapsed < v_room.duration and v_typed <> v_room.passage then raise exception 'Complete the passage before finishing early.'; end if;
    v_finished := v_finished or v_elapsed >= v_room.duration;
    update race_private.players set typed=v_typed,keystrokes=v_keys,errors=v_errors,sequence=v_sequence,
      correct=v_correct,elapsed=v_elapsed,finished=v_finished where room_id=p_room_id and slot=v_slot;
    if v_finished then perform race_private.keep_trace(p_room_id, v_slot, p_data->'trace'); end if;
    if (select count(*) from race_private.players where room_id=p_room_id and finished)=2 then
      update race_private.rooms set status='finished' where id=p_room_id;
      perform race_private.settle(p_room_id);
    end if;
  elsif p_action='rematch' then
    if v_room.status not in ('finished','cancelled','expired') then raise exception 'Finish this race before starting another.'; end if;
    if (select count(*) from race_private.players where room_id=p_room_id) < 2 then raise exception 'Nobody joined this race, so there is no one to race again.'; end if;
    -- Once the next room is open, asking moves this seat to it. That room may also be one a racer opened
    -- alone before picks existed, which the other joins this way.
    if v_room.rematch_id is not null then
      select * into v_next from race_private.rooms where id=v_room.rematch_id;
      if found and v_next.status in ('waiting','countdown','racing') and v_next.expires_at > v_now then
        update race_private.players set last_seen=v_now where room_id=v_next.id and slot=v_slot;
        return jsonb_build_object('roomId',v_next.id,'room',race_private.snapshot(v_next.id,v_slot))
          || case when v_player.guest_hash is not null then jsonb_build_object('guestToken',p_guest_token) else '{}'::jsonb end;
      end if;
      -- That race is over, so both seats pick again from nothing.
      update race_private.players set rematch=false where room_id=p_room_id;
    end if;
    if jsonb_typeof(coalesce(p_data->'want', 'true'::jsonb)) <> 'boolean' then raise exception 'Invalid rematch choice.'; end if;
    select * into v_rival from race_private.players where room_id=p_room_id and slot<>v_slot;
    if not coalesce((p_data->>'want')::boolean, true) then
      update race_private.players set rematch=false where room_id=p_room_id and slot=v_slot;
    else
      if v_rival.left_race then raise exception '% has left this race.', v_rival.name; end if;
      update race_private.players set rematch=true, left_race=false where room_id=p_room_id and slot=v_slot;
      if v_rival.rematch then
        -- Both picked: the next room opens for the same seats, names and identities, already counting
        -- down. The racer who picked second is charged for it, not the original host.
        v_next := race_private.open_room(v_room.host_id, v_rival.user_id, v_room.invite_kind, null,
          p_data->>'passage', p_data->'conditions', p_room_id,
          case when v_player.user_id is not null then 'user:' || v_player.user_id::text else 'guest:' || v_player.guest_hash end);
        insert into race_private.players(room_id,slot,user_id,guest_hash,name,ready,last_seen)
          select v_next.id, slot, user_id, guest_hash, name, true, v_now from race_private.players where room_id=p_room_id;
        update race_private.rooms set status='countdown', start_at=v_now + interval '5 seconds' where id=v_next.id;
        update race_private.rooms set rematch_id=v_next.id where id=p_room_id;
      end if;
    end if;
    return jsonb_build_object('roomId',p_room_id,'room',race_private.snapshot(p_room_id,v_slot))
      || case when v_player.guest_hash is not null then jsonb_build_object('guestToken',p_guest_token) else '{}'::jsonb end;
  elsif p_action='traces' then
    if v_room.status <> 'finished' then raise exception 'This race has not finished.'; end if;
    return jsonb_build_object('traces', (select jsonb_agg(jsonb_build_object('slot', slot, 'trace', trace) order by slot)
      from race_private.players where room_id=p_room_id));
  elsif p_action='befriend' then
    if v_uid is null then raise exception 'Sign in to keep a friend list.'; end if;
    select user_id, name into v_other, v_name from race_private.players where room_id=p_room_id and slot<>v_slot;
    if v_other is null then raise exception 'Only racers with an account can be added as friends.'; end if;
    perform pg_advisory_xact_lock(hashtextextended('friends:' || v_uid::text, 0));
    if not exists(select 1 from race_private.friends where owner_id = v_uid and friend_id = v_other)
      and (select count(*) from race_private.friends where owner_id = v_uid) >= 100 then raise exception 'Your friend list is full. Remove someone first.'; end if;
    insert into race_private.friends(owner_id, friend_id, name) values (v_uid, v_other, v_name)
      on conflict (owner_id, friend_id) where friend_id is not null do update set name = excluded.name;
    return race_private.friend_list(v_uid);
  else raise exception 'Unknown race action.';
  end if;
  return race_private.snapshot(p_room_id,v_slot);
end $$;
revoke all on function race_private.action(text,uuid,jsonb,text) from public, anon, authenticated;
grant execute on function race_private.action(text,uuid,jsonb,text) to anon, authenticated;
