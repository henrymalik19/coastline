-- A rental you keep after you retire (null = yes; false = you'll sell it first), and the cushion
-- for empty months as a share of its rent (null = 5%).
alter table public.property add column in_retirement boolean;
alter table public.property add column vacancy numeric;
