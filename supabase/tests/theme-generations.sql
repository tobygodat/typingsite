-- Theme generation's daily limit (20261022120000_theme_generations.sql). Runs inside a transaction and
-- rolls everything back.
begin;

do $$
declare
  ada uuid := gen_random_uuid();
  bob uuid := gen_random_uuid();
  n integer;
  denied boolean;
begin
  insert into auth.users (id, email) values (ada, 'ada@example.com'), (bob, 'bob@example.com');

  -- Twenty a day, then refused without counting; another account has its own twenty.
  for n in 1..20 loop
    if not public.claim_theme_generation(ada, 20) then raise exception 'claim % refused under the limit', n; end if;
  end loop;
  if public.claim_theme_generation(ada, 20) then raise exception 'the 21st claim passed'; end if;
  if (select count from public.theme_generations where user_id = ada) <> 20 then raise exception 'a refused claim counted'; end if;
  if not public.claim_theme_generation(bob, 20) then raise exception 'limits are per account'; end if;

  -- A new day starts at one, and drops the caller's earlier days.
  update public.theme_generations set day = day - 1 where user_id = ada;
  if not public.claim_theme_generation(ada, 20) then raise exception 'yesterday''s count blocked today'; end if;
  if (select array_agg(count) from public.theme_generations where user_id = ada) <> array[1] then raise exception 'earlier days stay'; end if;

  -- Only the service role reaches it: browsers can neither call the claim nor read the counts.
  foreach n in array array[1, 2] loop
    perform set_config('role', case n when 1 then 'anon' else 'authenticated' end, true);
    denied := false;
    begin
      perform public.claim_theme_generation(ada, 1000);
    exception when insufficient_privilege then denied := true;
    end;
    if not denied then raise exception 'a browser role can claim'; end if;
    denied := false;
    begin
      perform count(*) from public.theme_generations;
    exception when insufficient_privilege then denied := true;
    end;
    if not denied then raise exception 'a browser role can read the counts'; end if;
    perform set_config('role', 'none', true);
  end loop;

  -- The counts go with the account.
  delete from auth.users where id = ada;
  if exists (select 1 from public.theme_generations where user_id = ada) then raise exception 'counts outlive the account'; end if;
end $$;

rollback;
