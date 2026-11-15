-- Two-step sign-in (an authenticator app, optional).
-- Once someone turns it on, a sign-in that has only the emailed code (aal1) can't read or change
-- anything: every table, and the functions that act with elevated rights, need the second step (aal2).
-- People who haven't turned it on are unaffected.

-- true when this sign-in is allowed to use data: it finished the second step, or there's no second step
create function public.aal_ok() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
    or not exists (select 1 from auth.mfa_factors where user_id = (select auth.uid()) and status = 'verified');
$$;
revoke all on function public.aal_ok() from public, anon;
grant execute on function public.aal_ok() to authenticated;

-- every table with row level security: a restrictive rule on top of the existing ones
-- ((select ...) runs the check once per query, not once per row)
do $$
declare
  t text;
begin
  for t in
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
  loop
    execute format(
      'create policy "two-step sign-in" on public.%I as restrictive for all to authenticated using ((select public.aal_ok())) with check ((select public.aal_ok()))',
      t);
  end loop;
end;
$$;

-- deleting the account needs the second step too
create or replace function public.delete_my_account() returns void
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'not signed in';
  end if;
  if not public.aal_ok() then
    raise exception 'Enter the code from your authenticator app first.';
  end if;
  delete from auth.users where id = me;
end;
$$;

-- so does joining a plan you were invited to
create or replace function public.member_join() returns setof public.plan_member
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  mail text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  if me is null or mail = '' or not public.aal_ok() then
    return;
  end if;
  if exists (select 1 from public.plan_member where email = mail and member_id is null) then
    perform set_config('coastline.joining', '1', true);
    update public.plan_member set member_id = me, joined_at = coalesce(joined_at, now())
      where email = mail and member_id is null;
    perform set_config('coastline.joining', '', true);
  end if;
  return query select * from public.plan_member where member_id = me;
end;
$$;
