-- A ordem de solicitações precisa ser estável mesmo quando horários coincidem.
alter table public.sale_cancellation_requests
  add column request_sequence bigint generated always as identity unique;
drop index public.sale_cancellation_sale_requested_idx;
create index sale_cancellation_sale_sequence_idx
  on public.sale_cancellation_requests(sale_id, request_sequence desc);

create or replace function public.get_sale_context(p_sale_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_context jsonb;
begin
  if not private.has_permission('sales.read') then
    raise exception 'sales_permission_denied' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'operator_name', coalesce(nullif(btrim(p.display_name), ''), 'Operador ' || left(p.id::text, 8)),
    'cash_net', (select coalesce(sum(cm.amount), 0) from public.cash_movements cm where cm.sale_id = s.id),
    'financial_net', (select coalesce(sum(fe.amount), 0) from public.financial_entries fe where fe.sale_id = s.id),
    'request', (select jsonb_build_object(
      'id', cr.id, 'status', cr.status, 'reason', cr.reason,
      'requested_by_name', coalesce(nullif(btrim(requester.display_name), ''), 'Operador ' || left(requester.id::text, 8)),
      'requested_at', cr.requested_at, 'decision_reason', cr.decision_reason,
      'decided_at', cr.decided_at
    ) from public.sale_cancellation_requests cr
      join public.profiles requester on requester.id = cr.requested_by
      where cr.sale_id = s.id order by cr.request_sequence desc limit 1),
    'cancelled_at', s.cancelled_at, 'cancellation_reason', s.cancellation_reason
  ) into v_context
  from public.sales s join public.profiles p on p.id = s.operator_id
  where s.id = p_sale_id;
  if v_context is null then
    raise exception 'sale_not_found' using errcode = '22023';
  end if;
  return v_context;
end;
$$;
revoke all on function public.get_sale_context(uuid) from public, anon, authenticated;
grant execute on function public.get_sale_context(uuid) to authenticated;

