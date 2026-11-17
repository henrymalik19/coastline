-- The category a transaction (or split line) had where it came from, e.g. "Dining: Restaurants" in
-- YNAB, kept when that category wasn't brought in. Hidden: not shown or editable in the app; there so
-- old spending can be sorted into it later (a spending-by-category report).
alter table public.transaction add column original_category text;
alter table public.transaction_split add column original_category text;

-- save_transactions: as before, plus original_category on transactions and split lines
create or replace function public.save_transactions(p uuid, p_rows jsonb) returns void
language plpgsql security invoker set search_path = '' as $$
declare
  e jsonb;
  kept boolean;
begin
  for e in select * from jsonb_array_elements(p_rows) loop
    insert into public.transaction (plan_id, id, account_id, date, amount, payee, memo, category_id, transfer_account_id, transfer_id, cleared, source, import_id, deleted, tracked_amount, original_category, client_updated_at)
    values (
      p, e ->> 'id', e ->> 'account_id', (e ->> 'date')::date, (e ->> 'amount')::numeric, e ->> 'payee', e ->> 'memo', e ->> 'category_id',
      e ->> 'transfer_account_id', e ->> 'transfer_id', coalesce(e ->> 'cleared', 'uncleared'), coalesce(e ->> 'source', 'manual'),
      e ->> 'import_id', coalesce((e ->> 'deleted')::boolean, false), (e ->> 'tracked_amount')::numeric, e ->> 'original_category',
      coalesce((e ->> 'client_updated_at')::bigint, 0)
    )
    on conflict (plan_id, id) do update set
      account_id = excluded.account_id, date = excluded.date, amount = excluded.amount, payee = excluded.payee, memo = excluded.memo,
      category_id = excluded.category_id, transfer_account_id = excluded.transfer_account_id, transfer_id = excluded.transfer_id,
      cleared = excluded.cleared, source = excluded.source, import_id = excluded.import_id, deleted = excluded.deleted,
      tracked_amount = excluded.tracked_amount, original_category = excluded.original_category, client_updated_at = excluded.client_updated_at;
    select x.client_updated_at = coalesce((e ->> 'client_updated_at')::bigint, 0) into kept from public.transaction x where x.plan_id = p and x.id = e ->> 'id';
    if kept then
      delete from public.transaction_split where plan_id = p and transaction_id = e ->> 'id';
      insert into public.transaction_split (plan_id, transaction_id, sort, category_id, amount, memo, original_category)
      select p, e ->> 'id', s.ord - 1, s.v ->> 'category_id', (s.v ->> 'amount')::numeric, s.v ->> 'memo', s.v ->> 'original_category'
      from jsonb_array_elements(coalesce(e -> 'splits', '[]'::jsonb)) with ordinality as s (v, ord);
    end if;
  end loop;
end;
$$;
