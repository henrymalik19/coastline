-- The bank or company an account or debt is with ("Chase"), shown before its name. Optional; save_plan
-- and get_plan pick the columns up by name.
alter table public.account add column if not exists company text;
alter table public.debt add column if not exists company text;
