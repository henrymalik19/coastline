-- What if can also try another retirement age, and paying more on a loan (debt id -> amount a month).
alter table public.plan add column if not exists whatif_retire_age numeric check (whatif_retire_age > 0 and whatif_retire_age < 120);
alter table public.plan add column if not exists whatif_loan_extra jsonb check (whatif_loan_extra is null or jsonb_typeof(whatif_loan_extra) = 'object');
