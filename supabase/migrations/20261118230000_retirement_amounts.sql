-- Retirement spending per category: its own amount once you retire (category.retire_amount), and where the
-- others come from (plan.retire_amounts_from: null = the plan amount, 'assigned' = this month's assigned).
-- get_plan and save_plan pick the columns up by name.
alter table public.category add column if not exists retire_amount numeric check (retire_amount >= 0);
alter table public.plan add column if not exists retire_amounts_from text check (retire_amounts_from in ('assigned'));
-- a category that pays one of your debts (a "PITI" category for a mortgage): counted from Debts, not as spending
alter table public.category add column if not exists pays_debt text;
