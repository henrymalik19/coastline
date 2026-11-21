/*
 * Who owns a plan, as one helper. Many rules still say "plan_id = auth.uid()" (a plan's id is its
 * owner's user id today). New rules should ask is_owner(plan_id) instead, and paid features (Plus)
 * should be looked up from the plan's owner (plan.owner_id), not the signed-in person, so a plan can
 * later have its own id (several plans per account) without rewriting every rule.
 */
create or replace function public.is_owner(p uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.plan where id = p and owner_id = (select auth.uid()));
$$;
revoke all on function public.is_owner(uuid) from public, anon;
grant execute on function public.is_owner(uuid) to authenticated;

-- the owner of a plan (for features that belong to the owner's account, like Plus)
create or replace function public.plan_owner(p uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select owner_id from public.plan where id = p and public.can_use_plan(p);
$$;
revoke all on function public.plan_owner(uuid) from public, anon;
grant execute on function public.plan_owner(uuid) to authenticated;
