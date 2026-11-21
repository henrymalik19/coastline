/*
 * Security fixes from the pre-launch audit (2026-11-21).
 *
 * 1. Invites wait for the invited person: signing in no longer joins a plan on its own. They see the
 *    invite and Accept or Decline it, and a member can leave. "Shared by" is the inviter's email from
 *    their account, set by the server (the inviter can't write it). A pending invite no longer blocks
 *    other invites to the same email: one plan at a time is checked when accepting.
 * 2. Deleting an account is refused while bank connections remain (the app disconnects them at Plaid
 *    first; deleting without that would leave Plaid access, and billing, running).
 * 3. Two-step sign-in covers the tables added since it was introduced, saving plan versions, and the
 *    admin functions.
 * 4. Signed-out visitors have no table rights on the newer tables (row level security already
 *    refused them).
 */

-- ---------- 1. invites: accept, decline, leave ----------

-- one active membership per person; pending invites to the same email may come from several plans
drop index if exists public.plan_members_one_plan;
create unique index if not exists plan_member_one_plan on public.plan_member (member_id) where member_id is not null;

-- "Shared by": the inviter's own email, from their account
create or replace function public.plan_member_owner_email() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.owner_email := (select lower(u.email) from auth.users u where u.id = new.plan_id);
  else
    new.owner_email := old.owner_email;
  end if;
  return new;
end;
$$;
revoke all on function public.plan_member_owner_email() from public, anon, authenticated;
drop trigger if exists plan_member_owner_email on public.plan_member;
create trigger plan_member_owner_email before insert or update on public.plan_member
  for each row execute function public.plan_member_owner_email();
-- invites made before: from the account, too
update public.plan_member m set owner_email = lower(u.email) from auth.users u where u.id = m.plan_id and m.owner_email is distinct from lower(u.email);

-- your memberships (accepted). Signing in no longer accepts anything.
create or replace function public.member_join() returns setof public.plan_member
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
begin
  if me is null or not public.aal_ok() then
    return;
  end if;
  return query select * from public.plan_member where member_id = me;
end;
$$;

-- invites waiting for you: who it's from and what they share
create or replace function public.my_invites()
returns table (plan_id uuid, owner_email text, role text, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
declare
  mail text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  if auth.uid() is null or mail = '' or not public.aal_ok() then
    return;
  end if;
  return query
    select m.plan_id, m.owner_email, m.role, m.created_at
    from public.plan_member m
    where m.email = mail and m.member_id is null
    order by m.created_at desc;
end;
$$;
revoke all on function public.my_invites() from public, anon;
grant execute on function public.my_invites() to authenticated;

-- accept one invite (you can be in one shared plan at a time)
create or replace function public.accept_invite(p uuid) returns setof public.plan_member
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  mail text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  if me is null or mail = '' then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;
  if not public.aal_ok() then
    raise exception 'Enter the code from your authenticator app first.' using errcode = '42501';
  end if;
  if exists (select 1 from public.plan_member where member_id = me and plan_id <> p) then
    raise exception 'Leave the plan you share now before joining another.' using errcode = '23505';
  end if;
  perform set_config('coastline.joining', '1', true);
  update public.plan_member set member_id = me, joined_at = coalesce(joined_at, now())
    where plan_id = p and email = mail and member_id is null;
  perform set_config('coastline.joining', '', true);
  if not found then
    raise exception 'That invite isn''t there anymore.' using errcode = 'P0002';
  end if;
  return query select * from public.plan_member where member_id = me;
end;
$$;
revoke all on function public.accept_invite(uuid) from public, anon;
grant execute on function public.accept_invite(uuid) to authenticated;

-- decline an invite: it's removed (the inviter sees it's gone)
create or replace function public.decline_invite(p uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  mail text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  if auth.uid() is null or mail = '' or not public.aal_ok() then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;
  delete from public.plan_member where plan_id = p and email = mail and member_id is null;
end;
$$;
revoke all on function public.decline_invite(uuid) from public, anon;
grant execute on function public.decline_invite(uuid) to authenticated;

-- leave the plan you share (your own plan, in your account, is untouched)
create or replace function public.leave_plan() returns void
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
begin
  if me is null or not public.aal_ok() then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;
  delete from public.plan_member where member_id = me;
end;
$$;
revoke all on function public.leave_plan() from public, anon;
grant execute on function public.leave_plan() to authenticated;

-- ---------- 2. no account deletion while banks are connected ----------
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
  if exists (select 1 from public.plaid_items where plan_id = me) then
    raise exception 'Disconnect your banks first, so access to them ends.' using errcode = '55000';
  end if;
  delete from auth.users where id = me;
end;
$$;

-- ---------- 3. two-step sign-in on the newer tables and functions ----------
do $$
declare
  t text;
begin
  for t in
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
      and not exists (select 1 from pg_policy p where p.polrelid = c.oid and p.polname = 'two-step sign-in')
  loop
    execute format(
      'create policy "two-step sign-in" on public.%I as restrictive for all to authenticated using ((select public.aal_ok())) with check ((select public.aal_ok()))',
      t);
  end loop;
end;
$$;

-- admins too must finish the second step (every admin function asks is_admin)
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.app_admin where user_id = auth.uid()) and public.aal_ok();
$$;

create or replace function public.save_plan_version(p uuid, p_note text, p_snapshot jsonb default null) returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  snap jsonb;
  vid bigint;
begin
  if not public.can_use_plan(p) or not public.aal_ok() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_snapshot is not null and (jsonb_typeof(p_snapshot) <> 'object' or jsonb_typeof(p_snapshot -> 'plan') <> 'object' or pg_column_size(p_snapshot) > 2000000) then
    raise exception 'not a plan' using errcode = '22023';
  end if;
  snap := coalesce(p_snapshot, public.get_plan(p));
  if snap is null then
    return null;
  end if;
  insert into public.plan_version (plan_id, note, snapshot) values (p, left(p_note, 200), snap) returning id into vid;
  perform public.prune_plan_versions(p);
  return vid;
end;
$$;

-- ---------- 4. no table rights for signed-out visitors on the newer tables ----------
revoke all on public.plan_version, public.budget_opening, public.budget_card_debt, public.ynab_import, public.app_admin, public.diagnostic_report from anon;
