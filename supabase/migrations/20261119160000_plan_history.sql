/*
 * Plan history: earlier versions of a plan (its settings and lists; not transactions or check-ins,
 * which are never replaced wholesale), so a plan replaced by mistake can be restored.
 *
 * - Before a plan changes, the server keeps a copy of it as it was: at most one every 10 minutes
 *   while it's being edited.
 * - The app can also ask for a copy right before something big (replacing the plan with another
 *   device's, restoring an earlier one), or hand one in (a plan that was only on a device, kept in
 *   the account before the device switches to a plan shared with it).
 * - Versions older than 30 days are removed; at most 200 are kept per plan.
 * - Whoever can use the plan can read its versions. Only the server writes them.
 */
create table public.plan_version (
  id bigint generated always as identity primary key,
  plan_id uuid not null references public.plan (id) on delete cascade,
  saved_at timestamptz not null default now(),
  -- why it was kept, when it wasn't the usual copy before a change
  note text,
  -- the plan as get_plan returns it
  snapshot jsonb not null
);
create index plan_version_plan on public.plan_version (plan_id, saved_at desc);
alter table public.plan_version enable row level security;
create policy "plan_version: read" on public.plan_version for select to authenticated using (public.can_use_plan(plan_id));

-- remove old versions of a plan
create function public.prune_plan_versions(p uuid) returns void
language sql security definer set search_path = '' as $$
  delete from public.plan_version where plan_id = p and saved_at < now() - interval '30 days';
  delete from public.plan_version where plan_id = p and id not in (
    select id from public.plan_version where plan_id = p order by saved_at desc, id desc limit 200
  );
$$;
revoke all on function public.prune_plan_versions(uuid) from public, anon, authenticated;

-- before a plan changes: keep it as it was (a new plan, never saved, has nothing to keep)
create function public.keep_plan_version() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(old.client_updated_at, 0) <= 0 then
    return new;
  end if;
  if exists (select 1 from public.plan_version where plan_id = old.id and saved_at > now() - interval '10 minutes') then
    return new;
  end if;
  insert into public.plan_version (plan_id, snapshot) values (old.id, public.get_plan(old.id));
  perform public.prune_plan_versions(old.id);
  return new;
end;
$$;
revoke all on function public.keep_plan_version() from public, anon, authenticated;
create trigger plan_keep_version before update on public.plan for each row execute function public.keep_plan_version();

/*
 * Keep a version now, with a note: the plan as the server has it, or (p_snapshot) one the app hands
 * in, shaped like get_plan's. Returns the version's id, or null when there's no plan to keep.
 */
create function public.save_plan_version(p uuid, p_note text, p_snapshot jsonb default null) returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  snap jsonb;
  vid bigint;
begin
  if not public.can_use_plan(p) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_snapshot is not null and (jsonb_typeof(p_snapshot) <> 'object' or jsonb_typeof(p_snapshot -> 'plan') <> 'object' or pg_column_size(p_snapshot) > 2000000) then
    raise exception 'not a plan' using errcode = '22023';
  end if;
  snap := coalesce(p_snapshot, public.get_plan(p));
  if snap is null then
    return null;
  end if;
  insert into public.plan_version (plan_id, note, snapshot) values (p, left(p_note, 200), snap) returning id into vid;
  perform public.prune_plan_versions(p);
  return vid;
end;
$$;
revoke all on function public.save_plan_version(uuid, text, jsonb) from public, anon;
grant execute on function public.save_plan_version(uuid, text, jsonb) to authenticated;
