-- Coast FI at an age: from then the plan stops investing until you retire. And a what-if coast age.
alter table public.plan add column if not exists coast_age numeric check (coast_age > 0 and coast_age < 120);
alter table public.plan add column if not exists whatif_coast_age numeric check (whatif_coast_age > 0 and whatif_coast_age < 120);
