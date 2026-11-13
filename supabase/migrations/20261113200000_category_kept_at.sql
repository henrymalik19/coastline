-- A category whose plan amount you chose to keep after seeing what you really spend: the average
-- spending you saw then (it's flagged again only if your spending moves well away from it).
alter table public.category add column kept_at numeric;
