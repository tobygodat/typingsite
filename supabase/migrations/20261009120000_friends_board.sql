-- Friends board: today's daily challenge result and this week's practice time, among friends.
-- Sharing is opt-in. An account that chooses to share keeps one summary row about itself, written from
-- its own browser. Only today's daily and this week's practice are kept: each newer day or week
-- overwrites the last. Turning sharing off empties the row down to a marker that holds no numbers (so a
-- browser that missed the change can't share again), and deleting the account deletes it. Only
-- accounts that share see the board, and they see only friends who share too. A row is shown
-- only to mutual friends: you see someone when each of you has the other on your friend list, by
-- account or by a confirmed email (resolved exactly as a typed invite is). Because both lists must
-- agree, adding an email never reveals whether it belongs to an account, or anything about it, unless
-- that account chose you too. Rows carry no name, email or account id; each reader labels a row with
-- the name on their own list. Results are reported by browsers: friendly, unverified and unranked
-- beyond the people each reader chose.

create table race_private.summaries (
  user_id uuid primary key references auth.users(id) on delete cascade,
  -- False after turning sharing off: the row is then only a marker, with no numbers.
  sharing boolean not null,
  -- The latest history clear on any device, in the order clears arrive: an id the clearing browser made,
  -- and the time runs count from, in the service's time. That is when it cleared, however late the
  -- request arrived: the browser sends when it cleared and when it sent the request, both by its own
  -- clock, and the gap between them is laid back from the service's clock at arrival, so the browser's
  -- clock being off doesn't matter (only network delay does). Never later than now, nor earlier than the
  -- clear it follows, so a clear can't bring back runs an earlier one removed. A browser must name it to
  -- share or publish, and counts only runs from then on (converted to the service's time by its own
  -- clock's offset), so a browser that missed a clear can't bring the cleared numbers back.
  clear_id uuid,
  clear_from timestamptz,
  -- The clear before it, which an undo of the latest one puts back.
  undo_id uuid,
  undo_from timestamptz,
  -- The clear the last undo took back, so an undo repeated after a lost reply is answered as done.
  undone_id uuid,
  -- Today's best completed physical-keyboard daily attempt, and how many completed attempts there were.
  daily_date date,
  -- Which daily it was (conditions with corpus and metric version, and the passage), so a reader
  -- compares only results made under its own version.
  daily_version text check (daily_version ~ '^[ -~]{1,200}$'),
  daily_wpm integer check (daily_wpm between 0 and 400),
  daily_accuracy integer check (daily_accuracy between 0 and 100),
  daily_attempts integer check (daily_attempts between 1 and 1000),
  -- Completed, uninterrupted runs since Monday 00:00 UTC.
  week_start date check (extract(isodow from week_start) = 1),
  week_seconds integer check (week_seconds between 0 and 604800),
  week_runs integer check (week_runs between 0 and 10000),
  updated_at timestamptz not null default now(),
  check (num_nulls(daily_date, daily_version, daily_wpm, daily_accuracy, daily_attempts) in (0, 5)),
  check (num_nulls(week_start, week_seconds, week_runs) = case when sharing then 0 else 3 end),
  check (sharing or daily_date is null),
  check ((clear_id is null) = (clear_from is null) and (undo_id is null) = (undo_from is null))
);
alter table race_private.summaries enable row level security;
revoke all on race_private.summaries from public, anon, authenticated;

-- The viewer's own row, then one row per mutual friend who shares. A viewer who doesn't share sees no
-- rows at all. A daily result counts only for today's UTC date and practice time only for this UTC
-- week; anything older reads as nothing yet. Only the viewer learns their own sharing state and last
-- clear; nobody else's is ever returned.
create function race_private.board_snapshot(p_viewer uuid)
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
    -- The service's time, so a browser can turn its own run times into the service's.
    'now', clock_timestamp(), 'rows',
    case when coalesce(me.sharing, false) then
      (select jsonb_agg(jsonb_build_object('self', p.self, 'id', p.friend_row, 'name', p.name,
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

-- 'share' turns sharing on from a summary (or folds it into the row when already on). 'publish' folds a
-- summary into the row; it never turns sharing on. Both name the latest clear the browser knows ('clear',
-- an id or null) and are refused, changing nothing, when it isn't the stored one, and a publish is
-- refused while not sharing; the reply ("refused") says what the browser missed. 'replace' overwrites
-- the numbers while sharing, and is either a history clear ('clear': its id and when it happened) or the
-- undo of one ('undo': the id it undoes). Clears take effect in the order they arrive, whatever the
-- devices' clocks say; an undo of a clear that is no longer the latest is refused, so a newer clear wins.
-- A clear or undo repeated after a lost reply is answered as done.
-- 'unshare' empties the row down to the marker.
create function race_private.board(p_action text, p_data jsonb)
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
        and p_data->>'undo' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      v_undo := (p_data->>'undo')::uuid;
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
    -- A clear or undo repeated after a lost reply is answered as done, changing nothing: the clear is
    -- still the latest, or the undo already took it back.
    if (v_clear_id is not null and v_clear_id = v_old.clear_id) or (v_undo is not null and v_undo = v_old.undone_id) then
      return race_private.board_snapshot(v_uid);
    end if;
    -- Refused, changing nothing: a share or publish that missed the latest clear; an undo of a clear
    -- that isn't the latest.
    if (p_action <> 'replace' and v_known is distinct from v_old.clear_id)
      or (p_action = 'replace' and v_clear_id is null and v_undo is distinct from v_old.clear_id) then
      return race_private.board_snapshot(v_uid) || jsonb_build_object('refused', true);
    end if;
    v_new.clear_id := v_old.clear_id;
    v_new.clear_from := v_old.clear_from;
    v_new.undo_id := v_old.undo_id;
    v_new.undo_from := v_old.undo_from;
    v_new.undone_id := v_old.undone_id;
    if v_clear_id is not null then
      v_new.undone_id := null;
      v_new.undo_id := v_old.clear_id;
      v_new.undo_from := v_old.clear_from;
      v_new.clear_id := v_clear_id;
      -- A clear that arrives after a later one (sent late) can't move the time back past it.
      v_new.clear_from := greatest(v_old.clear_from, v_clear_from);
    elsif p_action = 'replace' then
      v_new.clear_id := v_old.undo_id;
      v_new.clear_from := v_old.undo_from;
      v_new.undo_id := null;
      v_new.undo_from := null;
      v_new.undone_id := v_undo;
    elsif v_old.sharing then
      -- A browser's summary is a lower bound: another tab or device of the same account may hold runs
      -- this one never saw. So the stored daily stays unless this one is for a later day (today's
      -- before any other) or is a better result on the same daily, and within one week the larger
      -- practice time and run count stay. A daily from another build replaces the stored one.
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
    end if;
    update race_private.summaries set sharing = true, clear_id = v_new.clear_id, clear_from = v_new.clear_from,
        undo_id = v_new.undo_id, undo_from = v_new.undo_from, undone_id = v_new.undone_id, daily_date = v_new.daily_date,
        daily_version = v_new.daily_version, daily_wpm = v_new.daily_wpm, daily_accuracy = v_new.daily_accuracy,
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

-- Guests keep no friends and publish nothing, so only signed-in accounts may call the board.
create function public.friends_board(p_action text, p_data jsonb default '{}')
returns jsonb language sql security invoker set search_path = '' as $$
  select race_private.board(p_action, p_data)
$$;
revoke all on function public.friends_board(text,jsonb) from public, anon, authenticated;
grant execute on function public.friends_board(text,jsonb) to authenticated;
