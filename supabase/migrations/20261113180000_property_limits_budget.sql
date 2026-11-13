-- Follow-up to the plan split:
-- 1. Contribution limits are the same for everyone: one shared table by year (read by anyone, changed
--    only by a migration), not a copy in every plan.
-- 2. Homes and rentals get their own table, linked to their mortgage (debt) and rent (income).
--    Property accounts and the debt's rental flag move there.
-- 3. The budget keeps only what you assign each month. What came in and went out is in transactions.
-- 4. An account's register starts with a "Starting balance" transaction instead of a register row.
-- 5. A transfer to an account you don't budget keeps how much it moved that account on the transaction.

-- ---------- 1. shared contribution limits ----------
drop table public.contribution_limit;

create table public.contribution_limit (
  year int primary key,
  k401 numeric not null,
  k401_catch numeric not null,
  ira numeric not null,
  ira_catch numeric not null,
  hsa_self numeric not null,
  hsa_family numeric not null,
  hsa_catch numeric not null,
  updated_at timestamptz not null default now()
);
alter table public.contribution_limit enable row level security;
-- public figures: anyone can read them; nobody changes them from the app
create policy "contribution_limit: anyone reads" on public.contribution_limit for select to anon, authenticated using (true);
-- update these when the IRS announces new limits (2027 401(k)/IRA copy 2026 until then)
insert into public.contribution_limit (year, k401, k401_catch, ira, ira_catch, hsa_self, hsa_family, hsa_catch) values
  (2026, 24500, 8000, 7500, 1100, 4400, 8750, 1000),
  (2027, 24500, 8000, 7500, 1100, 4500, 9000, 1000);

-- ---------- 2. homes and rentals ----------
create table public.property (
  plan_id uuid not null references public.plan (id) on delete cascade,
  id text not null,
  sort int not null,
  name text not null,
  -- a rental's costs are paid from its rent, so they stay out of retirement spending
  kind text not null check (kind in ('home', 'rental')),
  value numeric not null,
  -- its mortgage (debt.id) and its rent (income.id)
  mortgage_id text,
  income_id text,
  -- property tax + insurance a year, when no mortgage escrow pays them
  tax_insurance numeric,
  -- repairs and upkeep a year, as a share of its value
  upkeep numeric,
  primary key (plan_id, id)
);
alter table public.property enable row level security;
revoke all on public.property from anon;
create policy "property: read" on public.property for select to authenticated using (public.can_use_plan(plan_id));
create policy "property: add" on public.property for insert to authenticated with check (public.can_use_plan(plan_id));
create policy "property: change" on public.property for update to authenticated using (public.can_use_plan(plan_id)) with check (public.can_use_plan(plan_id));
create policy "property: remove" on public.property for delete to authenticated using (public.can_use_plan(plan_id));

-- property accounts become properties. A rental income made them as "prop-<income id>", with its
-- mortgage as "mort-<income id>"; otherwise the mortgage with the same name is theirs.
with p as (
  select a.plan_id, a.id, a.sort, a.name, a.balance, a.home_costs, a.upkeep,
    (select i.id from public.income i where i.plan_id = a.plan_id and a.id = 'prop-' || i.id) as income_id
  from public.account a
  where a.type = 'property'
), linked as (
  select p.*,
    coalesce(
      (select d.id from public.debt d where d.plan_id = p.plan_id and d.id = 'mort-' || p.income_id),
      (select d.id from public.debt d where d.plan_id = p.plan_id and d.kind = 'mortgage' and lower(trim(d.name)) = lower(trim(p.name)) order by d.sort limit 1)
    ) as mortgage_id
  from p
)
insert into public.property (plan_id, id, sort, name, kind, value, mortgage_id, income_id, tax_insurance, upkeep)
select l.plan_id, l.id, l.sort, l.name,
  case when exists (select 1 from public.debt d where d.plan_id = l.plan_id and d.id = l.mortgage_id and d.rental) then 'rental' else 'home' end,
  l.balance, l.mortgage_id, l.income_id, l.home_costs, l.upkeep
from linked l;

-- a rental mortgage with no property yet: give it one (its value is filled in later)
insert into public.property (plan_id, id, sort, name, kind, value, mortgage_id)
select d.plan_id, 'prop-' || d.id, 1000 + d.sort, d.name, 'rental', 0, d.id
from public.debt d
where d.rental and not exists (select 1 from public.property x where x.plan_id = d.plan_id and x.mortgage_id = d.id);

delete from public.account where type = 'property';
alter table public.account drop constraint account_type_check;
alter table public.account add constraint account_type_check check (type in ('pretax', 'roth', 'taxable', 'hsa', 'cash'));
alter table public.account drop column home_costs, drop column upkeep;
alter table public.debt drop column rental;

-- ---------- 3. the budget keeps what you assign ----------
create table public.budget_assignment (
  plan_id uuid not null references public.plan (id) on delete cascade,
  month text not null check (month ~ '^\d{4}-\d{2}$'),
  -- a category id, goal:<id>, debt:<id> or cash
  key text not null,
  assigned numeric not null,
  primary key (plan_id, month, key)
);
alter table public.budget_assignment enable row level security;
revoke all on public.budget_assignment from anon;
create policy "budget_assignment: read" on public.budget_assignment for select to authenticated using (public.can_use_plan(plan_id));
create policy "budget_assignment: add" on public.budget_assignment for insert to authenticated with check (public.can_use_plan(plan_id));
create policy "budget_assignment: change" on public.budget_assignment for update to authenticated using (public.can_use_plan(plan_id)) with check (public.can_use_plan(plan_id));
create policy "budget_assignment: remove" on public.budget_assignment for delete to authenticated using (public.can_use_plan(plan_id));

insert into public.budget_assignment (plan_id, month, key, assigned)
select plan_id, month, key, assigned from public.budget_amount where assigned is not null;

-- spending and income typed in by hand (from before transactions) become transactions in the plan's
-- first cash account, so nothing is lost
insert into public.transaction (plan_id, id, account_id, date, amount, payee, category_id, cleared, source, client_updated_at)
select b.plan_id, 'typed-spent:' || b.month || ':' || b.key, acct.id, (b.month || '-01')::date, -b.spent, 'Spending (typed in)', b.key, 'cleared', 'manual',
  (extract(epoch from now()) * 1000)::bigint
from public.budget_amount b
cross join lateral (select a.id from public.account a where a.plan_id = b.plan_id and a.type = 'cash' order by a.sort limit 1) acct
where b.spent is not null and b.spent <> 0;
insert into public.transaction (plan_id, id, account_id, date, amount, payee, category_id, cleared, source, client_updated_at)
select m.plan_id, 'typed-income:' || m.month, acct.id, (m.month || '-01')::date, m.income, 'Income (typed in)', 'ready', 'cleared', 'manual',
  (extract(epoch from now()) * 1000)::bigint
from public.budget_month m
cross join lateral (select a.id from public.account a where a.plan_id = m.plan_id and a.type = 'cash' order by a.sort limit 1) acct
where m.income is not null and m.income <> 0;

drop table public.budget_amount;
drop table public.budget_month;

-- ---------- 4. starting balances are transactions ----------
-- (a cash account's goes to ready to assign; a card's is what you owed, with no category)
insert into public.transaction (plan_id, id, account_id, date, amount, payee, category_id, cleared, source, client_updated_at)
select r.plan_id, 'start:' || r.account_id, r.account_id, r.since::date, r.opening, 'Starting balance',
  case when exists (select 1 from public.account a where a.plan_id = r.plan_id and a.id = r.account_id) then 'ready' end,
  'reconciled', 'manual', (extract(epoch from now()) * 1000)::bigint
from public.register r
on conflict (plan_id, id) do nothing;
drop table public.register;

-- ---------- 5. how much a transfer moved an account you don't budget ----------
alter table public.transaction add column tracked_amount numeric(14, 2);
update public.transaction t set tracked_amount = x.amount from public.tracked_transfer x where x.plan_id = t.plan_id and x.transaction_id = t.id;
drop table public.tracked_transfer;

-- ---------- the tables a plan is made of ----------
create or replace function public.plan_tables() returns table (name text, keys text[])
language sql immutable set search_path = '' as $$
  values
    ('account', array['id']), ('debt', array['id']), ('income', array['id']), ('income_deduction', array['income_id', 'id']),
    ('category', array['id']), ('goal', array['id']), ('retirement_income', array['id']), ('adjustment', array['id']),
    ('property', array['id']), ('step_split', array['step']), ('schedule_entry', array['key', 'sort']),
    ('month_amount', array['source', 'key', 'month']), ('budget_assignment', array['month', 'key']), ('todo_done', array['month', 'item'])
$$;

-- transactions: the tracked amount travels with them
create or replace function public.save_transactions(p uuid, p_rows jsonb) returns void
language plpgsql security invoker set search_path = '' as $$
declare
  e jsonb;
  kept boolean;
begin
  for e in select * from jsonb_array_elements(p_rows) loop
    insert into public.transaction (plan_id, id, account_id, date, amount, payee, memo, category_id, transfer_account_id, transfer_id, cleared, source, import_id, deleted, tracked_amount, client_updated_at)
    values (
      p, e ->> 'id', e ->> 'account_id', (e ->> 'date')::date, (e ->> 'amount')::numeric, e ->> 'payee', e ->> 'memo', e ->> 'category_id',
      e ->> 'transfer_account_id', e ->> 'transfer_id', coalesce(e ->> 'cleared', 'uncleared'), coalesce(e ->> 'source', 'manual'),
      e ->> 'import_id', coalesce((e ->> 'deleted')::boolean, false), (e ->> 'tracked_amount')::numeric, coalesce((e ->> 'client_updated_at')::bigint, 0)
    )
    on conflict (plan_id, id) do update set
      account_id = excluded.account_id, date = excluded.date, amount = excluded.amount, payee = excluded.payee, memo = excluded.memo,
      category_id = excluded.category_id, transfer_account_id = excluded.transfer_account_id, transfer_id = excluded.transfer_id,
      cleared = excluded.cleared, source = excluded.source, import_id = excluded.import_id, deleted = excluded.deleted,
      tracked_amount = excluded.tracked_amount, client_updated_at = excluded.client_updated_at;
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
