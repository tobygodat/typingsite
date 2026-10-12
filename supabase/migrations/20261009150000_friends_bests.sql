-- Friends board bests: each sharer's best on each test shape, beside today's daily and this week's practice.
-- Applies after 20261009120000_friends_board.sql and keeps every rule of it: the numbers are a read-only
-- view of each account's own profile row; sharing is opt-in and the account's membership is the only
-- record of it; only mutual friends who share see a row, and one who doesn't share sees none; rows carry
-- no account id, email or name; the numbers are reported by browsers and not verified. Nothing is
-- stored here and nothing is written: each profile save's summary (`profiles.board`) carries `bests`,
-- each test shape's best (speed, accuracy and the UTC day of the run) among the runs in the copy saved,
-- on at most 16 shapes, keyed by the app's condition key, which names the shape and the corpus and metric
-- version, so a reader compares only bests made under its own key. So bests follow the row's history
-- exactly as the rest of the summary does: a history clear's save takes them off, its undo's save puts
-- them back, and deleting the account deletes them.

-- What a reader is shown of a summary's bests: an object of at most 16 shapes (none otherwise), and of
-- those each one checked on its own, so one out of place reads as no best on that shape without hiding
-- the others: a condition key (letters, digits, colons, dots, underscores, pluses and hyphens, at most
-- 200 characters) holding a whole wpm of 0-400, a whole accuracy of 0-100 and a date (YYYY-MM-DD). Each
-- cast comes after the pattern that guards it, and the date is never cast, so a malformed column an
-- owner wrote over the API reads as no bests and never raises: a raise would break the board for that
-- person's friends.
create function race_private.board_bests(p_bests jsonb)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare
  v_key text;
  v_best jsonb;
  v_bests jsonb := '{}';
begin
  if jsonb_typeof(p_bests) is distinct from 'object' or (select count(*) from jsonb_object_keys(p_bests)) > 16 then
    return v_bests;
  end if;
  for v_key, v_best in select key, value from jsonb_each(p_bests) loop
    if v_key ~ '^[A-Za-z0-9:._+-]{1,200}$' and jsonb_typeof(v_best) = 'object'
      and jsonb_typeof(v_best->'wpm') = 'number' and v_best->>'wpm' ~ '^[0-9]{1,3}$'
      and jsonb_typeof(v_best->'accuracy') = 'number' and v_best->>'accuracy' ~ '^[0-9]{1,3}$'
      and jsonb_typeof(v_best->'date') = 'string' and v_best->>'date' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
      if (v_best->>'wpm')::integer <= 400 and (v_best->>'accuracy')::integer <= 100 then
        v_bests := v_bests || jsonb_build_object(v_key, jsonb_build_object('wpm', (v_best->>'wpm')::integer,
          'accuracy', (v_best->>'accuracy')::integer, 'date', v_best->>'date'));
      end if;
    end if;
  end loop;
  return v_bests;
end $$;
revoke all on function race_private.board_bests(jsonb) from public, anon, authenticated;

-- board_numbers as 20261009120000_friends_board.sql defines it, with the summary's bests added to what
-- it returns, and nothing else changed (tests/friends-bests.test.js checks that). board_snapshot gives
-- each row whatever parts this returns, so it needs no change.
create or replace function race_private.board_numbers(p_board jsonb, p_at timestamptz, p_today date, p_week date)
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
  return jsonb_build_object('daily', v_daily, 'week', v_week, 'bests', race_private.board_bests(p_board->'bests'));
exception when others then
  -- The patterns leave only an impossible calendar day in `at` (31 April): it describes no row.
  return null;
end $$;
revoke all on function race_private.board_numbers(jsonb,timestamptz,date,date) from public, anon, authenticated;
