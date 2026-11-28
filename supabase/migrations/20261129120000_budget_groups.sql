-- Your budget groups in order, empty ones included (a group stays after its last category moves out,
-- so you can drag one back in or delete it). Groups a category names that aren't listed yet follow it.
alter table public.plan add column if not exists budget_groups text[];
