-- Challenge's list of people (TOB-420). It stores nothing and changes no existing function: it adds one read,
-- public.race_people, that ties what a signed-in account already sees elsewhere to its own friend rows.
--   friends:    each friend row saved from a race (an account) with the pair's tally, [mine, theirs], once the two
--               have raced; the same counts a finished race between them shows.
--   invites:    each open invitation to this account whose host is an account on its friend list, with that row's id.
--   challenges: each ghost challenge this account sent or received whose other party is an account on its friend
--               list, with that row's id.
-- Only friend rows that hold an account are linked. A friend saved by typed email is never matched to an account
-- here, so the reply never reveals whether an email belongs to one, as race invitations and ghost sends don't.
-- The browser works without this function: until it is applied, rows show no tally and records stay apart.

create function race_private.people(p_viewer uuid)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'friends', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'tally',
        case when f.owner_id = h.a_id then jsonb_build_array(h.a_wins, h.b_wins) else jsonb_build_array(h.b_wins, h.a_wins) end) order by f.id)
      from race_private.friends f
      join race_private.head_to_head h on h.a_id = least(f.owner_id, f.friend_id) and h.b_id = greatest(f.owner_id, f.friend_id)
      where f.owner_id = p_viewer and f.friend_id is not null), '[]'::jsonb),
    -- The invitations race_action's 'invites' lists, and only those.
    'invites', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'friendId', f.id) order by r.id)
      from race_private.rooms r
      join race_private.players p on p.room_id = r.id and p.user_id is distinct from p_viewer
      join race_private.friends f on f.owner_id = p_viewer and f.friend_id = p.user_id
      where r.invited_id = p_viewer and r.status = 'waiting' and r.expires_at > clock_timestamp()
        and not exists(select 1 from race_private.players s where s.room_id = r.id and s.user_id = p_viewer
          and s.last_seen > '-infinity'::timestamptz)), '[]'::jsonb),
    'challenges', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'friendId', f.id) order by c.id)
      from race_private.challenges c
      join race_private.friends f on f.owner_id = p_viewer
        and f.friend_id = case when c.sender_id = p_viewer then c.recipient_id else c.sender_id end
      where c.sender_id = p_viewer or c.recipient_id = p_viewer), '[]'::jsonb))
$$;
revoke all on function race_private.people(uuid) from public, anon, authenticated;

create function race_private.people_action()
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Sign in to see the people you race.'; end if;
  return race_private.people(auth.uid());
end $$;
revoke all on function race_private.people_action() from public, anon, authenticated;
grant execute on function race_private.people_action() to authenticated;

create function public.race_people()
returns jsonb language sql security invoker set search_path = '' as $$
  select race_private.people_action()
$$;
revoke all on function public.race_people() from public, anon, authenticated;
grant execute on function public.race_people() to authenticated;
