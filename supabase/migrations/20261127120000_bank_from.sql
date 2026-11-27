-- An account or card matched to a bank: the first day its transactions come from the bank. Before it,
-- they're yours or YNAB's; from it on, the bank's (YNAB's only fill in their details).
alter table public.account add column if not exists bank_from text check (bank_from ~ '^\d{4}-\d{2}-\d{2}$');
alter table public.debt add column if not exists bank_from text check (bank_from ~ '^\d{4}-\d{2}-\d{2}$');
