-- Bloco 6: consulta paginada e cancelamento com dupla etapa.
insert into private.role_permissions (role, permission) values
  ('ADMIN', 'sales.cancel'), ('GERENTE', 'sales.cancel');

alter table public.sales
  add column cancelled_at timestamptz,
  add column cancelled_by uuid references public.profiles(id) on delete restrict,
  add column cancellation_reason text not null default '' check (char_length(cancellation_reason) <= 500),
  add constraint sales_cancellation_state check (
    (status = 'CANCELADA' and cancelled_at is not null and cancelled_by is not null and char_length(btrim(cancellation_reason)) >= 10)
    or (status <> 'CANCELADA' and cancelled_at is null and cancelled_by is null and cancellation_reason = '')
  );

create table public.sale_cancellation_requests (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.sales(id) on delete restrict,
  requested_by uuid not null references public.profiles(id) on delete restrict,
  reason text not null check (char_length(btrim(reason)) between 10 and 500),
  status text not null default 'PENDENTE' check (status in ('PENDENTE','APROVADA','REJEITADA')),
  requested_at timestamptz not null default now(),
  decided_by uuid references public.profiles(id) on delete restrict,
  decision_reason text not null default '' check (char_length(decision_reason) <= 500),
  decided_at timestamptz,
  constraint cancellation_decision_state check (
    (status = 'PENDENTE' and decided_by is null and decided_at is null and decision_reason = '')
    or (status <> 'PENDENTE' and decided_by is not null and decided_at is not null)
  )
);
create unique index sale_cancellation_pending_unique on public.sale_cancellation_requests(sale_id)
  where status = 'PENDENTE';
create index sale_cancellation_sale_requested_idx on public.sale_cancellation_requests(sale_id, requested_at desc);
create index sale_cancellation_status_requested_idx on public.sale_cancellation_requests(status, requested_at desc);

alter table public.sale_cancellation_requests enable row level security;
revoke all on public.sale_cancellation_requests from public, anon, authenticated;
grant select on public.sale_cancellation_requests to authenticated;
create policy sale_cancellation_requests_read on public.sale_cancellation_requests
  for select to authenticated using ((select private.has_permission('sales.read')));

-- Lançamentos originais permanecem imutáveis; correções são linhas negativas.
alter table public.cash_movements
  drop constraint cash_movements_kind_check,
  drop constraint cash_movements_amount_check,
  add column source_payment_id uuid references public.sale_payments(id) on delete restrict,
  add constraint cash_movements_kind_check check (kind in ('SALE_PAYMENT','SALE_REVERSAL')),
  add constraint cash_movements_amount_check check (
    (kind = 'SALE_PAYMENT' and amount > 0 and source_payment_id is null)
    or (kind = 'SALE_REVERSAL' and amount < 0 and source_payment_id is not null)
  );
create unique index cash_reversal_payment_unique on public.cash_movements(source_payment_id)
  where source_payment_id is not null;

alter table public.financial_entries
  drop constraint financial_entries_sale_id_key,
  drop constraint financial_entries_type_check,
  drop constraint financial_entries_amount_check,
  add constraint financial_entries_type_check check (type in ('RECEITA','ESTORNO')),
  add constraint financial_entries_amount_check check (
    (type = 'RECEITA' and amount > 0) or (type = 'ESTORNO' and amount < 0)
  );
create unique index financial_sale_type_unique on public.financial_entries(sale_id,type);

-- Operadores são expostos pelo histórico, sem conceder leitura geral de perfis ao CAIXA.
create function public.list_sale_operators()
returns table (id uuid, display_name text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.has_permission('sales.read') then
    raise exception 'sales_permission_denied' using errcode = '42501';
  end if;
  return query
  select p.id, coalesce(nullif(btrim(p.display_name), ''), 'Operador ' || left(p.id::text, 8))
  from public.profiles p where exists (select 1 from public.sales s where s.operator_id = p.id)
  order by 2;
end;
$$;
revoke all on function public.list_sale_operators() from public, anon, authenticated;
grant execute on function public.list_sale_operators() to authenticated;

-- Período usa fuso de São Paulo, mantendo a coluna created_at indexável.
create function public.list_sales(
  p_from_date date,
  p_to_date date,
  p_operator_id uuid default null,
  p_payment_method text default '',
  p_status text default '',
  p_page integer default 0,
  p_page_size integer default 30
)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_from timestamptz;
  v_to timestamptz;
  v_total bigint;
  v_rows jsonb;
begin
  if not private.has_permission('sales.read') then
    raise exception 'sales_permission_denied' using errcode = '42501';
  end if;
  if p_from_date is null or p_to_date is null or p_from_date > p_to_date or
    p_page is null or p_page < 0 or p_page > 100000 or
    p_page_size is null or p_page_size < 1 or p_page_size > 100 or
    p_payment_method is null or p_payment_method not in ('','DINHEIRO','PIX','CARTAO_DEBITO','CARTAO_CREDITO') or
    p_status is null or p_status not in ('','CONCLUIDA','CANCELADA','ESTORNADA') then
    raise exception 'sales_invalid_filter' using errcode = '22023';
  end if;
  v_from := p_from_date::timestamp at time zone 'America/Sao_Paulo';
  v_to := (p_to_date + 1)::timestamp at time zone 'America/Sao_Paulo';
  select count(*) into v_total from public.sales s
    where s.created_at >= v_from and s.created_at < v_to
      and (p_operator_id is null or s.operator_id = p_operator_id)
      and (p_status = '' or s.status = p_status)
      and (p_payment_method = '' or exists (
        select 1 from public.sale_payments sp where sp.sale_id = s.id and sp.method = p_payment_method
      ));
  select coalesce(jsonb_agg(to_jsonb(page_rows) order by page_rows.created_at desc, page_rows.sale_number desc), '[]'::jsonb)
    into v_rows
  from (
    select s.id, s.sale_number, s.created_at, s.status, s.operator_id,
      coalesce(nullif(btrim(p.display_name), ''), 'Operador ' || left(p.id::text, 8)) as operator_name,
      s.total,
      (select count(*) from public.sale_items si where si.sale_id = s.id) as item_count,
      (select coalesce(array_agg(distinct sp.method), array[]::text[]) from public.sale_payments sp where sp.sale_id = s.id) as payment_methods
    from public.sales s join public.profiles p on p.id = s.operator_id
    where s.created_at >= v_from and s.created_at < v_to
      and (p_operator_id is null or s.operator_id = p_operator_id)
      and (p_status = '' or s.status = p_status)
      and (p_payment_method = '' or exists (
        select 1 from public.sale_payments sp where sp.sale_id = s.id and sp.method = p_payment_method
      ))
    order by s.created_at desc, s.sale_number desc
    limit p_page_size offset (p_page * p_page_size)
  ) page_rows;
  return jsonb_build_object('total', v_total, 'rows', v_rows);
end;
$$;
revoke all on function public.list_sales(date,date,uuid,text,text,integer,integer)
  from public, anon, authenticated;
grant execute on function public.list_sales(date,date,uuid,text,text,integer,integer)
  to authenticated;

create function public.get_sale_context(p_sale_id uuid)
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
      where cr.sale_id = s.id order by cr.requested_at desc limit 1),
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

create function public.request_sale_cancellation(p_sale_id uuid, p_reason text)
returns public.sale_cancellation_requests
language plpgsql security definer set search_path = '' as $$
declare
  v_sale public.sales;
  v_request public.sale_cancellation_requests;
begin
  if not private.has_permission('sales.read') or (select auth.uid()) is null then
    raise exception 'sales_permission_denied' using errcode = '42501';
  end if;
  if p_sale_id is null or p_reason is null or char_length(btrim(p_reason)) not between 10 and 500 then
    raise exception 'cancellation_invalid_reason' using errcode = '22023';
  end if;
  select * into v_sale from public.sales where id = p_sale_id for update;
  if not found then raise exception 'sale_not_found' using errcode = '22023'; end if;
  if v_sale.status <> 'CONCLUIDA' then
    raise exception 'sale_not_cancellable' using errcode = '22023';
  end if;
  select * into v_request from public.sale_cancellation_requests
    where sale_id = p_sale_id and status = 'PENDENTE';
  if found then
    if v_request.requested_by = (select auth.uid()) and v_request.reason = btrim(p_reason) then
      return v_request;
    end if;
    raise exception 'cancellation_already_pending' using errcode = '22023';
  end if;
  insert into public.sale_cancellation_requests (sale_id, requested_by, reason)
    values (p_sale_id, (select auth.uid()), btrim(p_reason)) returning * into v_request;
  insert into public.audit_logs (user_id, action, entity, entity_id, after_data)
    values ((select auth.uid()), 'SALE_CANCELLATION_REQUESTED', 'sales', p_sale_id,
      jsonb_build_object('request_id', v_request.id, 'reason', v_request.reason));
  return v_request;
end;
$$;
revoke all on function public.request_sale_cancellation(uuid,text) from public, anon, authenticated;
grant execute on function public.request_sale_cancellation(uuid,text) to authenticated;

create function public.resolve_sale_cancellation(
  p_request_id uuid, p_approve boolean, p_decision_reason text default ''
)
returns public.sales
language plpgsql security definer set search_path = '' as $$
declare
  v_sale_id uuid;
  v_sale public.sales;
  v_request public.sale_cancellation_requests;
  v_item record;
  v_payment record;
  v_previous numeric(14,3);
  v_reason text;
begin
  if not private.has_permission('sales.cancel') or (select auth.uid()) is null then
    raise exception 'cancellation_permission_denied' using errcode = '42501';
  end if;
  if p_request_id is null or p_approve is null or p_decision_reason is null or
    char_length(p_decision_reason) > 500 or
    (not p_approve and char_length(btrim(p_decision_reason)) < 3) then
    raise exception 'cancellation_invalid_decision' using errcode = '22023';
  end if;
  select sale_id into v_sale_id from public.sale_cancellation_requests where id = p_request_id;
  if not found then raise exception 'cancellation_request_not_found' using errcode = '22023'; end if;
  select * into v_sale from public.sales where id = v_sale_id for update;
  select * into v_request from public.sale_cancellation_requests where id = p_request_id for update;
  if v_request.status <> 'PENDENTE' or v_sale.status <> 'CONCLUIDA' then
    raise exception 'cancellation_already_resolved' using errcode = '22023';
  end if;
  if not p_approve then
    update public.sale_cancellation_requests
      set status = 'REJEITADA', decided_by = (select auth.uid()),
        decision_reason = btrim(p_decision_reason), decided_at = now()
      where id = p_request_id;
    insert into public.audit_logs (user_id, action, entity, entity_id, after_data)
      values ((select auth.uid()), 'SALE_CANCELLATION_REJECTED', 'sales', v_sale_id,
        jsonb_build_object('request_id', p_request_id, 'reason', btrim(p_decision_reason)));
    return v_sale;
  end if;
  v_reason := v_request.reason;
  -- Estoque é travado em ordem estável; falhas revertem todos os lançamentos.
  for v_item in select product_id, quantity, unit_cost from public.sale_items
    where sale_id = v_sale_id order by product_id loop
    select quantity into v_previous from public.stock_balances
      where product_id = v_item.product_id for update;
    if not found then raise exception 'cancellation_stock_missing' using errcode = 'P0001'; end if;
    update public.stock_balances set quantity = quantity + v_item.quantity, updated_at = now()
      where product_id = v_item.product_id;
    insert into public.stock_movements (
      product_id, type, quantity, previous_quantity, new_quantity, unit_cost,
      reason, sale_id, user_id, idempotency_key
    ) values (
      v_item.product_id, 'CANCELAMENTO', v_item.quantity, v_previous,
      v_previous + v_item.quantity, v_item.unit_cost,
      'Cancelamento da venda #' || v_sale.sale_number, v_sale_id,
      (select auth.uid()), gen_random_uuid()
    );
  end loop;
  for v_payment in select id, method, amount from public.sale_payments where sale_id = v_sale_id loop
    insert into public.cash_movements (sale_id, user_id, kind, method, amount, source_payment_id)
      values (v_sale_id, (select auth.uid()), 'SALE_REVERSAL', v_payment.method,
        -v_payment.amount, v_payment.id);
  end loop;
  insert into public.financial_entries (sale_id, user_id, type, amount)
    values (v_sale_id, (select auth.uid()), 'ESTORNO', -v_sale.total);
  update public.sales set status = 'CANCELADA', cancelled_at = now(),
    cancelled_by = (select auth.uid()), cancellation_reason = v_reason
    where id = v_sale_id returning * into v_sale;
  update public.sale_cancellation_requests set status = 'APROVADA',
    decided_by = (select auth.uid()), decision_reason = btrim(p_decision_reason),
    decided_at = now() where id = p_request_id;
  insert into public.audit_logs (user_id, action, entity, entity_id, before_data, after_data)
    values ((select auth.uid()), 'SALE_CANCELLED', 'sales', v_sale_id,
      jsonb_build_object('status', 'CONCLUIDA', 'total', v_sale.total),
      jsonb_build_object('status', 'CANCELADA', 'total', v_sale.total,
        'request_id', p_request_id, 'reason', v_reason,
        'decision_reason', btrim(p_decision_reason)));
  return v_sale;
end;
$$;
revoke all on function public.resolve_sale_cancellation(uuid,boolean,text)
  from public, anon, authenticated;
grant execute on function public.resolve_sale_cancellation(uuid,boolean,text)
  to authenticated;
