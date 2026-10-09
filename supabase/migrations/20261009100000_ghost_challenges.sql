-- Asynchronous ghost challenges.
-- After a run, a signed-in racer can send it to an account on their friend list: the text, the test
-- conditions and a compact keystroke trace. The friend races that recorded run whenever they like
-- within seven days, with the sender's keystrokes replayed as a ghost caret, and both see the result.
-- Every score here is recomputed from its trace with metric v1, so neither side's number is taken on
-- trust; a trace is still browser data, so results stay friendly and unranked.
-- Compact trace: {"v":1,"k":keys,"t":[ms since the previous key, one per key],"e":end ms}. `k` holds one
-- printable character per insertion and U+0008 per deletion; the clock starts at the first key.

create table race_private.challenges (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references auth.users(id) on delete cascade,
  -- Made by the browser once per run and friend, and repeated on a retry: a send is stored once.
  request_id uuid not null,
  -- Null when a friend saved by email has no confirmed account. Sending still succeeds, exactly like
  -- a typed race invitation, so the reply never reveals whether an email belongs to an account.
  recipient_id uuid references auth.users(id) on delete cascade,
  sender_name text not null check (length(sender_name) between 1 and 40),
  -- The sender's own label for the friend, from their friend list. The recipient is never shown it.
  recipient_name text not null check (length(recipient_name) between 1 and 40),
  passage text not null check (length(passage) between 10 and 4000 and passage !~ '[^ -~]'),
  conditions jsonb not null default '{}' check (jsonb_typeof(conditions) = 'object' and octet_length(conditions::text) <= 2000),
  -- A timed run's clock in seconds; null when the finish line is the end of the passage.
  duration integer check (duration in (15, 30, 60, 120)),
  sender_trace jsonb not null check (octet_length(sender_trace::text) <= 65536),
  sender_wpm integer not null check (sender_wpm >= 0),
  sender_accuracy integer not null check (sender_accuracy between 0 and 100),
  sender_elapsed_ms integer not null check (sender_elapsed_ms >= 0),
  sender_correct integer not null check (sender_correct >= 0),
  -- The recipient's result. Only the scores are kept, not their trace.
  recipient_wpm integer check (recipient_wpm >= 0),
  recipient_accuracy integer check (recipient_accuracy between 0 and 100),
  recipient_elapsed_ms integer check (recipient_elapsed_ms >= 0),
  recipient_correct integer check (recipient_correct >= 0),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days',
  check (sender_id is distinct from recipient_id),
  check (completed_at is null or recipient_id is not null),
  check (num_nulls(completed_at, recipient_wpm, recipient_accuracy, recipient_elapsed_ms, recipient_correct) in (0, 5)),
  unique (sender_id, request_id)
);
create index challenges_sender on race_private.challenges (sender_id, created_at desc);
create index challenges_recipient on race_private.challenges (recipient_id, created_at desc) where recipient_id is not null;
create index challenges_expiry on race_private.challenges (expires_at);

-- Writes only go through race_private.challenge_action below. Reads are limited by row-level security
-- to the two parties, and the column grant leaves out both account ids and the sender's private label
-- for the friend. The schema is not exposed through the Data API; this is defence in depth.
alter table race_private.challenges enable row level security;
revoke all on race_private.challenges from public, anon, authenticated;
create policy challenges_parties_read on race_private.challenges for select to authenticated
  using ((select auth.uid()) = sender_id or (select auth.uid()) = recipient_id);
grant select (id, sender_name, passage, conditions, duration, sender_trace, sender_wpm, sender_accuracy,
  sender_elapsed_ms, sender_correct, recipient_wpm, recipient_accuracy, recipient_elapsed_ms, recipient_correct,
  completed_at, created_at, expires_at) on race_private.challenges to authenticated;

-- Metric v1 replay of a compact trace, mirroring replayAttempt and metrics in src/typing.js: corrected
-- wpm counts the matching characters kept at the end over the elapsed time; accuracy counts every
-- insertion, corrected or not; a key past the end of the passage is ignored. Both numbers are worked
-- in double precision in the browser's order and rounded half up, as Math.round does, so a value the
-- browser sees as 50.49999999999999 is 50 here too (exact numeric division would make it 51).
create function race_private.trace_score(p_passage text, p_trace jsonb, p_duration integer, p_relaxed boolean)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare
  v_keys text;
  v_times jsonb;
  v_count integer;
  v_end bigint;
  v_at bigint := 0;
  v_step text;
  v_char text;
  v_typed text := '';
  v_insertions integer := 0;
  v_right integer := 0;
  v_correct integer;
begin
  if p_trace is null or jsonb_typeof(p_trace) <> 'object' or octet_length(p_trace::text) > 65536
    or coalesce(p_trace->>'v', '') <> '1' or jsonb_typeof(p_trace->'k') is distinct from 'string'
    or jsonb_typeof(p_trace->'t') is distinct from 'array' or coalesce(p_trace->>'e', '') !~ '^[0-9]{1,6}$' then
    raise exception 'That run could not be read.';
  end if;
  v_keys := p_trace->>'k';
  v_times := p_trace->'t';
  v_count := char_length(v_keys);
  v_end := (p_trace->>'e')::bigint;
  if v_count = 0 or v_count > 6000 or jsonb_array_length(v_times) <> v_count
    or v_keys ~ ('[^ -~' || chr(8) || ']') then
    raise exception 'That run could not be read.';
  end if;
  for i in 0 .. v_count - 1 loop
    v_step := v_times->>i;
    if jsonb_typeof(v_times->i) <> 'number' or v_step !~ '^[0-9]{1,6}$' then raise exception 'That run could not be read.'; end if;
    v_at := v_at + v_step::bigint;
    v_char := substr(v_keys, i + 1, 1);
    if v_char = chr(8) then
      v_typed := left(v_typed, -1);
    elsif char_length(v_typed) < char_length(p_passage) then
      v_insertions := v_insertions + 1;
      if v_char = substr(p_passage, char_length(v_typed) + 1, 1) then v_right := v_right + 1; end if;
      v_typed := v_typed || v_char;
    end if;
  end loop;
  -- Every key inside the run, no more than a hundred keys a second (the online race limit), at most
  -- ten minutes, and a timed run's clock exactly.
  if v_end < v_at or v_end > 600000 or v_count > floor(v_end / 10.0) + 20
    or (p_duration is not null and v_end <> p_duration * 1000) then
    raise exception 'That run is outside the challenge limits.';
  end if;
  select count(*) into v_correct from generate_series(1, char_length(v_typed)) n
    where substr(v_typed, n, 1) = substr(p_passage, n, 1);
  return jsonb_build_object(
    'wpm', case when v_end > 0
      then floor((v_correct::float8 / 5::float8) / (v_end::float8 / 60000::float8) + 0.5::float8)::integer else 0 end,
    'accuracy', case when v_insertions > 0
      then floor((v_right::float8 / v_insertions::float8) * 100::float8 + 0.5::float8)::integer else 100 end,
    'elapsedMs', v_end,
    'correct', v_correct,
    -- The passage's finish line, under the run's correction rule.
    'finished', char_length(v_typed) = char_length(p_passage) and (p_relaxed or v_typed = p_passage));
end $$;
revoke all on function race_private.trace_score(text, jsonb, integer, boolean) from public, anon, authenticated;

-- What either party sees of a challenge: never an account id, and never the other side's trace.
create function race_private.challenge_view(p_row race_private.challenges, p_viewer uuid)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'id', p_row.id,
    'role', case when p_row.sender_id = p_viewer then 'sent' else 'received' end,
    'name', case when p_row.sender_id = p_viewer then p_row.recipient_name else p_row.sender_name end,
    'status', case when p_row.completed_at is not null then 'done'
      when p_row.expires_at <= clock_timestamp() then 'expired' else 'open' end,
    'conditions', p_row.conditions,
    'duration', p_row.duration,
    'sender', jsonb_build_object('wpm', p_row.sender_wpm, 'accuracy', p_row.sender_accuracy,
      'elapsedMs', p_row.sender_elapsed_ms, 'correct', p_row.sender_correct),
    'result', case when p_row.completed_at is null then null else jsonb_build_object('wpm', p_row.recipient_wpm,
      'accuracy', p_row.recipient_accuracy, 'elapsedMs', p_row.recipient_elapsed_ms, 'correct', p_row.recipient_correct) end,
    'createdAt', p_row.created_at,
    'expiresAt', p_row.expires_at,
    'completedAt', p_row.completed_at)
$$;
revoke all on function race_private.challenge_view(race_private.challenges, uuid) from public, anon, authenticated;

create function race_private.challenge_action(p_action text, p_id uuid, p_data jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_now timestamptz := clock_timestamp();
  v_friend race_private.friends%rowtype;
  v_row race_private.challenges%rowtype;
  v_recipient uuid;
  v_name text;
  v_passage text;
  v_conditions jsonb;
  v_duration integer;
  v_score jsonb;
  v_request uuid;
begin
  if v_uid is null or not exists(select 1 from auth.users where id = v_uid) then raise exception 'Sign in to send or race a ghost challenge.'; end if;
  if p_data is null or jsonb_typeof(p_data) <> 'object' then raise exception 'Invalid challenge request.'; end if;

  if p_action = 'send' then
    -- A retry after a lost reply repeats its request id and gets the challenge already stored, without
    -- a second row or another use of the quotas below.
    if coalesce(p_data->>'requestId', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'Invalid challenge request.'; end if;
    v_request := (p_data->>'requestId')::uuid;
    -- Serialize per sender so concurrent sends cannot pass the quotas together or store one request twice.
    perform pg_advisory_xact_lock(hashtextextended('challenges:' || v_uid::text, 0));
    select * into v_row from race_private.challenges where sender_id = v_uid and request_id = v_request;
    if found then return race_private.challenge_view(v_row, v_uid); end if;
    -- The recipient must be on the sender's own friend list.
    if coalesce(p_data->>'friendId', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'That friend is no longer on your list.'; end if;
    select * into v_friend from race_private.friends where id = (p_data->>'friendId')::uuid and owner_id = v_uid;
    if not found then raise exception 'That friend is no longer on your list.'; end if;
    v_recipient := v_friend.friend_id;
    if v_friend.email is not null then
      select id into v_recipient from auth.users where lower(email) = v_friend.email and email_confirmed_at is not null limit 1;
    end if;
    if v_recipient = v_uid then raise exception 'Challenge someone other than yourself.'; end if;
    v_name := btrim(coalesce(p_data->>'displayName', ''));
    if length(v_name) not between 1 and 40 or v_name ~ '[[:cntrl:]]' then raise exception 'Use a name of 1 to 40 characters.'; end if;
    v_passage := p_data->>'passage';
    if jsonb_typeof(p_data->'passage') is distinct from 'string' or length(v_passage) not between 10 and 4000 or v_passage ~ '[^ -~]' then
      raise exception 'This run’s text can’t be sent as a challenge.';
    end if;
    v_conditions := coalesce(p_data->'conditions', '{}'::jsonb);
    if jsonb_typeof(v_conditions) <> 'object' or octet_length(v_conditions::text) > 2000 then raise exception 'Invalid challenge conditions.'; end if;
    if coalesce(jsonb_typeof(p_data->'duration'), 'null') <> 'null' then
      if p_data->>'duration' not in ('15', '30', '60', '120') then raise exception 'Invalid challenge length.'; end if;
      v_duration := (p_data->>'duration')::integer;
    end if;
    v_score := race_private.trace_score(v_passage, p_data->'trace', v_duration, v_conditions->>'correctionPolicy' is not distinct from 'relaxed');
    if v_duration is null and not (v_score->>'finished')::boolean then raise exception 'Finish the run before sending it.'; end if;
    -- Results stay a month past expiry for both inboxes, then go when anyone sends a challenge.
    delete from race_private.challenges where expires_at < v_now - interval '30 days';
    if (select count(*) from race_private.challenges where sender_id = v_uid and created_at > v_now - interval '1 hour') >= 20 then
      raise exception 'You have sent several challenges. Please wait before sending another.';
    end if;
    if (select count(*) from race_private.challenges where sender_id = v_uid and completed_at is null and expires_at > v_now) >= 30 then
      raise exception 'You have 30 challenges waiting. Wait for some to be raced or to expire.';
    end if;
    insert into race_private.challenges(sender_id, request_id, recipient_id, sender_name, recipient_name, passage, conditions, duration,
        sender_trace, sender_wpm, sender_accuracy, sender_elapsed_ms, sender_correct, created_at, expires_at)
      values (v_uid, v_request, v_recipient, v_name, v_friend.name, v_passage, v_conditions, v_duration, p_data->'trace',
        (v_score->>'wpm')::integer, (v_score->>'accuracy')::integer, (v_score->>'elapsedMs')::integer,
        (v_score->>'correct')::integer, v_now, v_now + interval '7 days')
      returning * into v_row;
    return race_private.challenge_view(v_row, v_uid);
  end if;

  if p_action = 'list' then
    -- What the caller sent or received, without passages or traces, in three tiers: every challenge
    -- still open (0), then every result from the last seven days (1), then the newest fifty others for
    -- history (2); newest first within each. Tiers 0 and 1 are never cut, so newer runs can't crowd out
    -- a race still to be run or a result not yet heard on another device. Seven-day windows and the
    -- sender quotas above bound them. A row only moves down the tiers, so one that falls out of
    -- history never returns.
    return coalesce((select jsonb_agg(race_private.challenge_view(c, v_uid) order by t.tier, c.created_at desc, c.id)
      from (select id, tier, row_number() over (partition by tier order by created_at desc, id) as n
          from (select id, created_at, case when completed_at is null and expires_at > v_now then 0
              when completed_at > v_now - interval '7 days' then 1 else 2 end as tier
            from race_private.challenges where sender_id = v_uid or recipient_id = v_uid) mine) t
        join race_private.challenges c on c.id = t.id
      where t.tier < 2 or t.n <= 50), '[]'::jsonb);
  end if;

  if p_action = 'get' then
    select * into v_row from race_private.challenges where id = p_id and (sender_id = v_uid or recipient_id = v_uid);
    if not found then raise exception 'That ghost race is unavailable.'; end if;
    return race_private.challenge_view(v_row, v_uid) || jsonb_build_object('passage', v_row.passage, 'trace', v_row.sender_trace);
  end if;

  if p_action = 'finish' then
    select * into v_row from race_private.challenges where id = p_id and recipient_id = v_uid for update;
    if not found then raise exception 'That ghost race is unavailable.'; end if;
    -- The first finish stands. A repeat (a retry after a lost reply) gets that stored result back.
    if v_row.completed_at is not null then return race_private.challenge_view(v_row, v_uid); end if;
    if v_row.expires_at <= v_now then raise exception 'This ghost race expired before your run arrived.'; end if;
    v_score := race_private.trace_score(v_row.passage, p_data->'trace', v_row.duration, v_row.conditions->>'correctionPolicy' is not distinct from 'relaxed');
    if v_row.duration is null and not (v_score->>'finished')::boolean then raise exception 'Finish the run before sending it.'; end if;
    update race_private.challenges set recipient_wpm = (v_score->>'wpm')::integer, recipient_accuracy = (v_score->>'accuracy')::integer,
        recipient_elapsed_ms = (v_score->>'elapsedMs')::integer, recipient_correct = (v_score->>'correct')::integer, completed_at = v_now
      where id = p_id returning * into v_row;
    return race_private.challenge_view(v_row, v_uid);
  end if;

  raise exception 'Unknown challenge action.';
end $$;
revoke all on function race_private.challenge_action(text, uuid, jsonb) from public, anon, authenticated;
grant execute on function race_private.challenge_action(text, uuid, jsonb) to authenticated;

-- The exposed RPC is an invoker wrapper, as for race_action. Guests have no friend list, so only
-- signed-in accounts may call it.
create function public.challenge_action(p_action text, p_id uuid default null, p_data jsonb default '{}')
returns jsonb language sql security invoker set search_path = '' as $$
  select race_private.challenge_action(p_action, p_id, p_data)
$$;
revoke all on function public.challenge_action(text, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.challenge_action(text, uuid, jsonb) to authenticated;
