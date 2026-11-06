-- Coast FI: accounts & sync (PLAN.md §4.2, Phase 3)
-- Every table is protected by row-level security: a user can only ever see and change their own rows.

-- ---------- profiles ----------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  timezone text
);

alter table public.profiles enable row level security;

create policy "profiles: read own" on public.profiles
  for select to authenticated using (id = (select auth.uid()));
create policy "profiles: update own" on public.profiles
  for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- create a profile row whenever someone signs up
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id) values (new.id);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- plans: one plan document per user ----------
create table public.plans (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  -- the PlanState document (validated with Zod in the app on read and before write)
  state jsonb not null,
  -- ticked to-dos per month and other small per-user app state
  todo_done jsonb not null default '{}'::jsonb,
  onboarded boolean not null default false,
  schema_version int not null default 2,
  -- the client's edit time (ms since epoch): last write wins across devices
  client_updated_at bigint not null default 0,
  updated_at timestamptz not null default now(),
  constraint plans_state_is_v2 check (jsonb_typeof(state) = 'object' and state ->> 'version' = '2'),
  constraint plans_state_size check (pg_column_size(state) < 512 * 1024)
);

alter table public.plans enable row level security;

create policy "plans: read own" on public.plans
  for select to authenticated using (user_id = (select auth.uid()));
create policy "plans: insert own" on public.plans
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "plans: update own" on public.plans
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "plans: delete own" on public.plans
  for delete to authenticated using (user_id = (select auth.uid()));

-- last write wins, enforced by the database: an update carrying an older client time is ignored,
-- so a device that was offline can never overwrite newer changes from another device.
create function public.plans_last_write_wins() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.client_updated_at < old.client_updated_at then
    return null; -- skip this row update
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger plans_lww
  before update on public.plans
  for each row execute function public.plans_last_write_wins();

-- ---------- check-ins: one per user per month ----------
create table public.checkins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  month date not null, -- first day of the month
  checked_on date,
  invested numeric not null,
  cash numeric not null,
  debt numeric not null,
  net_worth numeric not null,
  expected_next_invested numeric not null,
  spent numeric,
  budget numeric,
  source text not null default 'manual' check (source in ('manual', 'plaid')),
  updated_at timestamptz not null default now(),
  unique (user_id, month),
  constraint checkins_month_is_first check (extract(day from month) = 1)
);

alter table public.checkins enable row level security;

create policy "checkins: read own" on public.checkins
  for select to authenticated using (user_id = (select auth.uid()));
create policy "checkins: insert own" on public.checkins
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "checkins: update own" on public.checkins
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "checkins: delete own" on public.checkins
  for delete to authenticated using (user_id = (select auth.uid()));

create function public.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger checkins_touch
  before update on public.checkins
  for each row execute function public.touch_updated_at();

-- signed-out visitors get nothing
revoke all on public.profiles, public.plans, public.checkins from anon;
