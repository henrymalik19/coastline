-- A household member can read every transaction on the cards shared with them, but only edit or
-- delete the ones they added. `created_by` records who added a row (the owner's own rows get the
-- owner's id; rows from before this migration have none, so they count as the owner's).

alter table public.transactions add column created_by uuid default auth.uid();

-- nobody rewrites who added a row
create function public.transactions_keep_creator() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.created_by := old.created_by;
  return new;
end;
$$;

create trigger transactions_keep_creator
  before update on public.transactions
  for each row execute function public.transactions_keep_creator();

drop policy "transactions: member adds to shared accounts" on public.transactions;
create policy "transactions: member adds to shared accounts" on public.transactions
  for insert to authenticated
  with check (
    public.shared_account(user_id, account_id) and created_by = (select auth.uid())
    and transfer_account_id is null and source = 'manual'
  );

drop policy "transactions: member edits shared accounts" on public.transactions;
create policy "transactions: member edits own on shared accounts" on public.transactions
  for update to authenticated
  using (public.shared_account(user_id, account_id) and created_by = (select auth.uid()))
  with check (public.shared_account(user_id, account_id) and transfer_account_id is null);
