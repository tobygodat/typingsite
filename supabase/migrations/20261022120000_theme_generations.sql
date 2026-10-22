-- Theme generation's daily limit (supabase/functions/generate-theme): how many themes each account has
-- generated each UTC day. Only the Edge Function, with the service key, reads or writes it; nothing about
-- the vibe is stored. Rows go with the account (ON DELETE CASCADE), and each claim drops the caller's
-- earlier days, so a row per active account is all it holds.
create table public.theme_generations (
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null,
  count integer not null check (count > 0),
  primary key (user_id, day)
);

alter table public.theme_generations enable row level security;
revoke all on public.theme_generations from public, anon, authenticated;

-- Counts one generation for p_user today and returns true, or returns false and counts nothing once
-- today's count has reached p_limit. One statement, so concurrent claims can't pass the limit together.
create function public.claim_theme_generation(p_user uuid, p_limit integer)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_today date := (now() at time zone 'utc')::date;
  v_claimed boolean;
begin
  delete from public.theme_generations where user_id = p_user and day < v_today;
  insert into public.theme_generations as g (user_id, day, count) values (p_user, v_today, 1)
    on conflict (user_id, day) do update set count = g.count + 1 where g.count < p_limit
    returning true into v_claimed;
  return coalesce(v_claimed, false);
end $$;

revoke all on function public.claim_theme_generation(uuid, integer) from public, anon, authenticated;
grant execute on function public.claim_theme_generation(uuid, integer) to service_role;
