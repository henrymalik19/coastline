-- A plan's import from YNAB, so every device knows about it (no second import) and can undo it for
-- 30 days. One row per plan. imported_at null: there's no import now (it was undone, or the budget was
-- started over). undo: what it takes to undo it, while that's still possible: the plan just before,
-- the ids of the transactions that were there, and how the ones the import changed looked before.
-- Cleared when you keep the import or the 30 days are up. synced_at: when transactions last came in
-- from YNAB (the import, or an "Update transactions from YNAB" since).
create table public.ynab_import (
  plan_id uuid primary key references public.plan (id) on delete cascade,
  imported_at bigint,
  synced_at bigint,
  undo jsonb,
  updated_at timestamptz not null default now()
);
alter table public.ynab_import enable row level security;
revoke all on public.ynab_import from anon;
create policy "ynab_import: read" on public.ynab_import for select to authenticated using (public.can_use_plan(plan_id));
create policy "ynab_import: add" on public.ynab_import for insert to authenticated with check (public.can_use_plan(plan_id));
create policy "ynab_import: change" on public.ynab_import for update to authenticated using (public.can_use_plan(plan_id)) with check (public.can_use_plan(plan_id));
create policy "ynab_import: remove" on public.ynab_import for delete to authenticated using (public.can_use_plan(plan_id));
