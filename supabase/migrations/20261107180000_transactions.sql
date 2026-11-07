-- Transactions in budget accounts (PLAN.md §10, Phase 7). One row per transaction, synced row by row.
-- Row-level security: a user only ever sees and changes their own rows.

create table public.transactions (
  id text not null,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  account_id text not null,
  date date not null,
  amount numeric(14, 2) not null,
  payee text,
  memo text,
  category_id text,
  splits jsonb,
  transfer_account_id text,
  transfer_id text,
  cleared text not null default 'uncleared' check (cleared in ('uncleared', 'cleared', 'reconciled')),
  source text not null default 'manual' check (source in ('manual', 'csv', 'ynab', 'plaid')),
  import_id text,
  deleted boolean not null default false,
  -- the client's edit time (ms since epoch): the newer copy wins across devices
  client_updated_at bigint not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, id),
  constraint transactions_splits_is_array check (splits is null or jsonb_typeof(splits) = 'array')
);

-- an import never adds the same bank or file row twice
create unique index transactions_import_once on public.transactions (user_id, account_id, import_id) where import_id is not null;
create index transactions_by_date on public.transactions (user_id, date);

alter table public.transactions enable row level security;

create policy "transactions: read own" on public.transactions
  for select to authenticated using (user_id = (select auth.uid()));
create policy "transactions: insert own" on public.transactions
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "transactions: update own" on public.transactions
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "transactions: delete own" on public.transactions
  for delete to authenticated using (user_id = (select auth.uid()));

-- last write wins, enforced by the database: an older edit from an offline device is ignored
create function public.transactions_last_write_wins() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.client_updated_at < old.client_updated_at then
    return null;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger transactions_lww
  before update on public.transactions
  for each row execute function public.transactions_last_write_wins();

revoke all on public.transactions from anon;
alter publication supabase_realtime add table public.transactions;
