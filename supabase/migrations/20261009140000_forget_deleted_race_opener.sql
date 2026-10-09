-- Account deletion (supabase/functions/delete-account). Every row keyed to a user goes with the
-- auth.users row through ON DELETE CASCADE, except race_private.rooms.opened_by: a text quota key
-- ('user:<id>') for whoever asked for the room. A rematch opened inside someone else's race is that
-- racer's room too, so it stays and the deleted account's key is replaced instead.
create or replace function race_private.forget_opener()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update race_private.rooms set opened_by = 'deleted' where opened_by = 'user:' || old.id::text;
  return null;
end $$;
revoke all on function race_private.forget_opener() from public, anon, authenticated;

create trigger forget_race_opener after delete on auth.users
  for each row execute function race_private.forget_opener();
