-- A hidden category: off the budget and out of the plan (no monthly amount), but still holding its
-- transactions. For a one-off, or an old category brought in from YNAB.
alter table public.category add column hidden boolean;
