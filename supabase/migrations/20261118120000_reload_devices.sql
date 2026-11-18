-- "Reload all my devices": when set, every device that has synced this plan before throws away its
-- copy and loads a fresh one from the account the next time it syncs (right away if it's open).
-- A device remembers the last value it acted on, so each request reloads it once.
--
-- The app never sends this column with the plan (save_plan only writes the columns it's sent), so
-- saving a plan can't clear or change it.
alter table public.plan add column if not exists reload_at timestamptz;

-- Set it to the server's time (not a device's clock). Security invoker: the plan's own row rules
-- decide who may (its owner, and members with full access).
create or replace function public.reload_devices(p uuid) returns timestamptz
language plpgsql security invoker set search_path = '' as $$
declare
  t timestamptz := now();
begin
  update public.plan set reload_at = t where id = p;
  if not found then
    raise exception 'No such plan, or not yours to change';
  end if;
  return t;
end;
$$;

revoke all on function public.reload_devices(uuid) from public, anon;
grant execute on function public.reload_devices(uuid) to authenticated;
