-- Full access: a household member who shares the whole plan. They read and change the owner's plan,
-- check-ins and transactions like the owner does. Only the owner manages sharing (plan_members) and
-- can delete the plan or the account. "cards" members keep the limited access from 20261108200000.

alter table public.plan_members
  add column role text not null default 'cards' check (role in ('cards', 'full')),
  -- shown to the member ("Shared by ..."); filled from the owner's sign-in when they invite
  add column owner_email text default lower(auth.jwt() ->> 'email');

-- invites made before this column existed
update public.plan_members m set owner_email = lower(u.email) from auth.users u where u.id = m.owner_id and m.owner_email is null;

create function public.full_access(owner uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.plan_members m
    where m.owner_id = owner and m.member_id = (select auth.uid()) and m.role = 'full'
  );
$$;

revoke all on function public.full_access(uuid) from public, anon;
grant execute on function public.full_access(uuid) to authenticated;

-- the plan: read and change (not create or delete)
create policy "plans: full member reads" on public.plans
  for select to authenticated using (public.full_access(user_id));
create policy "plans: full member updates" on public.plans
  for update to authenticated using (public.full_access(user_id)) with check (public.full_access(user_id));

-- check-ins
create policy "checkins: full member reads" on public.checkins
  for select to authenticated using (public.full_access(user_id));
create policy "checkins: full member adds" on public.checkins
  for insert to authenticated with check (public.full_access(user_id));
create policy "checkins: full member updates" on public.checkins
  for update to authenticated using (public.full_access(user_id)) with check (public.full_access(user_id));

-- transactions
create policy "transactions: full member reads" on public.transactions
  for select to authenticated using (public.full_access(user_id));
create policy "transactions: full member adds" on public.transactions
  for insert to authenticated with check (public.full_access(user_id));
create policy "transactions: full member updates" on public.transactions
  for update to authenticated using (public.full_access(user_id)) with check (public.full_access(user_id));
create policy "transactions: full member deletes" on public.transactions
  for delete to authenticated using (public.full_access(user_id));

-- realtime needs the whole row on delete to filter member_id; changes to a membership reach the member
alter table public.plan_members replica identity full;

-- the app now checks membership on every sync: only write when an invite is first linked, so a check
-- doesn't fire a realtime change (which would trigger another check)
create or replace function public.member_join() returns setof public.plan_members
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  mail text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  if me is null or mail = '' then
    return;
  end if;
  if exists (select 1 from public.plan_members where email = mail and member_id is null) then
    perform set_config('coastline.joining', '1', true);
    update public.plan_members set member_id = me, joined_at = coalesce(joined_at, now())
      where email = mail and member_id is null;
    perform set_config('coastline.joining', '', true);
  end if;
  return query select * from public.plan_members where member_id = me;
end;
$$;
