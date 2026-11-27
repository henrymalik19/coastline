-- Bank transactions, step one: a transaction from a bank that's also in YNAB keeps YNAB's id (ynab_id),
-- so a YNAB import finds it instead of adding it again.
alter table public.transaction add column if not exists ynab_id text;

-- save_transactions: as before, plus ynab_id
create or replace function public.save_transactions(p uuid, p_rows jsonb) returns void
language plpgsql security invoker set search_path = '' as $$
declare
  e jsonb;
  kept boolean;
begin
  for e in select * from jsonb_array_elements(p_rows) loop
    insert into public.transaction (plan_id, id, account_id, date, amount, payee, memo, category_id, transfer_account_id, transfer_id, cleared, source, import_id, deleted, tracked_amount, original_category, review, ynab_id, client_updated_at)
    values (
      p, e ->> 'id', e ->> 'account_id', (e ->> 'date')::date, (e ->> 'amount')::numeric, e ->> 'payee', e ->> 'memo', e ->> 'category_id',
      e ->> 'transfer_account_id', e ->> 'transfer_id', coalesce(e ->> 'cleared', 'uncleared'), coalesce(e ->> 'source', 'manual'),
      e ->> 'import_id', coalesce((e ->> 'deleted')::boolean, false), (e ->> 'tracked_amount')::numeric, e ->> 'original_category',
      coalesce((e ->> 'review')::boolean, false), e ->> 'ynab_id', coalesce((e ->> 'client_updated_at')::bigint, 0)
    )
    on conflict (plan_id, id) do update set
      account_id = excluded.account_id, date = excluded.date, amount = excluded.amount, payee = excluded.payee, memo = excluded.memo,
      category_id = excluded.category_id, transfer_account_id = excluded.transfer_account_id, transfer_id = excluded.transfer_id,
      cleared = excluded.cleared, source = excluded.source, import_id = excluded.import_id, deleted = excluded.deleted,
      tracked_amount = excluded.tracked_amount, original_category = excluded.original_category, review = excluded.review, ynab_id = excluded.ynab_id,
      client_updated_at = excluded.client_updated_at;
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
