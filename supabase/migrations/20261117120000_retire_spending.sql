-- A set yearly amount to spend in retirement (today's dollars), used instead of adding up the budget.
-- Null or 0: the plan works it out from the budget, as before.
alter table public.plan add column retire_spending numeric;
