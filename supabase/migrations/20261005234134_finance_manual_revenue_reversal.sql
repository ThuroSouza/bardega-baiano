-- Correção de receitas manuais sem apagar o lançamento original.
alter table public.financial_entries
  add column source_entry_id uuid references public.financial_entries(id) on delete restrict,
  add column reversed_at timestamptz,
  drop constraint financial_entries_type_check,
  drop constraint financial_entries_amount_check,
  add constraint financial_entries_type_check check (type in ('RECEITA','ESTORNO','RECEITA_MANUAL','ESTORNO_MANUAL')),
  add constraint financial_entries_amount_check check (
    (type = 'RECEITA' and amount > 0 and sale_id is not null and receivable_id is null and
      request_id is null and source_entry_id is null and reversed_at is null)
    or (type = 'ESTORNO' and amount < 0 and sale_id is not null and receivable_id is null and
      request_id is null and source_entry_id is null and reversed_at is null)
    or (type = 'RECEITA_MANUAL' and amount > 0 and sale_id is null and source_entry_id is null and
      char_length(btrim(description)) between 3 and 200 and payment_method is not null and
      ((receivable_id is null and request_id is not null) or
       (receivable_id is not null and request_id is null and reversed_at is null)))
    or (type = 'ESTORNO_MANUAL' and amount < 0 and sale_id is null and receivable_id is null and
      request_id is null and source_entry_id is not null and reversed_at is null and
      char_length(btrim(description)) between 3 and 200 and payment_method is not null)
  );
create unique index financial_manual_reversal_unique on public.financial_entries(source_entry_id)
  where source_entry_id is not null;

create function public.reverse_manual_revenue(p_entry_id uuid, p_reason text)
returns public.financial_entries language plpgsql security definer set search_path = '' as $$
declare
  v_source public.financial_entries;
  v_reversal public.financial_entries;
begin
  if not private.has_permission('finance.manage') or (select auth.uid()) is null then
    raise exception 'finance_permission_denied' using errcode = '42501';
  end if;
  if p_entry_id is null or p_reason is null or char_length(btrim(p_reason)) not between 3 and 500 then
    raise exception 'finance_invalid_input' using errcode = '22023';
  end if;
  select * into v_source from public.financial_entries where id = p_entry_id for update;
  if not found then raise exception 'finance_not_found' using errcode = '22023'; end if;
  if v_source.type <> 'RECEITA_MANUAL' or v_source.receivable_id is not null then
    raise exception 'finance_invalid_reversal' using errcode = '22023';
  end if;
  select * into v_reversal from public.financial_entries where source_entry_id = p_entry_id;
  if found then
    if v_reversal.notes <> btrim(p_reason) then raise exception 'finance_already_resolved' using errcode = '22023'; end if;
    return v_reversal;
  end if;
  insert into public.financial_entries (
    user_id, type, amount, description, payment_method, received_on, notes, source_entry_id
  ) values (
    (select auth.uid()), 'ESTORNO_MANUAL', -v_source.amount,
    left('Estorno: ' || v_source.description, 200), v_source.payment_method,
    (now() at time zone 'America/Sao_Paulo')::date, btrim(p_reason), p_entry_id
  ) returning * into v_reversal;
  update public.financial_entries set reversed_at = now() where id = p_entry_id;
  insert into public.audit_logs (user_id, action, entity, entity_id, after_data)
    values ((select auth.uid()), 'FINANCE_REVENUE_REVERSED', 'financial_entries', v_reversal.id,
      jsonb_build_object('source_entry_id', p_entry_id, 'amount', v_reversal.amount, 'reason', btrim(p_reason)));
  return v_reversal;
end;
$$;
revoke all on function public.reverse_manual_revenue(uuid,text) from public, anon, authenticated;
grant execute on function public.reverse_manual_revenue(uuid,text) to authenticated;
