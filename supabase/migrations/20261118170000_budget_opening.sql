-- What each category had when the budget started, brought in from YNAB: the first month starts with it,
-- like money carried in. Negative: overspending paid in cash the month before (it comes out of the first
-- month's ready to assign). Part of the plan, saved with it like the assigned amounts.
create table if not exists public.budget_opening (
  plan_id uuid not null references public.plan (id) on delete cascade,
  -- a category id, goal:<id>, debt:<id> or cash
  key text not null,
  amount numeric not null,
  primary key (plan_id, key)
);
alter table public.budget_opening enable row level security;
revoke all on public.budget_opening from anon;
create policy "budget_opening: read" on public.budget_opening for select to authenticated using (public.can_use_plan(plan_id));
create policy "budget_opening: add" on public.budget_opening for insert to authenticated with check (public.can_use_plan(plan_id));
create policy "budget_opening: change" on public.budget_opening for update to authenticated using (public.can_use_plan(plan_id)) with check (public.can_use_plan(plan_id));
create policy "budget_opening: remove" on public.budget_opening for delete to authenticated using (public.can_use_plan(plan_id));

-- get_plan and save_plan read and write every table listed here
create or replace function public.plan_tables() returns table (name text, keys text[])
language sql immutable set search_path = '' as $$
  values
    ('account', array['id']), ('debt', array['id']), ('income', array['id']), ('income_deduction', array['income_id', 'id']),
    ('category', array['id']), ('goal', array['id']), ('retirement_income', array['id']), ('adjustment', array['id']),
    ('property', array['id']), ('step_split', array['step']), ('schedule_entry', array['key', 'sort']),
    ('month_amount', array['source', 'key', 'month']), ('budget_assignment', array['month', 'key']), ('todo_done', array['month', 'item']),
    ('budget_card_debt', array['month', 'category_key', 'card_key']), ('budget_opening', array['key'])
$$;
