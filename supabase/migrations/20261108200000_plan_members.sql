-- Sharing (household members): the plan's owner invites someone by email and picks which budget
-- accounts (cards) they can use. A member signs in with that email and can add, edit and delete
-- transactions on those accounts only. They never read the plan itself: the owner's device publishes
-- a small view (category names and what's available this month) into `view`.

create table public.plan_members (
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  -- the invited email, lowercase
  email text not null check (email = lower(email) and position('@' in email) > 1),
  name text,
  -- filled in the first time the member signs in
  member_id uuid references auth.users (id) on delete cascade,
  joined_at timestamptz,
  -- budget account ids (the plan's account / debt ids) the member can add transactions to
  accounts text[] not null default '{}',
  -- what the member sees: { at, month, accounts: [{ id, name, kind }], categories: [{ key, name, group, available }] }
  view jsonb,
  created_at timestamptz not null default now(),
  primary key (owner_id, email),
  constraint plan_members_view_size check (view is null or pg_column_size(view) < 64 * 1024)
);

-- someone can be a member of one plan at a time
create unique index plan_members_one_plan on public.plan_members (email);
create index plan_members_by_member on public.plan_members (member_id);

alter table public.plan_members enable row level security;

-- the owner manages their invites
create policy "plan_members: owner reads" on public.plan_members
  for select to authenticated using (owner_id = (select auth.uid()));
create policy "plan_members: owner adds" on public.plan_members
  for insert to authenticated with check (owner_id = (select auth.uid()) and member_id is null);
create policy "plan_members: owner updates" on public.plan_members
  for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy "plan_members: owner removes" on public.plan_members
  for delete to authenticated using (owner_id = (select auth.uid()));
-- a member reads their own membership (to get the view), nothing else
create policy "plan_members: member reads own" on public.plan_members
  for select to authenticated using (member_id = (select auth.uid()));

-- the owner can't attach someone else's user id to an invite; only the member's own sign-in can
create function public.plan_members_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.member_id is distinct from old.member_id and coalesce(current_setting('coastline.joining', true), '') <> '1' then
    raise exception 'member_id is set when the member signs in';
  end if;
  if new.email is distinct from old.email then
    new.member_id := null;
    new.joined_at := null;
  end if;
  return new;
end;
$$;

create trigger plan_members_guard
  before update on public.plan_members
  for each row execute function public.plan_members_guard();

-- Called by the app after sign-in: links invites for this email to this user, and returns the membership.
create function public.member_join() returns setof public.plan_members
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  mail text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  if me is null or mail = '' then
    return;
  end if;
  perform set_config('coastline.joining', '1', true);
  update public.plan_members
    set member_id = me, joined_at = coalesce(joined_at, now())
    where email = mail and (member_id is null or member_id = me);
  perform set_config('coastline.joining', '', true);
  return query select * from public.plan_members where member_id = me;
end;
$$;

revoke all on function public.member_join() from public, anon;
grant execute on function public.member_join() to authenticated;

-- ---------- transactions: members use the shared accounts ----------
-- (the owner's own policies are unchanged; a member's rows carry the owner's user_id)
create function public.shared_account(owner uuid, account text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.plan_members m
    where m.owner_id = owner and m.member_id = (select auth.uid()) and account = any (m.accounts)
  );
$$;

revoke all on function public.shared_account(uuid, text) from public, anon;
grant execute on function public.shared_account(uuid, text) to authenticated;

create policy "transactions: member reads shared accounts" on public.transactions
  for select to authenticated using (public.shared_account(user_id, account_id));
create policy "transactions: member adds to shared accounts" on public.transactions
  for insert to authenticated with check (public.shared_account(user_id, account_id) and transfer_account_id is null and source = 'manual');
create policy "transactions: member edits shared accounts" on public.transactions
  for update to authenticated
  using (public.shared_account(user_id, account_id))
  with check (public.shared_account(user_id, account_id) and transfer_account_id is null);

revoke all on public.plan_members from anon;
alter publication supabase_realtime add table public.plan_members;
