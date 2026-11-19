-- Diagnostics someone sends from the app (Settings → Backup & restore → Diagnostics), to help with a
-- problem: the app's version, the device, how much it holds, and how sync is doing. No amounts, names
-- or transactions. Anyone signed in can send their own; nobody can read them back through the app
-- (there's no read policy): they're looked at in the Supabase dashboard.
create table public.diagnostic_report (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  note text check (note is null or char_length(note) <= 2000),
  report jsonb not null check (pg_column_size(report) <= 20000)
);
create index diagnostic_report_created on public.diagnostic_report (created_at desc);
alter table public.diagnostic_report enable row level security;
revoke all on public.diagnostic_report from anon;
revoke all on public.diagnostic_report from authenticated;
grant insert on public.diagnostic_report to authenticated;
create policy "diagnostic_report: send" on public.diagnostic_report for insert to authenticated with check (user_id = auth.uid());
