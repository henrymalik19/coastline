-- A category's retirement amount can follow what you've spent on it lately ("avg") instead of its plan amount.
alter table public.category add column if not exists retire_from text check (retire_from in ('avg'));
