-- Split the plan out of one JSON column into its own tables, and use singular table names.
--
-- Before: plans.state held the whole plan (accounts, debts, incomes, budget, goals, every budget
-- month, schedules...) as one JSON document, saved whole on every change.
-- After: a `plan` row holds the settings as columns, and each list is a table of its own, one row
-- per thing. The app reads a plan with get_plan() (one consistent snapshot) and saves only what
-- changed with save_plan() (all or nothing, and only if nobody saved since the copy it started from).
--
-- Existing plans keep their JSON in plan.legacy_state until the app opens them: it turns the JSON
-- into rows with the same code it saves with, then clears the column.
--
-- A plan's id is its owner's user id for now (one plan per person); tables point at plan.id, so a
-- person could have more than one plan later.

-- ---------- singular names ----------
alter table public.profiles rename to profile;
alter table public.plans rename to plan;
alter table public.checkins rename to checkin;
alter table public.transactions rename to transaction;
alter table public.plan_members rename to plan_member;

alter table public.plan rename column user_id to id;
alter table public.plan rename column state to legacy_state;
alter table public.plan rename column todo_done to legacy_todo_done;
alter table public.plan alter column legacy_todo_done drop not null;
alter table public.plan alter column legacy_todo_done drop default;
alter table public.plan drop column schema_version;
alter table public.checkin rename column user_id to plan_id;
alter table public.transaction rename column user_id to plan_id;
alter table public.plan_member rename column owner_id to plan_id;

alter table public.plan rename constraint plans_state_is_v2 to plan_legacy_state_is_v2;
alter table public.plan rename constraint plans_state_size to plan_legacy_state_size;
alter table public.plan alter column legacy_state drop not null;
alter table public.plan drop constraint plan_legacy_state_is_v2;
alter table public.plan add constraint plan_legacy_state_is_v2 check (legacy_state is null or (jsonb_typeof(legacy_state) = 'object' and legacy_state ->> 'version' = '2'));

-- ---------- the plan's settings, as columns ----------
alter table public.plan
  add column owner_id uuid references auth.users (id) on delete cascade default auth.uid(),
  add column created_at timestamptz not null default now(),
  add column version int not null default 2,
  add column age numeric,
  add column retire_age numeric,
  add column healthcare numeric,
  add column medicare numeric,
  add column current_invest_monthly numeric,
  add column ret numeric,
  add column vol numeric,
  add column fee numeric,
  add column swr numeric,
  add column tax_rate numeric,
  add column contrib_growth numeric,
  add column filing_status text check (filing_status in ('single', 'mfj', 'hoh')),
  add column spouse_name text,
  add column spouse_age numeric,
  add column whatif_extra numeric,
  add column whatif_ret_delta numeric,
  add column whatif_spend_delta numeric,
  -- the priority order and how it runs
  add column steps text[],
  add column starter_ef numeric,
  add column starter_ef_months numeric,
  add column ef_months numeric,
  add column high_apr numeric,
  add column marginal_tax numeric,
  add column marginal_tax_manual boolean,
  add column hsa_eligible boolean,
  add column hsa_family boolean,
  add column project_with text check (project_with in ('plan', 'current')),
  add column payroll_steps boolean,
  add column hsa_payroll boolean,
  -- emergency mode (set when emergency_active isn't null)
  add column emergency_active boolean,
  add column emergency_until text check (emergency_until ~ '^\d{4}-\d{2}$'),
  add column emergency_essentials_only boolean,
  add column emergency_pause_401k boolean,
  -- contributed so far this year (set when contributed_year isn't null)
  add column contributed_year int,
  add column contributed_k401 numeric,
  add column contributed_ira numeric,
  add column contributed_hsa numeric,
  add column contributed_ira_spouse numeric,
  -- the monthly budget (started when budget_start isn't null)
  add column budget_start text check (budget_start ~ '^\d{4}-\d{2}$'),
  add column budget_start_cash numeric,
  add column ef_line boolean,
  add column ef_name text,
  add column ef_group text;

update public.plan set owner_id = id where owner_id is null;
alter table public.plan alter column owner_id set not null;
create index plan_by_owner on public.plan (owner_id);

-- ---------- one row per thing ----------
-- every list keeps its order in `sort`; ids are the app's own (made on the device, so it works offline)

create table public.account (
  plan_id uuid not null references public.plan (id) on delete cascade,
  id text not null,
  sort int not null,
  name text not null,
  type text not null check (type in ('pretax', 'roth', 'taxable', 'hsa', 'cash', 'property')),
  balance numeric not null,
  plaid_account_id text,
  counts text check (counts in ('k401', 'ira', 'hsa', 'taxable', 'other')),
  owner text check (owner in ('spouse')),
  home_costs numeric,
  upkeep numeric,
  primary key (plan_id, id)
);

create table public.debt (
  plan_id uuid not null references public.plan (id) on delete cascade,
  id text not null,
  sort int not null,
  name text not null,
  kind text check (kind in ('credit_card', 'car', 'student', 'mortgage', 'personal', 'medical', 'k401_loan', 'other')),
  balance numeric not null,
  apr numeric not null,
  min_payment numeric not null,
  plaid_account_id text,
  promo_apr numeric,
  promo_until text check (promo_until ~ '^\d{4}-\d{2}$'),
  minimum_only boolean,
  escrow numeric,
  rental boolean,
  term int,
  first_payment text check (first_payment ~ '^\d{4}-\d{2}$'),
  original numeric,
  payroll boolean,
  budget_group text,
  primary key (plan_id, id)
);

create table public.income (
  plan_id uuid not null references public.plan (id) on delete cascade,
  id text not null,
  sort int not null,
  name text not null,
  kind text check (kind in ('job', 'business', 'rental', 'other')),
  freq text not null check (freq in ('weekly', 'biweekly', 'semimonthly', 'monthly')),
  net numeric not null,
  next_payday text check (next_payday ~ '^\d{4}-\d{2}-\d{2}$'),
  match_mode text not null check (match_mode in ('pct', 'usd')),
  gross numeric,
  contrib_pct numeric,
  match_rate1 numeric,
  match_up_to1 numeric,
  match_rate2 numeric,
  match_up_to2 numeric,
  pretax numeric,
  match numeric,
  full_match boolean,
  net_mode text check (net_mode in ('auto', 'manual')),
  -- taxes from a pay stub (set when tax_federal isn't null)
  tax_federal numeric,
  tax_state numeric,
  tax_social_security numeric,
  tax_medicare numeric,
  has_deductions boolean,
  roth_share numeric,
  hsa_employer numeric,
  hsa_employer_month int,
  hsa_pre numeric,
  primary key (plan_id, id)
);

create table public.income_deduction (
  plan_id uuid not null references public.plan (id) on delete cascade,
  income_id text not null,
  id text not null,
  sort int not null,
  kind text not null check (kind in ('health', 'dentalVision', 'lifeDisability', 'union', 'k401_loan', 'other')),
  amount numeric not null,
  debt_id text,
  primary key (plan_id, income_id, id),
  -- checked at the end of a save, so rewriting an income doesn't take its deductions with it
  foreign key (plan_id, income_id) references public.income (plan_id, id) deferrable initially deferred
);

-- your budget categories (budget items)
create table public.category (
  plan_id uuid not null references public.plan (id) on delete cascade,
  id text not null,
  sort int not null,
  name text not null,
  amount numeric not null,
  in_retirement boolean not null,
  group_name text,
  essential boolean,
  no_suggest boolean,
  account_id text,
  primary key (plan_id, id)
);

create table public.goal (
  plan_id uuid not null references public.plan (id) on delete cascade,
  id text not null,
  sort int not null,
  name text not null,
  target numeric not null,
  saved numeric not null,
  -- repeating (a bill) when every_months isn't null
  every_months int,
  due text check (due ~ '^\d{4}-\d{2}$'),
  in_retirement boolean,
  paid_through text check (paid_through ~ '^\d{4}-\d{2}$'),
  budget_group text,
  primary key (plan_id, id)
);

create table public.retirement_income (
  plan_id uuid not null references public.plan (id) on delete cascade,
  id text not null,
  sort int not null,
  name text not null,
  kind text not null check (kind in ('socialSecurity', 'pension', 'other')),
  monthly numeric not null,
  start_age numeric not null,
  primary key (plan_id, id)
);

-- one-off changes to a month (an expense, income lost or gained)
create table public.adjustment (
  plan_id uuid not null references public.plan (id) on delete cascade,
  id text not null,
  sort int not null,
  month text not null check (month ~ '^\d{4}-\d{2}$'),
  kind text not null check (kind in ('expense', 'incomeLoss', 'incomeGain')),
  amount numeric not null,
  note text not null,
  primary key (plan_id, id)
);

create table public.contribution_limit (
  plan_id uuid not null references public.plan (id) on delete cascade,
  year int not null,
  sort int not null,
  k401 numeric not null,
  k401_catch numeric not null,
  ira numeric not null,
  ira_catch numeric not null,
  hsa_self numeric not null,
  hsa_family numeric not null,
  hsa_catch numeric not null,
  primary key (plan_id, year)
);

-- a step's split: the share of what's left it takes, or a set amount a month
create table public.step_split (
  plan_id uuid not null references public.plan (id) on delete cascade,
  step text not null,
  share numeric,
  amount numeric,
  primary key (plan_id, step)
);

-- planned amounts that change over time: "from Mar 2027, $500 a month" (key: cash, ira, debt:<id>, ...)
create table public.schedule_entry (
  plan_id uuid not null references public.plan (id) on delete cascade,
  key text not null,
  sort int not null,
  from_month text not null check (from_month ~ '^\d{4}-\d{2}$'),
  amount numeric not null,
  pct numeric,
  primary key (plan_id, key, sort)
);

-- an amount for one month: a schedule's one-off (source 'schedule') or a step's amount changed on the Budget ('step')
create table public.month_amount (
  plan_id uuid not null references public.plan (id) on delete cascade,
  source text not null check (source in ('schedule', 'step')),
  key text not null,
  month text not null check (month ~ '^\d{4}-\d{2}$'),
  amount numeric not null,
  primary key (plan_id, source, key, month)
);

-- the monthly budget: each month, and what's assigned and spent in each category
create table public.budget_month (
  plan_id uuid not null references public.plan (id) on delete cascade,
  month text not null check (month ~ '^\d{4}-\d{2}$'),
  income numeric,
  primary key (plan_id, month)
);

create table public.budget_amount (
  plan_id uuid not null references public.plan (id) on delete cascade,
  month text not null,
  -- a category id, goal:<id>, debt:<id> or cash
  key text not null,
  assigned numeric,
  spent numeric,
  primary key (plan_id, month, key),
  foreign key (plan_id, month) references public.budget_month (plan_id, month) deferrable initially deferred
);

-- where each budget account's register starts
create table public.register (
  plan_id uuid not null references public.plan (id) on delete cascade,
  account_id text not null,
  opening numeric not null,
  since text not null,
  primary key (plan_id, account_id)
);

-- a transfer to an account you don't budget (an IRA, a loan) and what it moved there
create table public.tracked_transfer (
  plan_id uuid not null references public.plan (id) on delete cascade,
  transaction_id text not null,
  to_account text not null,
  amount numeric not null,
  primary key (plan_id, transaction_id)
);

-- to-dos ticked off, by month
create table public.todo_done (
  plan_id uuid not null references public.plan (id) on delete cascade,
  month text not null,
  item text not null,
  sort int not null,
  primary key (plan_id, month, item)
);

-- ---------- access: the owner, or someone they shared the whole plan with ----------
create or replace function public.full_access(owner uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.plan_member m
    where m.plan_id = owner and m.member_id = (select auth.uid()) and m.role = 'full'
  );
$$;

create or replace function public.shared_account(owner uuid, account text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.plan_member m
    where m.plan_id = owner and m.member_id = (select auth.uid()) and account = any (m.accounts)
  );
$$;

-- functions that name a table by its old name
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profile (id) values (new.id);
  return new;
end;
$$;

create or replace function public.member_join() returns setof public.plan_member
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  mail text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  if me is null or mail = '' then
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

create function public.can_use_plan(p uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.plan where id = p and owner_id = (select auth.uid())) or public.full_access(p);
$$;
revoke all on function public.can_use_plan(uuid) from public, anon;
grant execute on function public.can_use_plan(uuid) to authenticated;

-- the plan row: the owner creates and deletes it; the owner and full members read and change it
drop policy if exists "plans: read own" on public.plan;
drop policy if exists "plans: insert own" on public.plan;
drop policy if exists "plans: update own" on public.plan;
drop policy if exists "plans: delete own" on public.plan;
drop policy if exists "plans: full member reads" on public.plan;
drop policy if exists "plans: full member updates" on public.plan;
create policy "plan: read" on public.plan for select to authenticated using (public.can_use_plan(id));
create policy "plan: owner creates" on public.plan for insert to authenticated with check (id = (select auth.uid()) and owner_id = (select auth.uid()));
create policy "plan: change" on public.plan for update to authenticated using (public.can_use_plan(id)) with check (public.can_use_plan(id));
create policy "plan: owner deletes" on public.plan for delete to authenticated using (owner_id = (select auth.uid()));

-- every table of the plan: the same four rules
do $$
declare
  t text;
begin
  foreach t in array array['account', 'debt', 'income', 'income_deduction', 'category', 'goal', 'retirement_income', 'adjustment',
    'contribution_limit', 'step_split', 'schedule_entry', 'month_amount', 'budget_month', 'budget_amount', 'register',
    'tracked_transfer', 'todo_done'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('create policy "%s: read" on public.%I for select to authenticated using (public.can_use_plan(plan_id))', t, t);
    execute format('create policy "%s: add" on public.%I for insert to authenticated with check (public.can_use_plan(plan_id))', t, t);
    execute format('create policy "%s: change" on public.%I for update to authenticated using (public.can_use_plan(plan_id)) with check (public.can_use_plan(plan_id))', t, t);
    execute format('create policy "%s: remove" on public.%I for delete to authenticated using (public.can_use_plan(plan_id))', t, t);
  end loop;
end;
$$;

-- check-ins: the owner and full members (policies move to the new names)
drop policy if exists "checkins: read own" on public.checkin;
drop policy if exists "checkins: insert own" on public.checkin;
drop policy if exists "checkins: update own" on public.checkin;
drop policy if exists "checkins: delete own" on public.checkin;
drop policy if exists "checkins: full member reads" on public.checkin;
drop policy if exists "checkins: full member adds" on public.checkin;
drop policy if exists "checkins: full member updates" on public.checkin;
create policy "checkin: read" on public.checkin for select to authenticated using (plan_id = (select auth.uid()) or public.full_access(plan_id));
create policy "checkin: add" on public.checkin for insert to authenticated with check (plan_id = (select auth.uid()) or public.full_access(plan_id));
create policy "checkin: change" on public.checkin for update to authenticated using (plan_id = (select auth.uid()) or public.full_access(plan_id)) with check (plan_id = (select auth.uid()) or public.full_access(plan_id));
create policy "checkin: owner removes" on public.checkin for delete to authenticated using (plan_id = (select auth.uid()));

-- ---------- a transaction's split lines (instead of JSON on the transaction) ----------
create table public.transaction_split (
  plan_id uuid not null,
  transaction_id text not null,
  sort int not null,
  category_id text not null,
  amount numeric(14, 2) not null,
  memo text,
  primary key (plan_id, transaction_id, sort),
  foreign key (plan_id, transaction_id) references public.transaction (plan_id, id) on delete cascade
);
alter table public.transaction_split enable row level security;
revoke all on public.transaction_split from anon;
-- read: whoever can read the transaction; write: the owner and full members
create policy "transaction_split: read" on public.transaction_split for select to authenticated
  using (exists (select 1 from public.transaction t where t.plan_id = transaction_split.plan_id and t.id = transaction_split.transaction_id));
create policy "transaction_split: add" on public.transaction_split for insert to authenticated with check (public.can_use_plan(plan_id));
create policy "transaction_split: change" on public.transaction_split for update to authenticated using (public.can_use_plan(plan_id)) with check (public.can_use_plan(plan_id));
create policy "transaction_split: remove" on public.transaction_split for delete to authenticated using (public.can_use_plan(plan_id));

insert into public.transaction_split (plan_id, transaction_id, sort, category_id, amount, memo)
select t.plan_id, t.id, s.ord - 1, s.v ->> 'categoryId', (s.v ->> 'amount')::numeric, s.v ->> 'memo'
from public.transaction t, jsonb_array_elements(t.splits) with ordinality as s (v, ord)
where t.splits is not null and jsonb_typeof(t.splits) = 'array';

alter table public.transaction drop constraint transactions_splits_is_array;
alter table public.transaction drop column splits;

-- ---------- reading and saving a plan ----------
-- the tables a plan is made of, and the columns that identify a row in each
create function public.plan_tables() returns table (name text, keys text[])
language sql immutable set search_path = '' as $$
  values
    ('account', array['id']), ('debt', array['id']), ('income', array['id']), ('income_deduction', array['income_id', 'id']),
    ('category', array['id']), ('goal', array['id']), ('retirement_income', array['id']), ('adjustment', array['id']),
    ('contribution_limit', array['year']), ('step_split', array['step']), ('schedule_entry', array['key', 'sort']),
    ('month_amount', array['source', 'key', 'month']), ('budget_month', array['month']), ('budget_amount', array['month', 'key']),
    ('register', array['account_id']), ('tracked_transfer', array['transaction_id']), ('todo_done', array['month', 'item'])
$$;

-- the whole plan in one snapshot: { plan: {...}, account: [...], debt: [...], ... } (RLS applies)
create function public.get_plan(p uuid) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare
  out jsonb;
  t record;
  rows jsonb;
begin
  select jsonb_build_object('plan', to_jsonb(x)) into out from public.plan x where x.id = p;
  if out is null then
    return null;
  end if;
  for t in select * from public.plan_tables() loop
    execute format('select coalesce(jsonb_agg(to_jsonb(r) - ''plan_id''), ''[]''::jsonb) from public.%I r where r.plan_id = $1', t.name) into rows using p;
    out := out || jsonb_build_object(t.name, rows);
  end loop;
  return out;
end;
$$;
revoke all on function public.get_plan(uuid) from public, anon;
grant execute on function public.get_plan(uuid) to authenticated;

/*
 * Save a plan: the settings (p_plan, every column) and the rows that changed (p_changes:
 * { account: { upsert: [rows], delete: [keys] }, ... }), all or nothing.
 * p_base: the save this device's copy came from. The save only goes through if nobody saved since
 * (returns null otherwise, so the device takes in the other changes first). p_base null: this
 * device's first save, which replaces the plan if it's newer than what's there (p_at).
 * Returns p_at when saved.
 */
create function public.save_plan(p uuid, p_base bigint, p_at bigint, p_plan jsonb, p_changes jsonb) returns bigint
language plpgsql security invoker set search_path = '' as $$
declare
  cur bigint;
  t record;
  ch jsonb;
  cols text;
  keycond text;
begin
  select client_updated_at into cur from public.plan where id = p for update;
  if not found then
    insert into public.plan (id, owner_id, client_updated_at) values (p, (select auth.uid()), 0);
    cur := 0;
  end if;
  if p_base is null then
    if cur > p_at then
      return null;
    end if;
  elsif cur <> p_base then
    return null;
  end if;

  -- the settings: every column the app sends (id, owner and timestamps aren't the app's to change)
  select string_agg(format('%I = r.%I', c.column_name, c.column_name), ', ') into cols
  from information_schema.columns c
  where c.table_schema = 'public' and c.table_name = 'plan' and p_plan ? c.column_name
    and c.column_name not in ('id', 'owner_id', 'created_at', 'updated_at', 'client_updated_at', 'legacy_state', 'legacy_todo_done');
  if cols is not null then
    execute format('update public.plan x set %s from jsonb_populate_record(null::public.plan, $1) r where x.id = $2', cols) using p_plan, p;
  end if;
  update public.plan set client_updated_at = p_at, legacy_state = null, legacy_todo_done = null, updated_at = now() where id = p;

  for t in select * from public.plan_tables() loop
    ch := p_changes -> t.name;
    if p_base is null then
      -- the first save from a device replaces everything
      execute format('delete from public.%I where plan_id = $1', t.name) using p;
    end if;
    if ch is null then
      continue;
    end if;
    select string_agg(format('x.%I is not distinct from r.%I', k, k), ' and ') into keycond from unnest(t.keys) k;
    -- removed rows, and the old copy of changed ones
    execute format(
      'delete from public.%I x using jsonb_populate_recordset(null::public.%I, $1) r where x.plan_id = $2 and %s',
      t.name, t.name, keycond
    ) using coalesce(ch -> 'delete', '[]'::jsonb) || coalesce(ch -> 'upsert', '[]'::jsonb), p;
    execute format(
      'insert into public.%I select (jsonb_populate_record(null::public.%I, e || jsonb_build_object(''plan_id'', $2))).* from jsonb_array_elements($1) e',
      t.name, t.name
    ) using coalesce(ch -> 'upsert', '[]'::jsonb), p;
  end loop;
  return p_at;
end;
$$;
revoke all on function public.save_plan(uuid, bigint, bigint, jsonb, jsonb) from public, anon;
grant execute on function public.save_plan(uuid, bigint, bigint, jsonb, jsonb) to authenticated;

/*
 * Save transactions with their split lines. Each one is kept only if it's newer than the copy on the
 * server (an older edit from an offline device is ignored), and its splits go with it.
 */
create function public.save_transactions(p uuid, p_rows jsonb) returns void
language plpgsql security invoker set search_path = '' as $$
declare
  e jsonb;
  kept boolean;
begin
  for e in select * from jsonb_array_elements(p_rows) loop
    insert into public.transaction (plan_id, id, account_id, date, amount, payee, memo, category_id, transfer_account_id, transfer_id, cleared, source, import_id, deleted, client_updated_at)
    values (
      p, e ->> 'id', e ->> 'account_id', (e ->> 'date')::date, (e ->> 'amount')::numeric, e ->> 'payee', e ->> 'memo', e ->> 'category_id',
      e ->> 'transfer_account_id', e ->> 'transfer_id', coalesce(e ->> 'cleared', 'uncleared'), coalesce(e ->> 'source', 'manual'),
      e ->> 'import_id', coalesce((e ->> 'deleted')::boolean, false), coalesce((e ->> 'client_updated_at')::bigint, 0)
    )
    on conflict (plan_id, id) do update set
      account_id = excluded.account_id, date = excluded.date, amount = excluded.amount, payee = excluded.payee, memo = excluded.memo,
      category_id = excluded.category_id, transfer_account_id = excluded.transfer_account_id, transfer_id = excluded.transfer_id,
      cleared = excluded.cleared, source = excluded.source, import_id = excluded.import_id, deleted = excluded.deleted,
      client_updated_at = excluded.client_updated_at;
    select x.client_updated_at = coalesce((e ->> 'client_updated_at')::bigint, 0) into kept from public.transaction x where x.plan_id = p and x.id = e ->> 'id';
    if kept then
      delete from public.transaction_split where plan_id = p and transaction_id = e ->> 'id';
      insert into public.transaction_split (plan_id, transaction_id, sort, category_id, amount, memo)
      select p, e ->> 'id', s.ord - 1, s.v ->> 'category_id', (s.v ->> 'amount')::numeric, s.v ->> 'memo'
      from jsonb_array_elements(coalesce(e -> 'splits', '[]'::jsonb)) with ordinality as s (v, ord);
    end if;
  end loop;
end;
$$;
revoke all on function public.save_transactions(uuid, jsonb) from public, anon;
grant execute on function public.save_transactions(uuid, jsonb) to authenticated;
