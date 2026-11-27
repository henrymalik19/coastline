-- A Roth IRA: what you've put in so far (contributions come out any time, so they count before 59½).
alter table public.account add column if not exists contributions numeric check (contributions >= 0);
