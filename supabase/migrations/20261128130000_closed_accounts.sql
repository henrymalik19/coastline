-- An account or card closed at the bank: kept for its history, but not offered for new transactions.
alter table public.account add column if not exists closed boolean;
alter table public.debt add column if not exists closed boolean;
