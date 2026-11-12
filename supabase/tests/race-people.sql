-- Challenge's people links (20261111120000_race_people.sql). Runs inside a transaction and rolls everything back.
begin;
create function pg_temp.as_user(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claim.sub', coalesce(p_user::text, ''), true)
$$;
-- A call the way PostgREST makes it: as `authenticated` with the user's id in the claim, or as `anon`.
create function pg_temp.people_of(p_user uuid) returns jsonb language plpgsql as $$
declare
  v_result jsonb;
begin
  perform pg_temp.as_user(p_user);
  perform set_config('role', case when p_user is null then 'anon' else 'authenticated' end, true);
  v_result := public.race_people();
  perform set_config('role', 'none', true);
  return v_result;
exception when others then
  perform set_config('role', 'none', true);
  raise;
end $$;
create function pg_temp.challenge(p_sender uuid, p_recipient uuid) returns uuid language sql as $$
  insert into race_private.challenges (sender_id, request_id, recipient_id, sender_name, recipient_name, passage, sender_trace,
      sender_wpm, sender_accuracy, sender_elapsed_ms, sender_correct)
    values (p_sender, gen_random_uuid(), p_recipient, 'Sender', 'Label', 'The quick brown fox jumps over the lazy dog.',
      '{"v":1,"k":"T","t":[0],"e":0}'::jsonb, 70, 98, 30000, 175)
    returning id
$$;
do $people$
declare
  ada uuid := gen_random_uuid();
  lin uuid := gen_random_uuid();
  outsider uuid := gen_random_uuid();
  ada_email text := 'race-test-' || ada::text || '@example.invalid';
  lin_email text := 'race-test-' || lin::text || '@example.invalid';
  outsider_email text := 'race-test-' || outsider::text || '@example.invalid';
  passage text := 'The quick brown fox jumps over the lazy dog.';
  lin_row uuid;
  email_row uuid;
  ada_row uuid;
  lin_room uuid;
  outsider_room uuid;
  from_lin uuid;
  to_lin uuid;
  stranger uuid;
  links jsonb;
  denied boolean;
begin
  insert into auth.users (id, email, email_confirmed_at) values (ada, ada_email, now()), (lin, lin_email, now()), (outsider, outsider_email, now());

  if has_function_privilege('anon', 'public.race_people()', 'EXECUTE')
    or not has_function_privilege('authenticated', 'public.race_people()', 'EXECUTE')
    or has_function_privilege('authenticated', 'race_private.people(uuid)', 'EXECUTE')
    or has_function_privilege('anon', 'race_private.people_action()', 'EXECUTE') then
    raise exception 'People links are exposed beyond signed-in accounts.';
  end if;

  -- A guest has no list.
  denied := false;
  begin perform pg_temp.as_user(null); perform race_private.people_action();
  exception when others then denied := true; end;
  if not denied then raise exception 'A guest read people links.'; end if;
  denied := false;
  begin perform pg_temp.people_of(null);
  exception when others then denied := true; end;
  if not denied then raise exception 'anon called race_people.'; end if;

  -- Nothing yet.
  links := pg_temp.people_of(ada);
  if links <> '{"friends":[],"invites":[],"challenges":[]}'::jsonb then raise exception 'Empty links were %.', links; end if;

  -- Ada has Lin as an account (saved from a race) and the outsider by typed email; Lin has Ada as an account.
  insert into race_private.friends (owner_id, friend_id, name) values (ada, lin, 'Lin') returning id into lin_row;
  insert into race_private.friends (owner_id, email, name) values (ada, outsider_email, 'Out') returning id into email_row;
  insert into race_private.friends (owner_id, friend_id, name) values (lin, ada, 'Ada') returning id into ada_row;

  -- No tally until the two have raced; then each reads it with their own wins first.
  links := pg_temp.people_of(ada);
  if jsonb_array_length(links->'friends') <> 0 then raise exception 'A tally appeared before any race: %.', links; end if;
  insert into race_private.head_to_head (a_id, b_id, a_wins, b_wins) values (least(ada, lin), greatest(ada, lin),
    case when ada < lin then 3 else 4 end, case when ada < lin then 4 else 3 end);
  links := pg_temp.people_of(ada);
  if links->'friends' <> jsonb_build_array(jsonb_build_object('id', lin_row, 'tally', jsonb_build_array(3, 4))) then raise exception 'Ada read %.', links; end if;
  links := pg_temp.people_of(lin);
  if links->'friends' <> jsonb_build_array(jsonb_build_object('id', ada_row, 'tally', jsonb_build_array(4, 3))) then raise exception 'Lin read %.', links; end if;

  -- A tally with an account saved only by its typed email stays unlinked: the reply never says the email is an account.
  insert into race_private.head_to_head (a_id, b_id, a_wins, b_wins) values (least(ada, outsider), greatest(ada, outsider), 1, 1);
  links := pg_temp.people_of(ada);
  if jsonb_array_length(links->'friends') <> 1 then raise exception 'An email friend was matched to its account: %.', links; end if;

  -- Invitations: Lin's links to Lin's row; the outsider's (saved by email) stays unlinked.
  perform pg_temp.as_user(lin);
  lin_room := (public.race_action('create', null, jsonb_build_object('passage', passage, 'displayName', 'Lin', 'inviteEmail', ada_email), null)->>'roomId')::uuid;
  perform pg_temp.as_user(outsider);
  outsider_room := (public.race_action('create', null, jsonb_build_object('passage', passage, 'displayName', 'Out', 'inviteEmail', ada_email), null)->>'roomId')::uuid;
  links := pg_temp.people_of(ada);
  if links->'invites' <> jsonb_build_array(jsonb_build_object('id', lin_room, 'friendId', lin_row)) then raise exception 'Invitation links were %.', links; end if;
  -- The host isn't invited by its own room, and nobody else sees Ada's.
  if jsonb_array_length(pg_temp.people_of(lin)->'invites') <> 0 or jsonb_array_length(pg_temp.people_of(outsider)->'invites') <> 0 then
    raise exception 'An invitation was linked for someone it wasn''t sent to.';
  end if;

  -- Once Ada joins, the invitation is no longer open, and drops out exactly as race_action's list does.
  perform pg_temp.as_user(ada);
  perform public.race_action('join', lin_room, jsonb_build_object('displayName', 'Ada'), null);
  links := pg_temp.people_of(ada);
  if jsonb_array_length(links->'invites') <> 0 then raise exception 'A joined invitation stayed linked: %.', links; end if;

  -- Ghost challenges either way between friends link; one between two other people never shows.
  from_lin := pg_temp.challenge(lin, ada);
  to_lin := pg_temp.challenge(ada, lin);
  stranger := pg_temp.challenge(lin, outsider);
  perform pg_temp.challenge(outsider, ada);
  links := pg_temp.people_of(ada);
  if (select count(*) from jsonb_array_elements(links->'challenges')) <> 2
    or not links->'challenges' @> jsonb_build_array(jsonb_build_object('id', from_lin, 'friendId', lin_row), jsonb_build_object('id', to_lin, 'friendId', lin_row)) then
    raise exception 'Challenge links were %.', links;
  end if;
  if links::text like '%' || stranger::text || '%' then raise exception 'Another pair''s challenge was linked.'; end if;
  links := pg_temp.people_of(outsider);
  if links <> '{"friends":[],"invites":[],"challenges":[]}'::jsonb then raise exception 'The outsider read %.', links; end if;

  -- Removing Lin from the list unlinks everything of Lin's; deleting Lin's account takes the rest with it.
  delete from race_private.friends where id = lin_row;
  links := pg_temp.people_of(ada);
  if links <> '{"friends":[],"invites":[],"challenges":[]}'::jsonb then raise exception 'A removed friend stayed linked: %.', links; end if;
  insert into race_private.friends (owner_id, friend_id, name) values (ada, lin, 'Lin') returning id into lin_row;
  delete from auth.users where id = lin;
  links := pg_temp.people_of(ada);
  if links <> '{"friends":[],"invites":[],"challenges":[]}'::jsonb then raise exception 'A deleted account stayed linked: %.', links; end if;
end $people$;
rollback;
