/*
 * Check-ins get an edit time, like transactions: when two devices have different copies of the same
 * month, the newer one wins. Before, each device's copy always won on that device and was uploaded on
 * every save, so a fix made on one device was put back by the other.
 */
alter table public.checkin add column if not exists client_updated_at bigint not null default 0;

-- an older copy never overwrites a newer one (a device that hasn't seen the fix yet)
create or replace function public.checkin_keep_newer() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.client_updated_at < old.client_updated_at then
    return old;
  end if;
  return new;
end;
$$;
revoke all on function public.checkin_keep_newer() from public, anon, authenticated;
drop trigger if exists checkin_keep_newer on public.checkin;
create trigger checkin_keep_newer before update on public.checkin
  for each row execute function public.checkin_keep_newer();
