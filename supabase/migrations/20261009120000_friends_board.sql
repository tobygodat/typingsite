-- Friends board: today's daily challenge result and this week's practice time, among friends.
-- The numbers are a read-only view of each account's own synced profile row. Every profile save writes
-- a summary of exactly the copy it saves into the row's new `board` column, stamped with that save's
-- `updated_at` (`board.at`), so the board shows what the row holds, as Progress does. A summary whose
-- stamp no longer matches the row (a later save by a build that doesn't write the column) is shown as
-- nothing yet until a newer build repairs it from the row's own data. The column is the owner's like the
-- rest of the row: owner-only RLS, no new grants. The summary stays there, beside the history it is
-- counted from, whether or not the account shares.
-- Sharing is opt-in: an account that shares has a row in race_private.board_members, and turning sharing
-- off deletes it, which takes the account off the board at once. Changes to sharing apply in order,
-- account-wide: each one the service applies moves the account's sharing version on, and a share counts
-- only if sharing hasn't changed since the version its device last read, so a share that arrives late
-- can't undo a newer opt-out from another device. An opt-out always counts, and one sent again under
-- its own id after its reply was lost counts once. Only members see the board,
-- and they see only friends who are members too. A row is shown only to mutual friends: you see someone
-- when each of you has the other on your friend list, by account or by a confirmed email (resolved
-- exactly as a typed invite is). Because both lists must agree, adding an email never reveals whether it
-- belongs to an account, or anything about it, unless that account chose you too. Rows carry no name,
-- email or account id; each reader labels a row with the name on their own list. Results are reported by
-- browsers: friendly, unverified and unranked beyond the people each reader chose. Deleting the account
-- deletes all of its rows.

alter table public.profiles add column board jsonb
  check (board is null or (jsonb_typeof(board) = 'object' and pg_column_size(board) <= 16384));

create table race_private.board_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  since timestamptz not null default now()
);
alter table race_private.board_members enable row level security;
revoke all on race_private.board_members from public, anon, authenticated;

-- Each account's sharing version: how many shares and opt-outs the service has applied for it. The row
-- stays when sharing is turned off, so a share sent before an opt-out can be told from one sent after.
-- An account without a row is at version 0. `last_optout` is the id of the opt-out applied last, while
-- it is still the last change applied (a share clears it), so the same opt-out sent again after its
-- reply was lost is recognised and doesn't move the version a second time.
create table race_private.board_sharing (
  user_id uuid primary key references auth.users(id) on delete cascade,
  version bigint not null default 0 check (version >= 0),
  last_optout text check (last_optout is null or last_optout ~ '^[A-Za-z0-9_-]{1,64}$')
);
alter table race_private.board_sharing enable row level security;
revoke all on race_private.board_sharing from public, anon, authenticated;

-- What a reader is shown of one profile row's summary: null unless it is stamped with the row's own
-- `updated_at` (it describes that exact row); then today's daily and this week's practice. A summary
-- keys each daily by the UTC date it was played for (`days`) and each week's practice by its Monday
-- (`weeks`), from the runs' own records, so the writer's clock never picks the day or week: this reads
-- the entries for the service's own today and week. Each is checked on its own against the limits a
-- browser writes within, so a part out of place reads as nothing yet without hiding the other. Every
-- cast comes after a pattern that guards it, in a statement of its own, so a malformed column an owner
-- wrote over the API reads as nothing yet and never raises: a raise would break the board for that
-- person's friends.
create function race_private.board_numbers(p_board jsonb, p_at timestamptz, p_today date, p_week date)
returns jsonb language plpgsql stable set search_path = '' as $$
declare
  d jsonb;
  w jsonb;
  v_daily jsonb;
  v_week jsonb;
begin
  if jsonb_typeof(p_board) is distinct from 'object' or jsonb_typeof(p_board->'at') is distinct from 'string'
    or p_board->>'at' !~ '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](\.[0-9]{1,6})?(Z|[+-]([01][0-9]|2[0-3])(:?[0-5][0-9])?)$' then
    return null;
  end if;
  if (p_board->>'at')::timestamptz is distinct from p_at then return null; end if;
  -- A key on anything but an object reads as null.
  d := p_board->'days'->to_char(p_today, 'YYYY-MM-DD');
  w := p_board->'weeks'->to_char(p_week, 'YYYY-MM-DD');
  if jsonb_typeof(d) = 'object'
    and jsonb_typeof(d->'version') = 'string' and d->>'version' ~ '^[ -~]{1,200}$'
    and jsonb_typeof(d->'wpm') = 'number' and d->>'wpm' ~ '^[0-9]{1,3}$'
    and jsonb_typeof(d->'accuracy') = 'number' and d->>'accuracy' ~ '^[0-9]{1,3}$'
    and jsonb_typeof(d->'attempts') = 'number' and d->>'attempts' ~ '^[0-9]{1,4}$' then
    if (d->>'wpm')::integer <= 400 and (d->>'accuracy')::integer <= 100 and (d->>'attempts')::integer between 1 and 1000 then
      v_daily := jsonb_build_object('version', d->>'version', 'wpm', (d->>'wpm')::integer,
        'accuracy', (d->>'accuracy')::integer, 'attempts', (d->>'attempts')::integer);
    end if;
  end if;
  if jsonb_typeof(w) = 'object'
    and jsonb_typeof(w->'seconds') = 'number' and w->>'seconds' ~ '^[0-9]{1,6}$'
    and jsonb_typeof(w->'runs') = 'number' and w->>'runs' ~ '^[0-9]{1,5}$' then
    if (w->>'seconds')::integer <= 604800 and (w->>'runs')::integer <= 10000 then
      v_week := jsonb_build_object('seconds', (w->>'seconds')::integer, 'runs', (w->>'runs')::integer);
    end if;
  end if;
  return jsonb_build_object('daily', v_daily, 'week', v_week);
exception when others then
  -- The patterns leave only an impossible calendar day in `at` (31 April): it describes no row.
  return null;
end $$;
revoke all on function race_private.board_numbers(jsonb,timestamptz,date,date) from public, anon, authenticated;

-- The viewer's own row, then one row per mutual friend who shares, each with the numbers from their own
-- profile row (none yet when they have none). A viewer who doesn't share sees no rows at all. A daily
-- result counts only for today's UTC date and practice time only for this UTC week; anything older reads
-- as nothing yet. Only the viewer learns their own sharing state, and its version (`sharingVersion`), which
-- a share is sent with. `nextDay` is the number of seconds to the service's next 00:00 UTC, so a browser
-- reads again then whatever its own clock says.
create function race_private.board_snapshot(p_viewer uuid)
returns jsonb language sql stable set search_path = '' as $$
  with clock as (
    select d as today, d - (extract(isodow from d)::integer - 1) as week_start,
      ceil(extract(epoch from (((d + 1)::timestamp at time zone 'utc') - clock_timestamp())))::integer as next_day
    from (select (clock_timestamp() at time zone 'utc')::date as d) now_utc
  ),
  me as (
    select exists(select 1 from race_private.board_members m where m.user_id = p_viewer) as sharing,
      coalesce((select s.version from race_private.board_sharing s where s.user_id = p_viewer), 0) as version
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
  select jsonb_build_object('date', c.today, 'weekStart', c.week_start, 'sharing', me.sharing, 'sharingVersion', me.version,
    'nextDay', c.next_day,
    'rows', case when me.sharing then coalesce(
      -- Each row carries whatever parts board_numbers reads, nothing yet when it reads none.
      (select jsonb_agg(jsonb_build_object('self', p.self, 'id', p.friend_row, 'name', p.name, 'daily', null, 'week', null)
          || coalesce(n.numbers, '{}'::jsonb)
        order by p.self desc, lower(p.name), p.friend_row)
       from people p
       join race_private.board_members s on s.user_id = p.account_id
       left join public.profiles pr on pr.user_id = p.account_id
       cross join lateral (select race_private.board_numbers(pr.board, pr.updated_at, c.today, c.week_start) as numbers) n),
      '[]'::jsonb) else '[]'::jsonb end)
  from clock c cross join me
$$;
revoke all on function race_private.board_snapshot(uuid) from public, anon, authenticated;

-- 'board' reads it. 'unshare' removes the caller from the board, always: an opt-out is never refused. It
-- carries the id its device keeps it under (`{"id": "…"}`, 1–64 letters, digits, '-' or '_'). The same
-- opt-out sent again (its reply was lost) while it is still the last change applied is answered as done
-- and moves nothing: the account is already off the board and the version stays. Any other opt-out, a new
-- id, one sent again after a share since, or one without a valid id, moves the version on even when the
-- account is already off the board, so a share sent before it is refused. 'share' makes the caller a
-- member only when sent with the account's current sharing version (`{"version": n}`, as its device last
-- read it): after any change since, an opt-out from another device above all, it is refused and changes
-- nothing, and the reply says whether the account shares. So is a share without a whole-number version:
-- none is ever applied blind. Each change applied moves the version on by one, under that row's lock, so
-- two changes to one account apply one after the other and a share racing an opt-out is checked against
-- it. No numbers travel, and nothing here writes a profile row: those are the owner's own writes.
create function race_private.board(p_action text, p_data jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_seen bigint;
  v_optout text;
begin
  if v_uid is null or not exists(select 1 from auth.users where id = v_uid) then raise exception 'Sign in to see your friends board.'; end if;
  if p_action = 'share' or p_action = 'unshare' then
    insert into race_private.board_sharing (user_id) values (v_uid) on conflict (user_id) do nothing;
  end if;
  if p_action = 'share' then
    -- The cast comes after the pattern that guards it, in a statement of its own, so it never raises.
    if jsonb_typeof(p_data->'version') = 'number' and p_data->>'version' ~ '^[0-9]{1,18}$' then
      v_seen := (p_data->>'version')::bigint;
    end if;
    update race_private.board_sharing set version = version + 1, last_optout = null where user_id = v_uid and version = v_seen;
    if found then
      insert into race_private.board_members (user_id) values (v_uid) on conflict (user_id) do nothing;
    end if;
  elsif p_action = 'unshare' then
    if jsonb_typeof(p_data->'id') = 'string' and p_data->>'id' ~ '^[A-Za-z0-9_-]{1,64}$' then
      v_optout := p_data->>'id';
    end if;
    -- Under the row's lock: a second copy of one opt-out waits for the first, then finds it applied.
    update race_private.board_sharing set version = version + 1, last_optout = v_optout
      where user_id = v_uid and (v_optout is null or last_optout is distinct from v_optout);
    delete from race_private.board_members where user_id = v_uid;
  elsif p_action is distinct from 'board' then
    raise exception 'Unknown board action.';
  end if;
  return race_private.board_snapshot(v_uid);
end $$;
revoke all on function race_private.board(text,jsonb) from public, anon, authenticated;
grant execute on function race_private.board(text,jsonb) to authenticated;

-- Guests keep no friends and have no profile row, so only signed-in accounts may call the board.
create function public.friends_board(p_action text, p_data jsonb default '{}')
returns jsonb language sql security invoker set search_path = '' as $$
  select race_private.board(p_action, p_data)
$$;
revoke all on function public.friends_board(text,jsonb) from public, anon, authenticated;
grant execute on function public.friends_board(text,jsonb) to authenticated;
