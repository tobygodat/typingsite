-- Applied to the "typingsite" Supabase project on 29 September 2026.
-- One practice profile (preferences, attempts, loops, bests) per signed-in user.
create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "Users read their own profile" on public.profiles
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users create their own profile" on public.profiles
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Users update their own profile" on public.profiles
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Users delete their own profile" on public.profiles
  for delete to authenticated using ((select auth.uid()) = user_id);

revoke all on public.profiles from anon;
grant select, insert, update, delete on public.profiles to authenticated;
