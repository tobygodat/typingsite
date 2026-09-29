-- Applied to the "typingsite" Supabase project on 29 September 2026.
-- Feature suggestions from the footer dialog (src/account.js sendSuggestion), sent as the anonymous role.
-- Visitors may insert a row and nothing else; read suggestions from the Supabase dashboard.
create table public.feature_suggestions (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  body text not null check (char_length(body) between 1 and 1000),
  view text check (view in ('practice', 'results', 'progress', 'compete'))
);

alter table public.feature_suggestions enable row level security;

create policy "Visitors submit suggestions" on public.feature_suggestions
  for insert to anon with check (char_length(body) between 1 and 1000);

revoke all on public.feature_suggestions from anon, authenticated;
grant insert on public.feature_suggestions to anon;
