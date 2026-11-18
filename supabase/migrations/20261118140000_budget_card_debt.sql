-- Overspending you chose to leave on a credit card as debt (instead of taking it from next month's
-- Unassigned): category `category_key` went over in `month` on the card whose payment line is
-- `card_key` (debt:<id>), and `amount` of it stays owed on the card. Part of the plan, saved with it
-- like the assigned amounts.
create table if not exists public.budget_card_debt (
  plan_id uuid not null references public.plan (id) on delete cascade,
  month text not null check (month ~ '^\d{4}-\d{2}$'),
  category_key text not null,
  card_key text not null,
  amount numeric not null check (amount >= 0),
  primary key (plan_id, month, category_key, card_key)
);
alter table public.budget_card_debt enable row level security;
revoke all on public.budget_card_debt from anon;
create policy "budget_card_debt: read" on public.budget_card_debt for select to authenticated using (public.can_use_plan(plan_id));
create policy "budget_card_debt: add" on public.budget_card_debt for insert to authenticated with check (public.can_use_plan(plan_id));
create policy "budget_card_debt: change" on public.budget_card_debt for update to authenticated using (public.can_use_plan(plan_id)) with check (public.can_use_plan(plan_id));
create policy "budget_card_debt: remove" on public.budget_card_debt for delete to authenticated using (public.can_use_plan(plan_id));

-- get_plan and save_plan read and write every table listed here
create or replace function public.plan_tables() returns table (name text, keys text[])
language sql immutable set search_path = '' as $$
  values
    ('account', array['id']), ('debt', array['id']), ('income', array['id']), ('income_deduction', array['income_id', 'id']),
    ('category', array['id']), ('goal', array['id']), ('retirement_income', array['id']), ('adjustment', array['id']),
    ('property', array['id']), ('step_split', array['step']), ('schedule_entry', array['key', 'sort']),
    ('month_amount', array['source', 'key', 'month']), ('budget_assignment', array['month', 'key']), ('todo_done', array['month', 'item']),
    ('budget_card_debt', array['month', 'category_key', 'card_key'])
$$;
