-- Live updates: other signed-in devices hear about plan changes right away (RLS still applies).
alter publication supabase_realtime add table public.plans;

-- Let a signed-in user delete their own account and everything in it.
-- Runs with elevated rights, but only ever touches the caller's own auth user;
-- plans, check-ins and profile rows go with it via ON DELETE CASCADE.
create function public.delete_my_account() returns void
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'not signed in';
  end if;
  delete from auth.users where id = me;
end;
$$;

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
