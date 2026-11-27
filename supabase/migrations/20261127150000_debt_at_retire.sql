-- A mortgage still running when you retire: keep up the payments, or pay it off then (missing: the cheaper).
alter table public.debt add column if not exists at_retire text check (at_retire in ('keep', 'payoff'));
