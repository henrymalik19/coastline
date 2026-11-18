-- Sub categories: a category can sit under another one (one level), with its own amount and money; the
-- one above shows the total. And an archived (hidden) category remembers its monthly amount, to offer
-- it again when restored. get_plan and save_plan pick the columns up by name.
alter table public.category add column if not exists parent_id text;
alter table public.category add column if not exists archived_amount numeric check (archived_amount >= 0);
