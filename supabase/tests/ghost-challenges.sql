-- Ghost challenge checks. Runs inside a transaction and rolls everything back.
-- The expected scores (78 wpm, 98% for the sample run, and the half-way rounding cases) are pinned in
-- tests/ghost-race.test.js too, so the database replay and the browser replay are held to the same numbers.
begin;
do $smoke$
declare
  ada uuid := gen_random_uuid();
  lin uuid := gen_random_uuid();
  kim uuid := gen_random_uuid();
  outsider uuid := gen_random_uuid();
  mia uuid := gen_random_uuid();
  noa uuid := gen_random_uuid();
  passage text := 'The quick brown fox jumps over the lazy dog.';
  long_passage text := 'the quick brown fox jumps over the lazy dog and keeps on running past the old mill and the river';
  -- One slip ("x", then a deletion) on the way to the end: 45 insertions, 44 of them right.
  keys text := 'The quick bx' || chr(8) || 'rown fox jumps over the lazy dog.';
  relaxed_keys text := 'The quick brown fox jumps over the lazy dog!';
  trace jsonb;
  friend_lin uuid;
  friend_kim uuid;
  friend_nobody uuid;
  outsider_friend uuid;
  friend_noa uuid;
  sent jsonb;
  view jsonb;
  listed jsonb;
  challenge uuid;
  viewer uuid;
  request uuid := gen_random_uuid();
  denied boolean;
  n integer;
begin
  insert into auth.users (id, email, email_confirmed_at) values
    (ada, 'ghost-ada-' || ada || '@example.invalid', now()),
    (lin, 'ghost-lin-' || lin || '@example.invalid', now()),
    (kim, 'ghost-kim-' || kim || '@example.invalid', now()),
    (outsider, 'ghost-out-' || outsider || '@example.invalid', now());
  -- Ada's friends: an account she raced, an email that has an account, an email that has none.
  insert into race_private.friends (owner_id, friend_id, name) values (ada, lin, 'Lin from work') returning id into friend_lin;
  insert into race_private.friends (owner_id, email, name) values (ada, 'ghost-kim-' || kim || '@example.invalid', 'Kim') returning id into friend_kim;
  insert into race_private.friends (owner_id, email, name) values (ada, 'nobody-' || ada || '@example.invalid', 'Nobody') returning id into friend_nobody;
  insert into race_private.friends (owner_id, friend_id, name) values (outsider, lin, 'Lin') returning id into outsider_friend;

  -- Browsers get no writes, no hidden columns and no helpers; guests get nothing at all.
  if has_table_privilege('anon', 'race_private.challenges', 'SELECT')
    or has_table_privilege('authenticated', 'race_private.challenges', 'INSERT')
    or has_table_privilege('authenticated', 'race_private.challenges', 'UPDATE')
    or has_table_privilege('authenticated', 'race_private.challenges', 'DELETE')
    or has_column_privilege('authenticated', 'race_private.challenges', 'sender_id', 'SELECT')
    or has_column_privilege('authenticated', 'race_private.challenges', 'recipient_id', 'SELECT')
    or has_column_privilege('authenticated', 'race_private.challenges', 'recipient_name', 'SELECT')
    or has_function_privilege('anon', 'public.challenge_action(text,uuid,jsonb)', 'EXECUTE')
    or has_function_privilege('authenticated', 'race_private.trace_score(text,jsonb,integer,boolean)', 'EXECUTE')
    or has_function_privilege('authenticated', 'race_private.challenge_view(race_private.challenges,uuid)', 'EXECUTE')
    or not has_function_privilege('authenticated', 'public.challenge_action(text,uuid,jsonb)', 'EXECUTE') then
    raise exception 'Challenge storage, columns or helpers are exposed.';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'race_private.challenges'::regclass) then raise exception 'Challenges table has no RLS.'; end if;

  trace := jsonb_build_object('v', 1, 'k', keys,
    't', (select jsonb_agg(case when i = 1 then 0 else 150 end) from generate_series(1, char_length(keys)) i), 'e', 6750);

  -- The replay matches metric v1: 44 correct characters kept over 6.75 s, 44 right of 45 insertions.
  view := race_private.trace_score(passage, trace, null, false);
  if view->>'wpm' <> '78' or view->>'accuracy' <> '98' or view->>'correct' <> '44' or not (view->>'finished')::boolean then
    raise exception 'Trace replay disagrees with metric v1: %', view;
  end if;
  -- Relaxed runs finish at the passage length; stop-on-error runs only on the exact text.
  view := race_private.trace_score(passage, jsonb_build_object('v', 1, 'k', relaxed_keys,
    't', (select jsonb_agg(100) from generate_series(1, 44)), 'e', 4400), null, true);
  if not (view->>'finished')::boolean or view->>'correct' <> '43' then raise exception 'Relaxed finish misread: %', view; end if;
  if (race_private.trace_score(passage, jsonb_build_object('v', 1, 'k', relaxed_keys,
    't', (select jsonb_agg(100) from generate_series(1, 44)), 'e', 4400), null, false)->>'finished')::boolean then
    raise exception 'A stop-on-error run finished on the wrong text.';
  end if;
  -- A key past the end of the passage is ignored, as in the browser.
  if race_private.trace_score('abcdefghij', '{"v":1,"k":"abcdefghijk","t":[0,1,1,1,1,1,1,1,1,1,1],"e":10}', null, false)->>'accuracy' <> '100' then
    raise exception 'A key past the passage counted.';
  end if;
  -- Half-way values round as the browser does (pinned in tests/ghost-race.test.js too): 101 characters
  -- in 24 s and 105 in 20.16 s are just under .5 in double precision, as is 23 right of 40.
  view := race_private.trace_score(repeat('a', 101), jsonb_build_object('v', 1, 'k', repeat('a', 101),
    't', (select jsonb_agg(case when i = 1 then 0 else 200 end) from generate_series(1, 101) i), 'e', 24000), null, false);
  if view->>'wpm' <> '50' then raise exception 'Half-way wpm rounds unlike the browser: %', view; end if;
  view := race_private.trace_score(repeat('a', 105), jsonb_build_object('v', 1, 'k', repeat('a', 105),
    't', (select jsonb_agg(case when i = 1 then 0 else 190 end) from generate_series(1, 105) i), 'e', 20160), null, false);
  if view->>'wpm' <> '62' then raise exception 'Half-way wpm rounds unlike the browser: %', view; end if;
  view := race_private.trace_score(repeat('a', 40), jsonb_build_object('v', 1, 'k', repeat('a', 23) || repeat('b', 17),
    't', (select jsonb_agg(100) from generate_series(1, 40)), 'e', 4000), null, true);
  if view->>'accuracy' <> '57' or view->>'wpm' <> '69' then raise exception 'Half-way accuracy rounds unlike the browser: %', view; end if;

  -- Guests cannot send, list or race.
  perform set_config('request.jwt.claim.sub', '', true);
  denied := false;
  begin perform public.challenge_action('list', null, '{}'); exception when others then denied := true; end;
  if not denied then raise exception 'A guest listed challenges.'; end if;

  perform set_config('request.jwt.claim.sub', ada::text, true);
  -- Only someone on the sender's own friend list.
  denied := false;
  begin perform public.challenge_action('send', null, jsonb_build_object('requestId', gen_random_uuid(), 'friendId', outsider_friend, 'displayName', 'Ada',
    'passage', passage, 'trace', trace));
  exception when others then denied := true; end;
  if not denied then raise exception 'Sent with another account''s friend.'; end if;
  -- Unfinished, implausibly fast, unreadable, oversized or mistimed runs are refused.
  foreach view in array array[
    jsonb_build_object('v', 1, 'k', 'The quick', 't', (select jsonb_agg(150) from generate_series(1, 9)), 'e', 1350),
    jsonb_build_object('v', 1, 'k', keys, 't', (select jsonb_agg(0) from generate_series(1, char_length(keys))), 'e', 100),
    jsonb_build_object('v', 1, 'k', 'The' || chr(9) || 'quick', 't', (select jsonb_agg(150) from generate_series(1, 9)), 'e', 1350),
    jsonb_build_object('v', 1, 'k', repeat('a', 6001), 't', (select jsonb_agg(100) from generate_series(1, 6001)), 'e', 600000),
    jsonb_build_object('v', 1, 'k', keys, 't', (select jsonb_agg(150) from generate_series(1, char_length(keys) - 1)), 'e', 6750),
    jsonb_build_object('v', 2, 'k', keys, 't', trace->'t', 'e', 6750)
  ] loop
    denied := false;
    begin perform public.challenge_action('send', null, jsonb_build_object('requestId', gen_random_uuid(), 'friendId', friend_lin, 'displayName', 'Ada',
      'passage', passage, 'trace', view));
    exception when others then denied := true; end;
    if not denied then raise exception 'Sent an invalid run: %', left(view::text, 120); end if;
  end loop;
  denied := false;
  begin perform public.challenge_action('send', null, jsonb_build_object('requestId', gen_random_uuid(), 'friendId', friend_lin, 'displayName', 'Ada',
    'passage', long_passage, 'duration', 15, 'trace', jsonb_build_object('v', 1, 'k', 'the', 't', '[0,200,200]'::jsonb, 'e', 14000)));
  exception when others then denied := true; end;
  if not denied then raise exception 'A timed run off its clock was sent.'; end if;
  denied := false;
  begin perform public.challenge_action('send', null, jsonb_build_object('requestId', gen_random_uuid(), 'friendId', friend_lin, 'displayName', 'Ada',
    'passage', passage, 'trace', trace || jsonb_build_object('pad', repeat('x', 70000))));
  exception when others then denied := true; end;
  if not denied then raise exception 'An oversized trace was sent.'; end if;

  sent := public.challenge_action('send', null, jsonb_build_object('requestId', request, 'friendId', friend_lin, 'displayName', 'Ada',
    'passage', passage, 'conditions', '{"mode":"words","count":10,"correctionPolicy":"mandatory"}'::jsonb, 'trace', trace));
  challenge := (sent->>'id')::uuid;
  -- A retry with the same request id (after a lost reply) gets the same challenge back: one row.
  view := public.challenge_action('send', null, jsonb_build_object('requestId', request, 'friendId', friend_lin, 'displayName', 'Ada',
    'passage', passage, 'conditions', '{"mode":"words","count":10,"correctionPolicy":"mandatory"}'::jsonb, 'trace', trace));
  if view <> sent or (select count(*) from race_private.challenges where sender_id = ada) <> 1 then
    raise exception 'A repeated send was stored twice: %', view;
  end if;
  denied := false;
  begin perform public.challenge_action('send', null, jsonb_build_object('requestId', 'not-a-uuid', 'friendId', friend_lin, 'displayName', 'Ada',
    'passage', passage, 'trace', trace));
  exception when others then denied := true; end;
  if not denied then raise exception 'A send without a request id was accepted.'; end if;
  if sent->>'role' <> 'sent' or sent->>'name' <> 'Lin from work' or sent->>'status' <> 'open' or sent->'sender'->>'wpm' <> '78'
    or sent ? 'passage' or sent ? 'trace' or sent::text like '%' || lin || '%' or sent::text like '%' || ada || '%' then
    raise exception 'Sent challenge view is wrong or exposes identities: %', sent;
  end if;
  if (select recipient_id from race_private.challenges where id = challenge) <> lin
    or (select expires_at - created_at from race_private.challenges where id = challenge) <> interval '7 days' then
    raise exception 'Challenge was not addressed to Lin for seven days.';
  end if;

  -- Lin sees it under Ada's chosen name, never under Ada's label for Lin.
  perform set_config('request.jwt.claim.sub', lin::text, true);
  listed := public.challenge_action('list', null, '{}');
  if jsonb_array_length(listed) <> 1 or listed->0->>'role' <> 'received' or listed->0->>'name' <> 'Ada'
    or listed::text like '%Lin from work%' or listed->0 ? 'trace' then
    raise exception 'Recipient list is wrong: %', listed;
  end if;
  view := public.challenge_action('get', challenge, '{}');
  if view->>'passage' <> passage or view->'trace' <> trace or view::text like '%Lin from work%' then raise exception 'Recipient cannot read the run to race.'; end if;

  -- Nobody else can see, read or answer it; the sender cannot answer their own.
  perform set_config('request.jwt.claim.sub', outsider::text, true);
  if jsonb_array_length(public.challenge_action('list', null, '{}')) <> 0 then raise exception 'Outsider listed a challenge.'; end if;
  denied := false;
  begin perform public.challenge_action('get', challenge, '{}'); exception when others then denied := true; end;
  if not denied then raise exception 'Outsider read a challenge.'; end if;
  denied := false;
  begin perform public.challenge_action('finish', challenge, jsonb_build_object('trace', trace)); exception when others then denied := true; end;
  if not denied then raise exception 'Outsider answered a challenge.'; end if;
  perform set_config('request.jwt.claim.sub', ada::text, true);
  denied := false;
  begin perform public.challenge_action('finish', challenge, jsonb_build_object('trace', trace)); exception when others then denied := true; end;
  if not denied then raise exception 'Sender answered their own challenge.'; end if;

  -- Row-level security: each party reads the row directly, nobody else does, and no one writes.
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', outsider::text, true);
  if (select count(*) from race_private.challenges) <> 0 then raise exception 'RLS let an outsider read a challenge.'; end if;
  perform set_config('request.jwt.claim.sub', lin::text, true);
  if (select count(*) from race_private.challenges where id = challenge and sender_name = 'Ada') <> 1 then raise exception 'RLS hid the challenge from its recipient.'; end if;
  perform set_config('request.jwt.claim.sub', ada::text, true);
  if (select count(*) from race_private.challenges where id = challenge) <> 1 then raise exception 'RLS hid the challenge from its sender.'; end if;
  denied := false;
  begin perform recipient_name from race_private.challenges; exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'The sender''s label for the friend is readable.'; end if;
  denied := false;
  begin update race_private.challenges set sender_wpm = 300 where id = challenge; exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'A browser role could rewrite a score.'; end if;
  execute 'reset role';
  execute 'set local role anon';
  denied := false;
  begin perform count(*) from race_private.challenges; exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'Anon read challenges.'; end if;
  execute 'reset role';

  -- Lin races it: an unfinished run is refused, a finished one is scored once and stays final.
  perform set_config('request.jwt.claim.sub', lin::text, true);
  denied := false;
  begin perform public.challenge_action('finish', challenge, jsonb_build_object('trace',
    jsonb_build_object('v', 1, 'k', 'The quick', 't', (select jsonb_agg(150) from generate_series(1, 9)), 'e', 1350)));
  exception when others then denied := true; end;
  if not denied then raise exception 'An unfinished reply was accepted.'; end if;
  view := public.challenge_action('finish', challenge, jsonb_build_object('trace', jsonb_build_object('v', 1, 'k', passage,
    't', (select jsonb_agg(case when i = 1 then 0 else 120 end) from generate_series(1, 44) i), 'e', 5160)));
  if view->>'status' <> 'done' or view->'result'->>'wpm' <> '102' or view->'result'->>'accuracy' <> '100'
    or view->'result'->>'elapsedMs' <> '5160' or view->'sender'->>'elapsedMs' <> '6750' then
    raise exception 'Reply was not scored from its trace: %', view;
  end if;
  -- A repeat finish (a retry after a lost reply) gets the stored result back, even with another trace
  -- or after expiry; the first finish stands and nobody else can finish it.
  sent := view;
  view := public.challenge_action('finish', challenge, jsonb_build_object('trace', trace));
  if view <> sent then raise exception 'A repeat finish did not return the stored result: %', view; end if;
  update race_private.challenges set expires_at = now() - interval '1 minute' where id = challenge;
  view := public.challenge_action('finish', challenge, jsonb_build_object('trace', trace));
  if view - 'expiresAt' <> sent - 'expiresAt' then raise exception 'A repeat finish after expiry did not return the stored result: %', view; end if;
  update race_private.challenges set expires_at = created_at + interval '7 days' where id = challenge;
  if (select (recipient_wpm, recipient_accuracy, recipient_elapsed_ms, recipient_correct) from race_private.challenges where id = challenge)
    is distinct from (102, 100, 5160, 44) then
    raise exception 'A repeat finish changed the stored result.';
  end if;
  foreach viewer in array array[outsider, ada] loop
    perform set_config('request.jwt.claim.sub', viewer::text, true);
    denied := false;
    begin perform public.challenge_action('finish', challenge, jsonb_build_object('trace', trace)); exception when others then denied := true; end;
    if not denied then raise exception 'Someone other than the recipient finished an answered challenge.'; end if;
  end loop;
  perform set_config('request.jwt.claim.sub', ada::text, true);
  listed := public.challenge_action('list', null, '{}');
  if listed->0->>'status' <> 'done' or listed->0->'result'->>'wpm' <> '102' then raise exception 'Sender did not see the result: %', listed; end if;

  -- A friend saved by email reaches their account; one without an account is accepted and goes nowhere.
  sent := public.challenge_action('send', null, jsonb_build_object('requestId', gen_random_uuid(), 'friendId', friend_kim, 'displayName', 'Ada', 'passage', passage, 'trace', trace));
  perform set_config('request.jwt.claim.sub', kim::text, true);
  if public.challenge_action('list', null, '{}')->0->>'id' <> sent->>'id' then raise exception 'Email friend did not receive the challenge.'; end if;
  perform set_config('request.jwt.claim.sub', ada::text, true);
  sent := public.challenge_action('send', null, jsonb_build_object('requestId', gen_random_uuid(), 'friendId', friend_nobody, 'displayName', 'Ada', 'passage', passage, 'trace', trace));
  if sent->>'status' <> 'open' or (select recipient_id from race_private.challenges where id = (sent->>'id')::uuid) is not null then
    raise exception 'An unknown email was not handled like a typed invitation.';
  end if;

  -- Timed runs keep their clock: the finish line is the time, not the passage.
  sent := public.challenge_action('send', null, jsonb_build_object('requestId', gen_random_uuid(), 'friendId', friend_lin, 'displayName', 'Ada', 'passage', long_passage,
    'duration', 15, 'conditions', '{"mode":"time","duration":15,"correctionPolicy":"relaxed"}'::jsonb,
    'trace', jsonb_build_object('v', 1, 'k', 'the quick', 't', (select jsonb_agg(200) from generate_series(1, 9)), 'e', 15000)));
  if sent->>'duration' <> '15' or sent->'sender'->>'wpm' <> '7' then raise exception 'Timed challenge misread: %', sent; end if;
  perform set_config('request.jwt.claim.sub', lin::text, true);
  view := public.challenge_action('finish', (sent->>'id')::uuid, jsonb_build_object('trace',
    jsonb_build_object('v', 1, 'k', 'the quick brown', 't', (select jsonb_agg(200) from generate_series(1, 15)), 'e', 15000)));
  if view->'result'->>'correct' <> '15' then raise exception 'Timed reply misread: %', view; end if;

  -- An expired challenge cannot be answered and lists as expired.
  perform set_config('request.jwt.claim.sub', ada::text, true);
  sent := public.challenge_action('send', null, jsonb_build_object('requestId', gen_random_uuid(), 'friendId', friend_lin, 'displayName', 'Ada', 'passage', passage, 'trace', trace));
  update race_private.challenges set expires_at = now() - interval '1 minute' where id = (sent->>'id')::uuid;
  perform set_config('request.jwt.claim.sub', lin::text, true);
  denied := false;
  begin perform public.challenge_action('finish', (sent->>'id')::uuid, jsonb_build_object('trace', trace)); exception when others then denied := true; end;
  if not denied then raise exception 'An expired challenge was answered.'; end if;
  if (select c->>'status' from jsonb_array_elements(public.challenge_action('list', null, '{}')) c where c->>'id' = sent->>'id') <> 'expired' then
    raise exception 'Expired challenge did not list as expired.';
  end if;

  -- Old results are cleaned up when anyone sends; quotas hold per sender.
  update race_private.challenges set expires_at = now() - interval '31 days' where id = (sent->>'id')::uuid;
  perform set_config('request.jwt.claim.sub', ada::text, true);
  perform public.challenge_action('send', null, jsonb_build_object('requestId', gen_random_uuid(), 'friendId', friend_lin, 'displayName', 'Ada', 'passage', passage, 'trace', trace));
  if exists(select 1 from race_private.challenges where id = (sent->>'id')::uuid) then raise exception 'A month-old challenge was not cleaned up.'; end if;
  n := (select count(*) from race_private.challenges where sender_id = ada and created_at > now() - interval '1 hour');
  for i in n + 1 .. 20 loop
    perform public.challenge_action('send', null, jsonb_build_object('requestId', gen_random_uuid(), 'friendId', friend_lin, 'displayName', 'Ada', 'passage', passage, 'trace', trace));
  end loop;
  denied := false;
  begin perform public.challenge_action('send', null, jsonb_build_object('requestId', gen_random_uuid(), 'friendId', friend_lin, 'displayName', 'Ada', 'passage', passage, 'trace', trace));
  exception when others then denied := true; end;
  if not denied then raise exception 'Hourly challenge quota did not hold.'; end if;
  -- Repeating a stored request is not a new send: with the quota full it still gets its challenge back.
  select id, request_id into challenge, request from race_private.challenges where sender_id = ada order by created_at desc limit 1;
  view := public.challenge_action('send', null, jsonb_build_object('requestId', request, 'friendId', friend_lin, 'displayName', 'Ada', 'passage', passage, 'trace', trace));
  if view->>'id' <> challenge::text or (select count(*) from race_private.challenges where sender_id = ada and created_at > now() - interval '1 hour') <> 20 then
    raise exception 'A repeated send used the quota: %', view;
  end if;
  update race_private.challenges set created_at = now() - interval '2 hours' where sender_id = ada;
  n := (select count(*) from race_private.challenges where sender_id = ada and completed_at is null and expires_at > now());
  for i in n + 1 .. 30 loop
    perform public.challenge_action('send', null, jsonb_build_object('requestId', gen_random_uuid(), 'friendId', friend_lin, 'displayName', 'Ada', 'passage', passage, 'trace', trace));
  end loop;
  denied := false;
  begin perform public.challenge_action('send', null, jsonb_build_object('requestId', gen_random_uuid(), 'friendId', friend_lin, 'displayName', 'Ada', 'passage', passage, 'trace', trace));
  exception when others then denied := true; end;
  if not denied then raise exception 'Open challenge cap did not hold.'; end if;

  -- Removing a friend stops new challenges to them.
  perform public.race_action('unfriend', null, jsonb_build_object('friendId', friend_kim), null);
  denied := false;
  begin perform public.challenge_action('send', null, jsonb_build_object('requestId', gen_random_uuid(), 'friendId', friend_kim, 'displayName', 'Ada', 'passage', passage, 'trace', trace));
  exception when others then denied := true; end;
  if not denied then raise exception 'Challenged a removed friend.'; end if;

  -- The list never cuts an open race or a fresh result. Noa has an open challenge from three days ago,
  -- 55 newer ones already answered, and 60 old expired ones: all 56 recent rows arrive, the open one
  -- first, then only the newest fifty of the old ones.
  insert into auth.users (id, email, email_confirmed_at) values
    (mia, 'ghost-mia-' || mia || '@example.invalid', now()), (noa, 'ghost-noa-' || noa || '@example.invalid', now());
  insert into race_private.friends (owner_id, friend_id, name) values (mia, noa, 'Noa') returning id into friend_noa;
  perform set_config('request.jwt.claim.sub', mia::text, true);
  sent := public.challenge_action('send', null, jsonb_build_object('requestId', gen_random_uuid(), 'friendId', friend_noa, 'displayName', 'Mia', 'passage', passage, 'trace', trace));
  update race_private.challenges set created_at = now() - interval '3 days', expires_at = now() + interval '4 days' where id = (sent->>'id')::uuid;
  insert into race_private.challenges (sender_id, request_id, recipient_id, sender_name, recipient_name, passage, sender_trace, sender_wpm,
      sender_accuracy, sender_elapsed_ms, sender_correct, recipient_wpm, recipient_accuracy, recipient_elapsed_ms, recipient_correct,
      completed_at, created_at, expires_at)
    select mia, gen_random_uuid(), noa, 'Mia', 'Noa', passage, trace, 78, 98, 6750, 44, 80, 100, 6600, 44,
      now() - interval '2 days' + i * interval '1 minute' + interval '1 hour', now() - interval '2 days' + i * interval '1 minute',
      now() + interval '5 days' + i * interval '1 minute'
    from generate_series(1, 55) i;
  insert into race_private.challenges (sender_id, request_id, recipient_id, sender_name, recipient_name, passage, sender_trace, sender_wpm,
      sender_accuracy, sender_elapsed_ms, sender_correct, created_at, expires_at)
    select mia, gen_random_uuid(), noa, 'Old ' || i, 'Old ' || i, passage, trace, 78, 98, 6750, 44,
      now() - interval '20 days' + i * interval '1 minute', now() - interval '13 days' + i * interval '1 minute'
    from generate_series(1, 60) i;
  foreach viewer in array array[noa, mia] loop
    perform set_config('request.jwt.claim.sub', viewer::text, true);
    listed := public.challenge_action('list', null, '{}');
    if listed->0->>'id' <> sent->>'id' or listed->0->>'status' <> 'open' then
      raise exception 'The open challenge was not listed first: %', left(listed::text, 300);
    end if;
    if jsonb_array_length(listed) <> 106
      or (select count(*) from jsonb_array_elements(listed) with ordinality e(c, pos) where pos between 2 and 56 and c->>'status' = 'done') <> 55
      or (select count(*) from jsonb_array_elements(listed) with ordinality e(c, pos) where pos > 56 and c->>'status' = 'expired'
        and (c->>'name') in (select 'Old ' || i from generate_series(11, 60) i)) <> 50 then
      raise exception 'The list did not keep every recent row and the newest fifty old ones: % rows', jsonb_array_length(listed);
    end if;
  end loop;

  raise notice 'Ghost challenge privacy, RLS, trace scoring, timed runs, expiry, cleanup, quota, retry and inbox list checks passed.';
end $smoke$;
rollback;
