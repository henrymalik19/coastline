-- Admins: the people who see the app's Admin page (Settings → Admin): usage numbers and the diagnostic
-- reports people send. Added by hand (insert a user_id); there's no way to become one from the app,
-- and nobody can read or change this table from the app.
create table public.app_admin (
  user_id uuid primary key references auth.users (id) on delete cascade,
  added_at timestamptz not null default now()
);
alter table public.app_admin enable row level security;
revoke all on public.app_admin from anon, authenticated;

-- Is the signed-in person an admin? (The app shows the Admin page only then.)
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.app_admin where user_id = auth.uid());
$$;
revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

-- The latest diagnostic reports, with who sent them. Admins only.
create or replace function public.admin_reports(p_limit int default 50)
returns table (id uuid, created_at timestamptz, email text, note text, report jsonb)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then
    raise exception 'Only admins can see this.' using errcode = '42501';
  end if;
  return query
    select r.id, r.created_at, u.email::text, r.note, r.report
    from public.diagnostic_report r left join auth.users u on u.id = r.user_id
    order by r.created_at desc
    limit least(greatest(coalesce(p_limit, 50), 1), 200);
end;
$$;
revoke all on function public.admin_reports(int) from public, anon;
grant execute on function public.admin_reports(int) to authenticated;

-- Remove a report once it's dealt with. Admins only.
create or replace function public.admin_delete_report(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then
    raise exception 'Only admins can do this.' using errcode = '42501';
  end if;
  delete from public.diagnostic_report where id = p_id;
end;
$$;
revoke all on function public.admin_delete_report(uuid) from public, anon;
grant execute on function public.admin_delete_report(uuid) to authenticated;

-- Usage, as counts (the same numbers as scripts/stats.sql, plus imports and reports). Admins only.
-- "Active" = the app refreshed its sign-in that week, which happens while it's open (hourly).
create or replace function public.admin_stats() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then
    raise exception 'Only admins can see this.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'accounts', (select count(*) from auth.users),
    'new_this_week', (select count(*) from auth.users where created_at > now() - interval '7 days'),
    'active_this_week', (select count(distinct user_id) from auth.sessions
      where coalesce(refreshed_at, updated_at, created_at) > now() - interval '7 days'),
    'plans_set_up', (select count(*) from public.plan where onboarded),
    'ynab_imports', (select count(*) from public.ynab_import where imported_at is not null),
    'signed_up_4_weeks_ago', (select count(*) from auth.users u where u.created_at between now() - interval '35 days' and now() - interval '28 days'),
    'still_active_4_weeks_later', (select count(*) from auth.users u where u.created_at between now() - interval '35 days' and now() - interval '28 days'
      and exists (select 1 from auth.sessions s where s.user_id = u.id
        and coalesce(s.refreshed_at, s.updated_at, s.created_at) > now() - interval '7 days')),
    'reports', (select count(*) from public.diagnostic_report),
    'reports_this_week', (select count(*) from public.diagnostic_report where created_at > now() - interval '7 days')
  );
end;
$$;
revoke all on function public.admin_stats() from public, anon;
grant execute on function public.admin_stats() to authenticated;
