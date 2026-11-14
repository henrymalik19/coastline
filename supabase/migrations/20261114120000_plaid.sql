-- Plaid (bank connections), part A: balances.
--
-- plaid_items         one bank connection (a "login" at an institution). The app reads it (name, status);
--                     only the server writes it.
-- plaid_item_secrets  its access token, encrypted by the server function. Never readable by the app:
--                     row level security on, no policies, no grants.
-- plaid_accounts      each account at that bank, with the latest balance (and, for cards and loans, the
--                     rate and minimum payment when the bank shares them). The app reads it and copies
--                     balances into the plan accounts/debts it's matched to (plaidAccountId in the plan).
--
-- plan_id is the plan owner's user id, like the other plan tables; a household member with full access
-- reads them too (public.full_access).

create table public.plaid_items (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references auth.users (id) on delete cascade,
  item_id text not null unique,
  institution_id text,
  institution_name text,
  -- what was asked for when connecting: a bank or card ("bank"), or investments ("investments")
  kind text not null default 'bank' check (kind in ('bank', 'investments')),
  status text not null default 'ok' check (status in ('ok', 'login_required', 'pending_expiration', 'error')),
  error_code text,
  last_synced_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index plaid_items_by_plan on public.plaid_items (plan_id);

create table public.plaid_item_secrets (
  item uuid primary key references public.plaid_items (id) on delete cascade,
  access_token_enc text not null,
  -- for transactions sync later (part B)
  cursor text
);

create table public.plaid_accounts (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references auth.users (id) on delete cascade,
  item uuid not null references public.plaid_items (id) on delete cascade,
  account_id text not null unique,
  name text not null default '',
  official_name text,
  mask text,
  type text not null default 'other',
  subtype text,
  current numeric(14, 2),
  available numeric(14, 2),
  credit_limit numeric(14, 2),
  currency text,
  -- cards and loans, when the bank shares them (Plaid Liabilities): a yearly rate (0.2399) and the minimum
  apr numeric(8, 6),
  min_payment numeric(14, 2),
  updated_at timestamptz not null default now()
);
create index plaid_accounts_by_plan on public.plaid_accounts (plan_id);
create index plaid_accounts_by_item on public.plaid_accounts (item);

alter table public.plaid_items enable row level security;
alter table public.plaid_item_secrets enable row level security;
alter table public.plaid_accounts enable row level security;

-- the app only reads; the server function (service role) writes
create policy "plaid_items: read" on public.plaid_items
  for select to authenticated using (plan_id = (select auth.uid()) or public.full_access(plan_id));
create policy "plaid_accounts: read" on public.plaid_accounts
  for select to authenticated using (plan_id = (select auth.uid()) or public.full_access(plan_id));

revoke all on public.plaid_items, public.plaid_accounts from anon;
revoke insert, update, delete, truncate on public.plaid_items, public.plaid_accounts from authenticated;
-- the secrets: nobody but the service role
revoke all on public.plaid_item_secrets from anon, authenticated;
