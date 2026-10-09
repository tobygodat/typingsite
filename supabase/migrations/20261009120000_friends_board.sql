-- Friends board: today's daily challenge result and this week's practice time, among friends.
-- Each signed-in account publishes one summary row about itself from its own browser. A row is shown
-- only to mutual friends: you see someone when each of you has the other on your friend list, by
-- account or by a confirmed email (resolved exactly as a typed invite is). Because both lists must
-- agree, adding an email never reveals whether it belongs to an account, or anything about it, unless
-- that account chose you too. Rows carry no name, email or account id; each reader labels a row with
-- the name on their own list. Results are reported by browsers: friendly, unverified and unranked
-- beyond the people each reader chose.

create table race_private.summaries (
  user_id uuid primary key references auth.users(id) on delete cascade,
  -- Today's best completed physical-keyboard daily attempt, and how many completed attempts there were.
  daily_date date,
  daily_wpm integer check (daily_wpm between 0 and 400),
  daily_accuracy integer check (daily_accuracy between 0 and 100),
  daily_attempts integer check (daily_attempts between 1 and 1000),
  -- Completed, uninterrupted runs since Monday 00:00 UTC.
  week_start date not null check (extract(isodow from week_start) = 1),
  week_seconds integer not null check (week_seconds between 0 and 604800),
  week_runs integer not null check (week_runs between 0 and 10000),
  updated_at timestamptz not null default now(),
  check (num_nulls(daily_date, daily_wpm, daily_accuracy, daily_attempts) in (0, 4))
);
alter table race_private.summaries enable row level security;
revoke all on race_private.summaries from public, anon, authenticated;

-- The viewer's own row, then one row per mutual friend. A daily result counts only for today's UTC
-- date and practice time only for this UTC week; anything older reads as nothing yet.
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
  select jsonb_build_object('date', c.today, 'weekStart', c.week_start, 'rows',
    (select jsonb_agg(jsonb_build_object('self', p.self, 'id', p.friend_row, 'name', p.name,
        'daily', case when s.daily_date = c.today then jsonb_build_object('wpm', s.daily_wpm,
          'accuracy', s.daily_accuracy, 'attempts', s.daily_attempts) end,
        'week', case when s.week_start = c.week_start then jsonb_build_object('seconds', s.week_seconds,
          'runs', s.week_runs) end)
      order by p.self desc, lower(p.name), p.friend_row)
     from people p left join race_private.summaries s on s.user_id = p.account_id))
  from clock c
$$;
revoke all on function race_private.board_snapshot(uuid) from public, anon, authenticated;

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
begin
  if v_uid is null or not exists(select 1 from auth.users where id = v_uid) then raise exception 'Sign in to see your friends board.'; end if;
  if p_data is null or jsonb_typeof(p_data) <> 'object' then raise exception 'Invalid board request.'; end if;
  v_week := v_today - (extract(isodow from v_today)::integer - 1);

  if p_action = 'publish' then
    -- Only the caller's own row is ever written. A missing or null daily clears it.
    v_daily := case when jsonb_typeof(p_data->'daily') = 'null' then null else p_data->'daily' end;
    v_practice := p_data->'week';
    if v_daily is not null then
      if jsonb_typeof(v_daily) <> 'object' or coalesce(v_daily->>'date','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
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
    insert into race_private.summaries(user_id, daily_date, daily_wpm, daily_accuracy, daily_attempts,
        week_start, week_seconds, week_runs, updated_at)
      values (v_uid, v_date, (v_daily->>'wpm')::integer, (v_daily->>'accuracy')::integer, (v_daily->>'attempts')::integer,
        v_start, (v_practice->>'seconds')::integer, (v_practice->>'runs')::integer, clock_timestamp())
      on conflict (user_id) do update set daily_date = excluded.daily_date, daily_wpm = excluded.daily_wpm,
        daily_accuracy = excluded.daily_accuracy, daily_attempts = excluded.daily_attempts,
        week_start = excluded.week_start, week_seconds = excluded.week_seconds, week_runs = excluded.week_runs,
        updated_at = excluded.updated_at;
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
