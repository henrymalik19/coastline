-- Why a bank connection's transactions didn't come in the last time it synced (Plaid's error code, for
-- one that never got consent to share them, like a brokerage connected for investments), or null when
-- they did. The server function writes it; the app reads it to say so and offer to turn them on.
alter table public.plaid_items add column if not exists txn_error text;
