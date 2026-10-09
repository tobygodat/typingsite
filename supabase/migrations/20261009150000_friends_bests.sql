-- Friends board bests: each sharer's best on each test shape, beside today's daily and this week's practice.
-- Applies after 20261009120000_friends_board.sql and keeps every rule of it: sharing is opt-in and the
-- account's row on the service is the only record of it; only mutual friends who share see a row, and
-- one who doesn't share sees none; rows carry no account id, email or name; the numbers are reported by
-- browsers and not verified. A sharer's row keeps their best (speed, accuracy and the UTC day it was
-- set) on each of at most 16 test shapes, keyed by the app's condition key, which names the shape and
-- the corpus and metric version, so a reader compares only bests made under its own key. Bests follow
-- the week's practice through the history-clear protocol: a publish folds them in (the better result
-- on each shape stays), a clear or its undo replaces them with what that browser counted from the clear
-- it leaves in place, a browser that missed the latest clear is refused, turning sharing off empties
-- them with the rest of the row, and deleting the account deletes them. Nothing older than the clear
-- the row counts from is kept. They stay until a clear, turning sharing off, or the account goes.

-- Whether a stored set of bests is well formed: an object of at most 16 shapes, each keyed by a
-- condition key (letters, digits, colons, dots, underscores and hyphens, at most 200 characters) and
-- holding exactly a whole wpm of 0-400, a whole accuracy of 0-100 and a date.
create function race_private.valid_bests(p_bests jsonb)
returns boolean language sql immutable set search_path = '' as $$
  select case when jsonb_typeof(p_bests) = 'object' then
    (select count(*) from jsonb_object_keys(p_bests)) <= 16
    and not exists(select 1 from jsonb_each(p_bests) e where not coalesce(
      e.key ~ '^[A-Za-z0-9:._-]{1,200}$'
      and case when jsonb_typeof(e.value) = 'object' then
        e.value - 'wpm' - 'accuracy' - 'date' = '{}'::jsonb
        and jsonb_typeof(e.value->'wpm') = 'number' and jsonb_typeof(e.value->'accuracy') = 'number'
        and jsonb_typeof(e.value->'date') = 'string' and e.value->>'date' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
        and case when e.value->>'wpm' ~ '^[0-9]{1,3}$' and e.value->>'accuracy' ~ '^[0-9]{1,3}$'
          then (e.value->>'wpm')::integer <= 400 and (e.value->>'accuracy')::integer <= 100 else false end
      else false end, false))
  else false end
$$;
revoke all on function race_private.valid_bests(jsonb) from public, anon, authenticated;

alter table race_private.summaries add column bests jsonb not null default '{}'::jsonb;
-- The opt-out marker holds none, like the rest of its numbers.
alter table race_private.summaries add constraint summaries_bests_check
  check (race_private.valid_bests(bests) and (sharing or bests = '{}'::jsonb));

-- The bests a browser sent, checked and written out afresh. None sent (or null) means none in that
-- browser. A best is dated by the UTC day it was set, which can't be later than tomorrow (a run keeps
-- the date it started on, and the browser's clock may be a little ahead).
create function race_private.sent_bests(p_bests jsonb, p_today date)
returns jsonb language plpgsql stable set search_path = '' as $$
declare
  v_key text;
  v_best jsonb;
  v_date date;
  v_bests jsonb := '{}';
begin
  if p_bests is null or jsonb_typeof(p_bests) = 'null' then return v_bests; end if;
  if jsonb_typeof(p_bests) <> 'object' then raise exception 'Invalid bests.'; end if;
  if (select count(*) from jsonb_object_keys(p_bests)) > 16 then raise exception 'Too many bests for the board.'; end if;
  for v_key, v_best in select key, value from jsonb_each(p_bests) loop
    if v_key !~ '^[A-Za-z0-9:._-]{1,200}$' or jsonb_typeof(v_best) <> 'object' then raise exception 'Invalid bests.'; end if;
    if v_best - 'wpm' - 'accuracy' - 'date' <> '{}'::jsonb
      or jsonb_typeof(v_best->'wpm') is distinct from 'number' or v_best->>'wpm' !~ '^[0-9]{1,3}$'
      or jsonb_typeof(v_best->'accuracy') is distinct from 'number' or v_best->>'accuracy' !~ '^[0-9]{1,3}$'
      or jsonb_typeof(v_best->'date') is distinct from 'string' or v_best->>'date' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
      raise exception 'Invalid bests.';
    end if;
    v_date := (v_best->>'date')::date;
    if (v_best->>'wpm')::integer > 400 or (v_best->>'accuracy')::integer > 100 or v_date > p_today + 1 then
      raise exception 'That best is outside the board limits.';
    end if;
    v_bests := v_bests || jsonb_build_object(v_key, jsonb_build_object('wpm', (v_best->>'wpm')::integer,
      'accuracy', (v_best->>'accuracy')::integer, 'date', v_date));
  end loop;
  return v_bests;
end $$;
revoke all on function race_private.sent_bests(jsonb,date) from public, anon, authenticated;

-- A browser's bests are a lower bound, like its practice time: another tab or device of the account may
-- hold runs this one never saw. So on each shape the better best stays (faster, or as fast and more
-- accurate; the earlier of two equal ones). Past 16 shapes, the ones this browser sent stay first, then
-- the most recently set.
create function race_private.fold_bests(p_old jsonb, p_new jsonb)
returns jsonb language sql immutable set search_path = '' as $$
  select coalesce(jsonb_object_agg(kept.key, kept.value), '{}'::jsonb) from (
    select better.key, better.value from (
      select distinct on (e.key) e.key, e.value from (
        select key, value, 0 as source from jsonb_each(p_new)
        union all
        select key, value, 1 from jsonb_each(p_old)
      ) e
      order by e.key, (e.value->>'wpm')::integer desc, (e.value->>'accuracy')::integer desc, e.value->>'date', e.source
    ) better
    order by p_new ? better.key desc, better.value->>'date' desc, better.key
    limit 16
  ) kept
$$;
revoke all on function race_private.fold_bests(jsonb,jsonb) from public, anon, authenticated;

-- Only bests set since the clear the row counts from: none dated before the UTC day it happened, less a
-- day's grace for the browser's clock. With no clear, all of them.
create function race_private.bests_since(p_bests jsonb, p_from timestamptz)
returns jsonb language sql stable set search_path = '' as $$
  select case when p_from is null then p_bests else coalesce((select jsonb_object_agg(e.key, e.value)
    from jsonb_each(p_bests) e where (e.value->>'date')::date >= (p_from at time zone 'utc')::date - 1), '{}'::jsonb) end
$$;
revoke all on function race_private.bests_since(jsonb,timestamptz) from public, anon, authenticated;

-- The two board functions below are those of 20261009120000_friends_board.sql with lines added for
-- bests and nothing else changed: every added line mentions bests, and tests/friends-bests.test.js
-- checks that removing those lines gives back the earlier functions exactly. A change to the earlier
-- functions must be carried over here too, or that test fails.

-- The viewer's own row, then one row per mutual friend who shares, as before, now with each row's bests.
-- A viewer who doesn't share sees no rows, so no bests either; an opt-out marker holds none.
create or replace function race_private.board_snapshot(p_viewer uuid)
returns jsonb language sql set search_path = '' as $$
  with clock as (
    select d as today, d - (extract(isodow from d)::integer - 1) as week_start
    from (select (clock_timestamp() at time zone 'utc')::date as d) now_utc
  ),
  listed as (
    -- One entry per account on the viewer's list; a row added from a race wins over a typed email.
    select distinct on (l.account_id) l.friend_row, l.account_id, l.name
    from (
      select f.id as friend_row, coalesce(f.friend_id, u.id) as account_id, f.name, f.friend_id is null as by_email, f.created_at
      from race_private.friends f
      left join auth.users u on f.friend_id is null and lower(u.email) = f.email and u.email_confirmed_at is not null
      where f.owner_id = p_viewer
    ) l
    where l.account_id is not null and l.account_id <> p_viewer
    order by l.account_id, l.by_email, l.created_at
  ),
  mutual as (
    select l.friend_row, l.account_id, l.name from listed l
    where exists(select 1 from race_private.friends g where g.owner_id = l.account_id
      and (g.friend_id = p_viewer or g.email = (select lower(v.email) from auth.users v
        where v.id = p_viewer and v.email_confirmed_at is not null)))
  ),
  people as (
    select p_viewer as account_id, null::uuid as friend_row, null::text as name, true as self
    union all
    select m.account_id, m.friend_row, m.name, false from mutual m
  )
  select jsonb_build_object('date', c.today, 'weekStart', c.week_start, 'sharing', coalesce(me.sharing, false),
    'clear', case when me.clear_id is not null then jsonb_build_object('id', me.clear_id, 'from', me.clear_from) end,
    'undo', case when me.undo_id is not null then jsonb_build_object('id', me.undo_id, 'from', me.undo_from) end,
    -- The service's time, so a browser can turn its own run times into the service's.
    'now', clock_timestamp(), 'rows',
    case when coalesce(me.sharing, false) then
      (select jsonb_agg(jsonb_build_object('self', p.self, 'id', p.friend_row, 'name', p.name,
          'bests', s.bests,
          'daily', case when s.daily_date = c.today then jsonb_build_object('version', s.daily_version, 'wpm', s.daily_wpm,
            'accuracy', s.daily_accuracy, 'attempts', s.daily_attempts) end,
          'week', case when s.week_start = c.week_start then jsonb_build_object('seconds', s.week_seconds,
            'runs', s.week_runs) end)
        order by p.self desc, lower(p.name), p.friend_row)
       from people p join race_private.summaries s on s.user_id = p.account_id and s.sharing)
    else '[]'::jsonb end)
  from clock c left join race_private.summaries me on me.user_id = p_viewer
$$;
revoke all on function race_private.board_snapshot(uuid) from public, anon, authenticated;

-- As before, and a write's bests go the way its practice time goes: 'publish' (and 'share' while sharing,
-- or a clear or undo repeated while it still stands) folds them into the row's; 'share' while not
-- sharing, a clear and an undo replace them; a refused write, or a clear overtaken since, changes
-- nothing; 'unshare' empties them with the rest. Then only bests since the row's clear are kept.
create or replace function race_private.board(p_action text, p_data jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_today date := (clock_timestamp() at time zone 'utc')::date;
  v_week date;
  v_daily jsonb;
  v_practice jsonb;
  v_date date;
  v_start date;
  v_known uuid;
  v_clear_id uuid;
  v_clear_from timestamptz;
  v_undo uuid;
  v_before uuid;
  v_repeat boolean;
  v_new race_private.summaries;
  v_old race_private.summaries;
  v_same boolean;
begin
  if v_uid is null or not exists(select 1 from auth.users where id = v_uid) then raise exception 'Sign in to see your friends board.'; end if;
  if p_data is null or jsonb_typeof(p_data) <> 'object' then raise exception 'Invalid board request.'; end if;
  v_week := v_today - (extract(isodow from v_today)::integer - 1);

  if p_action = 'unshare' then
    insert into race_private.summaries as s (user_id, sharing) values (v_uid, false)
      on conflict (user_id) do update set sharing = false, daily_date = null, daily_version = null, daily_wpm = null,
        daily_accuracy = null, daily_attempts = null, week_start = null, week_seconds = null, week_runs = null,
        bests = '{}',
        updated_at = clock_timestamp();
  elsif p_action in ('share', 'publish', 'replace') then
    -- Only the caller's own row is ever written. A missing or null daily means none in this browser.
    v_daily := case when jsonb_typeof(p_data->'daily') = 'null' then null else p_data->'daily' end;
    v_practice := p_data->'week';
    if v_daily is not null then
      if jsonb_typeof(v_daily) <> 'object' or coalesce(v_daily->>'date','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
        or jsonb_typeof(v_daily->'version') is distinct from 'string' or v_daily->>'version' !~ '^[ -~]{1,200}$'
        or coalesce(v_daily->>'wpm','') !~ '^[0-9]{1,3}$' or coalesce(v_daily->>'accuracy','') !~ '^[0-9]{1,3}$'
        or coalesce(v_daily->>'attempts','') !~ '^[0-9]{1,4}$' then raise exception 'Invalid daily result.'; end if;
      v_date := (v_daily->>'date')::date;
      -- A run keeps the date it started on, so the day either side of the server's is accepted.
      if abs(v_date - v_today) > 1 or (v_daily->>'wpm')::integer > 400 or (v_daily->>'accuracy')::integer > 100
        or (v_daily->>'attempts')::integer not between 1 and 1000 then raise exception 'That daily result is outside the board limits.'; end if;
    end if;
    if jsonb_typeof(v_practice) is distinct from 'object' or coalesce(v_practice->>'start','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      or coalesce(v_practice->>'seconds','') !~ '^[0-9]{1,6}$' or coalesce(v_practice->>'runs','') !~ '^[0-9]{1,5}$' then
      raise exception 'Invalid practice time.';
    end if;
    v_start := (v_practice->>'start')::date;
    if extract(isodow from v_start) <> 1 or abs(v_start - v_week) > 7 or (v_practice->>'seconds')::integer > 604800
      or (v_practice->>'runs')::integer > 10000 then raise exception 'That practice time is outside the board limits.'; end if;
    if p_action <> 'replace' then
      -- The latest clear this browser knows, by id.
      if coalesce(jsonb_typeof(p_data->'clear'), 'null') not in ('string', 'null')
        or coalesce(p_data->>'clear', '00000000-0000-0000-0000-000000000000') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        raise exception 'Invalid board request.';
      end if;
      v_known := (p_data->>'clear')::uuid;
    elsif jsonb_typeof(p_data->'clear') = 'object' and not p_data ? 'undo' then
      -- A clear: its id, when it happened and when this request was sent, both by the browser's clock.
      if coalesce(p_data->'clear'->>'id', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        or coalesce(p_data->'clear'->>'at', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?(Z|[+-][0-9]{2}(:?[0-9]{2})?)$'
        or coalesce(p_data->'clear'->>'sent', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?(Z|[+-][0-9]{2}(:?[0-9]{2})?)$' then
        raise exception 'Invalid board request.';
      end if;
      v_clear_id := (p_data->'clear'->>'id')::uuid;
      -- In the service's time: as long before now as it happened before it was sent. Never in the future.
      v_clear_from := least((p_data->'clear'->>'at')::timestamptz + (clock_timestamp() - (p_data->'clear'->>'sent')::timestamptz),
        clock_timestamp());
    elsif jsonb_typeof(p_data->'undo') = 'string' and not p_data ? 'clear'
        and p_data->>'undo' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        and jsonb_typeof(p_data->'before') in ('string', 'null')
        and coalesce(p_data->>'before', '00000000-0000-0000-0000-000000000000') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      -- An undo: the clear it undoes, and the clear before that the browser counted its runs from.
      v_undo := (p_data->>'undo')::uuid;
      v_before := (p_data->>'before')::uuid;
    else
      raise exception 'Invalid board request.';
    end if;
    v_new.user_id := v_uid;
    v_new.sharing := true;
    v_new.daily_date := v_date;
    v_new.daily_version := v_daily->>'version';
    v_new.daily_wpm := (v_daily->>'wpm')::integer;
    v_new.daily_accuracy := (v_daily->>'accuracy')::integer;
    v_new.daily_attempts := (v_daily->>'attempts')::integer;
    v_new.week_start := v_start;
    v_new.week_seconds := (v_practice->>'seconds')::integer;
    v_new.week_runs := (v_practice->>'runs')::integer;
    v_new.updated_at := clock_timestamp();
    v_new.seen_clears := '{}';
    -- Its bests on each test shape, checked like the rest (none sent means none in this browser).
    v_new.bests := race_private.sent_bests(p_data->'bests', v_today);
    -- Only sharing creates the row, as sent. Writes lock it, so two tabs writing at once take turns.
    if p_action = 'share' then
      insert into race_private.summaries select (v_new).* on conflict (user_id) do nothing;
      if found then return race_private.board_snapshot(v_uid); end if;
    end if;
    select * into v_old from race_private.summaries where user_id = v_uid for update;
    -- Refused, changing nothing: no row or not sharing (except to turn it on).
    if not found or (not v_old.sharing and p_action <> 'share') then
      return race_private.board_snapshot(v_uid) || jsonb_build_object('refused', true);
    end if;
    -- A clear applied before and overtaken since (by a newer clear, or by its undo), repeated after a lost
    -- reply, or one that happened before the latest clear (it waited offline, or another tab's went
    -- first), is answered as done and changes nothing: its numbers count from before the latest clear,
    -- so they would bring back runs that one removed.
    if v_clear_id is not null and v_clear_id is distinct from v_old.clear_id
        and (v_clear_id = any(v_old.seen_clears) or coalesce(v_clear_from < v_old.clear_from, false)) then
      return race_private.board_snapshot(v_uid);
    end if;
    -- A clear still the latest, or an undo already taken, repeated after a lost reply, is answered as done.
    -- Its numbers are the runs since the clear it leaves in place, so they are folded in like a publish.
    v_repeat := coalesce(v_clear_id = v_old.clear_id, false) or coalesce(v_undo = v_old.undone_id, false);
    -- Refused, changing nothing: a share or publish that missed the latest clear; an undo of a clear
    -- that isn't the latest, or one that counted its runs from another clear than the one before it.
    if not v_repeat and ((p_action <> 'replace' and v_known is distinct from v_old.clear_id)
      or (p_action = 'replace' and v_clear_id is null
        and (v_undo is distinct from v_old.clear_id or v_before is distinct from v_old.undo_id))) then
      return race_private.board_snapshot(v_uid) || jsonb_build_object('refused', true);
    end if;
    v_new.clear_id := v_old.clear_id;
    v_new.clear_from := v_old.clear_from;
    v_new.undo_id := v_old.undo_id;
    v_new.undo_from := v_old.undo_from;
    v_new.undone_id := v_old.undone_id;
    v_new.seen_clears := v_old.seen_clears;
    if v_repeat or (p_action <> 'replace' and v_old.sharing) then
      -- A browser's summary is a lower bound: another tab or device of the same account may hold runs
      -- this one never saw. So the stored daily stays unless this one is for a later day (today's
      -- before any other) or is a better result on the same daily, and within one week the larger
      -- practice time and run count stay. A daily from another build replaces the stored one.
      -- On each test shape the better of the two bests stays.
      v_new.bests := race_private.fold_bests(v_old.bests, v_new.bests);
      v_same := coalesce(v_old.daily_date = v_new.daily_date and v_old.daily_version = v_new.daily_version, false);
      if v_same then v_new.daily_attempts := greatest(v_old.daily_attempts, v_new.daily_attempts); end if;
      if v_old.daily_date is not null and (v_new.daily_date is null
          or (v_old.daily_date = v_today, v_old.daily_date) > (v_new.daily_date = v_today, v_new.daily_date)
          or (v_same and (v_old.daily_wpm, v_old.daily_accuracy) > (v_new.daily_wpm, v_new.daily_accuracy))) then
        v_new.daily_date := v_old.daily_date;
        v_new.daily_version := v_old.daily_version;
        v_new.daily_wpm := v_old.daily_wpm;
        v_new.daily_accuracy := v_old.daily_accuracy;
        if not v_same then v_new.daily_attempts := v_old.daily_attempts; end if;
      end if;
      if v_old.week_start = v_new.week_start then
        v_new.week_seconds := greatest(v_old.week_seconds, v_new.week_seconds);
        v_new.week_runs := greatest(v_old.week_runs, v_new.week_runs);
      elsif (v_old.week_start = v_week, v_old.week_start) > (v_new.week_start = v_week, v_new.week_start) then
        v_new.week_start := v_old.week_start;
        v_new.week_seconds := v_old.week_seconds;
        v_new.week_runs := v_old.week_runs;
      end if;
    elsif v_clear_id is not null then
      v_new.undone_id := null;
      v_new.undo_id := v_old.clear_id;
      v_new.undo_from := v_old.clear_from;
      v_new.clear_id := v_clear_id;
      v_new.seen_clears := (array[v_clear_id] || v_old.seen_clears)[1:20];
      v_new.clear_from := v_clear_from;
    elsif p_action = 'replace' then
      v_new.clear_id := v_old.undo_id;
      v_new.clear_from := v_old.undo_from;
      v_new.undo_id := null;
      v_new.undo_from := null;
      v_new.undone_id := v_undo;
    end if;
    -- No bests from before the clear the row now counts from.
    v_new.bests := race_private.bests_since(v_new.bests, v_new.clear_from);
    update race_private.summaries set sharing = true, clear_id = v_new.clear_id, clear_from = v_new.clear_from,
        bests = v_new.bests,
        undo_id = v_new.undo_id, undo_from = v_new.undo_from, undone_id = v_new.undone_id, seen_clears = v_new.seen_clears,
        daily_date = v_new.daily_date, daily_version = v_new.daily_version, daily_wpm = v_new.daily_wpm, daily_accuracy = v_new.daily_accuracy,
        daily_attempts = v_new.daily_attempts, week_start = v_new.week_start, week_seconds = v_new.week_seconds,
        week_runs = v_new.week_runs, updated_at = v_new.updated_at
      where user_id = v_uid;
  elsif p_action <> 'board' then
    raise exception 'Unknown board action.';
  end if;
  return race_private.board_snapshot(v_uid);
end $$;
revoke all on function race_private.board(text,jsonb) from public, anon, authenticated;
grant execute on function race_private.board(text,jsonb) to authenticated;
