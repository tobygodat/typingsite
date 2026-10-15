-- A feature suggestion may record the learn view (the beginner lessons) as well as the four dock views.
-- The list matches SUGGESTION_VIEWS in src/account.js. Apply this before or with the frontend that sends
-- view 'learn': until then the original check rejects those inserts and the suggestion is not saved.
alter table public.feature_suggestions drop constraint if exists feature_suggestions_view_check;
alter table public.feature_suggestions add constraint feature_suggestions_view_check
  check (view in ('practice', 'results', 'progress', 'compete', 'learn'));
