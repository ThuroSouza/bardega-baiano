-- Bloco 7: sessões de caixa por operador e livro de movimentos imutável.
insert into private.role_permissions (role, permission) values
  ('ADMIN', 'cash.view_all'), ('GERENTE', 'cash.view_all');

create table public.cash_sessions (
  id uuid primary key default gen_random_uuid(),
  session_number bigint generated always as identity unique,
  opened_by uuid not null references public.profiles(id) on delete restrict,
  opened_at timestamptz not null default now(),
  opening_amount numeric(14,2) not null check (opening_amount >= 0),
  open_request_id uuid not null unique,
  status text not null default 'ABERTO' check (status in ('ABERTO','FECHADO')),
  closed_at timestamptz,
  closed_by uuid references public.profiles(id) on delete restrict,
  counted_amount numeric(14,2),
  expected_amount numeric(14,2),
  difference_amount numeric(14,2),
  close_note text not null default '' check (char_length(close_note) <= 500),
  constraint cash_session_close_state check (
    (status = 'ABERTO' and closed_at is null and closed_by is null and
      counted_amount is null and expected_amount is null and difference_amount is null and close_note = '')
    or (status = 'FECHADO' and closed_at is not null and closed_by is not null and
      counted_amount >= 0 and expected_amount >= 0 and
      difference_amount = counted_amount - expected_amount)
  )
);
create unique index cash_one_open_per_operator on public.cash_sessions(opened_by)
  where status = 'ABERTO';
create index cash_sessions_opened_idx on public.cash_sessions(opened_at desc);
create index cash_sessions_operator_opened_idx on public.cash_sessions(opened_by, opened_at desc);

alter table public.cash_sessions enable row level security;
revoke all on public.cash_sessions from public, anon, authenticated;
grant select on public.cash_sessions to authenticated;
create policy cash_sessions_read on public.cash_sessions for select to authenticated
using ((select private.has_permission('cash.manage')) and
  (opened_by = (select auth.uid()) or (select private.has_permission('cash.view_all'))));

alter table public.sales add column cash_session_id uuid references public.cash_sessions(id) on delete restrict;
create index sales_cash_session_idx on public.sales(cash_session_id) where cash_session_id is not null;
alter table public.cash_movements
  alter column sale_id drop not null,
  add column session_id uuid references public.cash_sessions(id) on delete restrict,
  add column request_id uuid unique,
  add column reason text not null default '' check (char_length(reason) <= 500),
  drop constraint cash_movements_kind_check,
  drop constraint cash_movements_amount_check,
  add constraint cash_movements_kind_check check
    (kind in ('SALE_PAYMENT','SALE_REVERSAL','OPENING','SUPPLY','WITHDRAWAL')),
  add constraint cash_movements_amount_check check (
    (kind = 'SALE_PAYMENT' and sale_id is not null and source_payment_id is null and request_id is null and amount > 0)
    or (kind = 'SALE_REVERSAL' and sale_id is not null and source_payment_id is not null and request_id is null and amount < 0)
    or (kind = 'OPENING' and sale_id is null and source_payment_id is null and request_id is null and session_id is not null and method = 'DINHEIRO' and amount >= 0)
    or (kind = 'SUPPLY' and sale_id is null and source_payment_id is null and request_id is not null and session_id is not null and method = 'DINHEIRO' and amount > 0 and char_length(btrim(reason)) >= 3)
    or (kind = 'WITHDRAWAL' and sale_id is null and source_payment_id is null and request_id is not null and session_id is not null and method = 'DINHEIRO' and amount < 0 and char_length(btrim(reason)) >= 3)
  );
create index cash_movements_session_created_idx on public.cash_movements(session_id, created_at desc)
  where session_id is not null;

-- Operadores enxergam as próprias sessões. Gerente e ADMIN enxergam todas.
drop policy cash_movements_read on public.cash_movements;
create policy cash_movements_read on public.cash_movements for select to authenticated
using ((select private.has_permission('cash.view_all')) or
  ((select private.has_permission('cash.manage')) and
    ((session_id is null and user_id = (select auth.uid())) or
     exists (select 1 from public.cash_sessions cs
       where cs.id = session_id and cs.opened_by = (select auth.uid())))));

create function public.open_cash_session(p_request_id uuid, p_opening_amount numeric)
returns public.cash_sessions
language plpgsql security definer set search_path = '' as $$
declare v_session public.cash_sessions;
begin
  if not private.has_permission('cash.manage') or (select auth.uid()) is null then
    raise exception 'cash_permission_denied' using errcode = '42501';
  end if;
  if p_request_id is null or p_opening_amount is null or p_opening_amount < 0 or
    p_opening_amount > 999999999999.99 or p_opening_amount <> trunc(p_opening_amount, 2) then
    raise exception 'cash_invalid_amount' using errcode = '22023';
  end if;
  perform 1 from public.profiles where id = (select auth.uid()) for update;
  select * into v_session from public.cash_sessions where open_request_id = p_request_id;
  if found then
    if v_session.opened_by <> (select auth.uid()) or v_session.opening_amount <> p_opening_amount then
      raise exception 'cash_request_reused' using errcode = '22023';
    end if;
    return v_session;
  end if;
  if exists (select 1 from public.cash_sessions where opened_by = (select auth.uid()) and status = 'ABERTO') then
    raise exception 'cash_already_open' using errcode = '22023';
  end if;
  insert into public.cash_sessions (opened_by, opening_amount, open_request_id)
    values ((select auth.uid()), p_opening_amount, p_request_id) returning * into v_session;
  insert into public.cash_movements (session_id, user_id, kind, method, amount, reason)
    values (v_session.id, (select auth.uid()), 'OPENING', 'DINHEIRO', p_opening_amount, 'Abertura de caixa');
  insert into public.audit_logs (user_id, action, entity, entity_id, after_data)
    values ((select auth.uid()), 'CASH_OPENED', 'cash_sessions', v_session.id,
      jsonb_build_object('session_number', v_session.session_number, 'opening_amount', p_opening_amount));
  return v_session;
end;
$$;
revoke all on function public.open_cash_session(uuid,numeric) from public, anon, authenticated;
grant execute on function public.open_cash_session(uuid,numeric) to authenticated;

create function public.add_cash_adjustment(
  p_session_id uuid, p_request_id uuid, p_kind text, p_amount numeric, p_reason text
)
returns public.cash_movements
language plpgsql security definer set search_path = '' as $$
declare
  v_session public.cash_sessions;
  v_movement public.cash_movements;
  v_expected numeric(14,2);
  v_signed numeric(14,2);
begin
  if not private.has_permission('cash.manage') or (select auth.uid()) is null then
    raise exception 'cash_permission_denied' using errcode = '42501';
  end if;
  if p_session_id is null or p_request_id is null or p_kind not in ('SUPPLY','WITHDRAWAL') or
    p_amount is null or p_amount <= 0 or p_amount > 999999999999.99 or
    p_amount <> trunc(p_amount, 2) or p_reason is null or
    char_length(btrim(p_reason)) not between 3 and 500 then
    raise exception 'cash_invalid_adjustment' using errcode = '22023';
  end if;
  select * into v_session from public.cash_sessions where id = p_session_id for update;
  if not found then raise exception 'cash_session_not_found' using errcode = '22023'; end if;
  if v_session.opened_by <> (select auth.uid()) and not private.has_permission('cash.view_all') then
    raise exception 'cash_permission_denied' using errcode = '42501';
  end if;
  v_signed := case when p_kind = 'WITHDRAWAL' then -p_amount else p_amount end;
  select * into v_movement from public.cash_movements where request_id = p_request_id;
  if found then
    if v_movement.session_id <> p_session_id or v_movement.user_id <> (select auth.uid()) or
      v_movement.kind <> p_kind or v_movement.amount <> v_signed or v_movement.reason <> btrim(p_reason) then
      raise exception 'cash_request_reused' using errcode = '22023';
    end if;
    return v_movement;
  end if;
  if v_session.status <> 'ABERTO' then raise exception 'cash_session_closed' using errcode = '22023'; end if;
  if p_kind = 'WITHDRAWAL' then
    select coalesce(sum(amount), 0) into v_expected from public.cash_movements
      where session_id = p_session_id and method = 'DINHEIRO';
    if v_expected < p_amount then raise exception 'cash_insufficient' using errcode = '22023'; end if;
  end if;
  insert into public.cash_movements (session_id, user_id, kind, method, amount, reason, request_id)
    values (p_session_id, (select auth.uid()), p_kind, 'DINHEIRO', v_signed, btrim(p_reason), p_request_id)
    returning * into v_movement;
  insert into public.audit_logs (user_id, action, entity, entity_id, after_data)
    values ((select auth.uid()), 'CASH_' || p_kind, 'cash_movements', v_movement.id,
      jsonb_build_object('session_id', p_session_id, 'amount', v_signed, 'reason', btrim(p_reason)));
  return v_movement;
end;
$$;
revoke all on function public.add_cash_adjustment(uuid,uuid,text,numeric,text)
  from public, anon, authenticated;
grant execute on function public.add_cash_adjustment(uuid,uuid,text,numeric,text)
  to authenticated;

create function public.close_cash_session(p_session_id uuid, p_counted_amount numeric, p_note text default '')
returns public.cash_sessions
language plpgsql security definer set search_path = '' as $$
declare
  v_session public.cash_sessions;
  v_expected numeric(14,2);
begin
  if not private.has_permission('cash.manage') or (select auth.uid()) is null then
    raise exception 'cash_permission_denied' using errcode = '42501';
  end if;
  if p_session_id is null or p_counted_amount is null or p_counted_amount < 0 or
    p_counted_amount > 999999999999.99 or p_counted_amount <> trunc(p_counted_amount, 2) or
    p_note is null or char_length(p_note) > 500 then
    raise exception 'cash_invalid_amount' using errcode = '22023';
  end if;
  select * into v_session from public.cash_sessions where id = p_session_id for update;
  if not found then raise exception 'cash_session_not_found' using errcode = '22023'; end if;
  if v_session.opened_by <> (select auth.uid()) and not private.has_permission('cash.view_all') then
    raise exception 'cash_permission_denied' using errcode = '42501';
  end if;
  if v_session.status = 'FECHADO' then
    if v_session.closed_by = (select auth.uid()) and v_session.counted_amount = p_counted_amount and
      v_session.close_note = btrim(p_note) then return v_session; end if;
    raise exception 'cash_session_closed' using errcode = '22023';
  end if;
  select coalesce(sum(amount), 0) into v_expected from public.cash_movements
    where session_id = p_session_id and method = 'DINHEIRO';
  if v_expected < 0 then raise exception 'cash_negative_expected' using errcode = '22023'; end if;
  update public.cash_sessions set status = 'FECHADO', closed_at = now(),
    closed_by = (select auth.uid()), counted_amount = p_counted_amount,
    expected_amount = v_expected, difference_amount = p_counted_amount - v_expected,
    close_note = btrim(p_note)
    where id = p_session_id returning * into v_session;
  insert into public.audit_logs (user_id, action, entity, entity_id, after_data)
    values ((select auth.uid()), 'CASH_CLOSED', 'cash_sessions', p_session_id,
      jsonb_build_object('expected', v_expected, 'counted', p_counted_amount,
        'difference', v_session.difference_amount, 'note', btrim(p_note)));
  return v_session;
end;
$$;
revoke all on function public.close_cash_session(uuid,numeric,text) from public, anon, authenticated;
grant execute on function public.close_cash_session(uuid,numeric,text) to authenticated;

create function public.list_cash_sessions(p_limit integer default 50, p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_total bigint; v_rows jsonb;
begin
  if not private.has_permission('cash.manage') then
    raise exception 'cash_permission_denied' using errcode = '42501';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 100 or p_offset is null or p_offset < 0 or p_offset > 100000 then
    raise exception 'cash_invalid_filter' using errcode = '22023';
  end if;
  select count(*) into v_total from public.cash_sessions cs
    where cs.opened_by = (select auth.uid()) or private.has_permission('cash.view_all');
  select coalesce(jsonb_agg(to_jsonb(rows) order by rows.opened_at desc, rows.session_number desc), '[]'::jsonb)
    into v_rows from (
      select cs.id, cs.session_number, cs.opened_by, cs.opened_at, cs.closed_at,
        cs.status, cs.opening_amount, cs.expected_amount, cs.counted_amount,
        cs.difference_amount,
        coalesce(nullif(btrim(p.display_name), ''), 'Operador ' || left(p.id::text, 8)) as operator_name,
        (select count(*) from public.sales s where s.cash_session_id = cs.id) as sale_count
      from public.cash_sessions cs join public.profiles p on p.id = cs.opened_by
      where cs.opened_by = (select auth.uid()) or private.has_permission('cash.view_all')
      order by cs.opened_at desc, cs.session_number desc limit p_limit offset p_offset
    ) rows;
  return jsonb_build_object('total', v_total, 'rows', v_rows);
end;
$$;
revoke all on function public.list_cash_sessions(integer,integer) from public, anon, authenticated;
grant execute on function public.list_cash_sessions(integer,integer) to authenticated;

create function public.get_cash_session(p_session_id uuid, p_limit integer default 50, p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_session public.cash_sessions;
  v_operator_name text;
  v_summary jsonb;
  v_movements jsonb;
  v_movement_count bigint;
begin
  if not private.has_permission('cash.manage') then
    raise exception 'cash_permission_denied' using errcode = '42501';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 100 or p_offset is null or p_offset < 0 or p_offset > 100000 then
    raise exception 'cash_invalid_filter' using errcode = '22023';
  end if;
  select * into v_session from public.cash_sessions where id = p_session_id;
  if not found then raise exception 'cash_session_not_found' using errcode = '22023'; end if;
  if v_session.opened_by <> (select auth.uid()) and not private.has_permission('cash.view_all') then
    raise exception 'cash_permission_denied' using errcode = '42501';
  end if;
  select coalesce(nullif(btrim(display_name), ''), 'Operador ' || left(id::text, 8))
    into v_operator_name from public.profiles where id = v_session.opened_by;
  select jsonb_build_object(
    'cash_sales', coalesce(sum(amount) filter (where kind = 'SALE_PAYMENT' and method = 'DINHEIRO'), 0),
    'pix_sales', coalesce(sum(amount) filter (where kind = 'SALE_PAYMENT' and method = 'PIX'), 0),
    'debit_sales', coalesce(sum(amount) filter (where kind = 'SALE_PAYMENT' and method = 'CARTAO_DEBITO'), 0),
    'credit_sales', coalesce(sum(amount) filter (where kind = 'SALE_PAYMENT' and method = 'CARTAO_CREDITO'), 0),
    'supplies', coalesce(sum(amount) filter (where kind = 'SUPPLY'), 0),
    'withdrawals', -coalesce(sum(amount) filter (where kind = 'WITHDRAWAL'), 0),
    'cancellations', -coalesce(sum(amount) filter (where kind = 'SALE_REVERSAL'), 0),
    'cash_cancellations', -coalesce(sum(amount) filter (where kind = 'SALE_REVERSAL' and method = 'DINHEIRO'), 0),
    'expected_cash', coalesce(sum(amount) filter (where method = 'DINHEIRO'), 0)
  ) into v_summary from public.cash_movements where session_id = p_session_id;
  select count(*) into v_movement_count from public.cash_movements where session_id = p_session_id;
  select coalesce(jsonb_agg(to_jsonb(rows) order by rows.created_at desc, rows.id desc), '[]'::jsonb)
    into v_movements from (
      select cm.id, cm.kind, cm.method, cm.amount, cm.reason, cm.sale_id,
        cm.created_at, s.sale_number,
        coalesce(nullif(btrim(p.display_name), ''), 'Operador ' || left(p.id::text, 8)) as user_name
      from public.cash_movements cm
        left join public.sales s on s.id = cm.sale_id
        join public.profiles p on p.id = cm.user_id
      where cm.session_id = p_session_id
      order by cm.created_at desc, cm.id desc limit p_limit offset p_offset
    ) rows;
  return jsonb_build_object('session', to_jsonb(v_session), 'operator_name', v_operator_name,
    'summary', v_summary, 'movement_count', v_movement_count, 'movements', v_movements);
end;
$$;
revoke all on function public.get_cash_session(uuid,integer,integer) from public, anon, authenticated;
grant execute on function public.get_cash_session(uuid,integer,integer) to authenticated;

-- PDV exige sessão aberta e vincula a venda e o pagamento à sessão.
create or replace function public.checkout_sale(
  p_request_id uuid,
  p_items jsonb,
  p_payment_method text,
  p_expected_total numeric,
  p_discount_amount numeric default 0,
  p_discount_reason text default ''
)
returns public.sales
language plpgsql security definer set search_path = '' as $$
declare
  v_sale public.sales;
  v_item jsonb;
  v_line record;
  v_product_id uuid;
  v_quantity numeric;
  v_gross numeric(14,2);
  v_subtotal numeric(14,2) := 0;
  v_total numeric(14,2);
  v_line_discount numeric(14,2);
  v_remaining_discount numeric(14,2);
  v_remaining_gross numeric(14,2);
  v_lines jsonb := '[]'::jsonb;
  v_seen uuid[] := '{}'::uuid[];
  v_fingerprint text;
  v_cash_session_id uuid;
  v_index integer := 0;
begin
  if not private.has_permission('pdv.use') or (select auth.uid()) is null then
    raise exception 'pdv_permission_denied' using errcode = '42501';
  end if;
  if p_request_id is null or p_items is null or jsonb_typeof(p_items) <> 'array' or
    jsonb_array_length(p_items) not between 1 and 100 then
    raise exception 'sale_invalid_items' using errcode = '22023';
  end if;
  if p_payment_method is null or p_payment_method not in ('DINHEIRO', 'PIX', 'CARTAO_DEBITO', 'CARTAO_CREDITO') then
    raise exception 'sale_invalid_payment' using errcode = '22023';
  end if;
  if p_discount_amount is null or p_discount_amount < 0 or
    p_discount_amount <> trunc(p_discount_amount, 2) or
    p_expected_total is null or p_expected_total <= 0 or
    p_expected_total <> trunc(p_expected_total, 2) or
    p_discount_reason is null or char_length(p_discount_reason) > 500 then
    raise exception 'sale_invalid_amount' using errcode = '22023';
  end if;
  v_fingerprint := md5(p_items::text || '|' || p_payment_method || '|' ||
    p_expected_total::text || '|' || p_discount_amount::text || '|' || p_discount_reason);
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text, 0));
  select * into v_sale from public.sales where request_id = p_request_id;
  if found then
    if v_sale.request_fingerprint <> v_fingerprint or v_sale.operator_id <> (select auth.uid()) then
      raise exception 'sale_request_reused' using errcode = '22023';
    end if;
    return v_sale;
  end if;
  if p_discount_amount > 0 then
    if not private.has_permission('sales.discount') then
      raise exception 'sale_discount_denied' using errcode = '42501';
    end if;
    if char_length(btrim(p_discount_reason)) < 3 then
      raise exception 'sale_discount_reason_required' using errcode = '22023';
    end if;
  end if;
  for v_item in select value from jsonb_array_elements(p_items) order by value ->> 'product_id' loop
    if jsonb_typeof(v_item) <> 'object' or
      (select count(*) from jsonb_object_keys(v_item)) <> 2 or
      not (v_item ? 'product_id' and v_item ? 'quantity') then
      raise exception 'sale_invalid_item' using errcode = '22023';
    end if;
    v_product_id := (v_item ->> 'product_id')::uuid;
    v_quantity := (v_item ->> 'quantity')::numeric;
    if v_product_id is null or v_product_id = any(v_seen) or
      v_quantity is null or v_quantity <= 0 or v_quantity > 999999999.999 or
      v_quantity <> trunc(v_quantity, 3) then
      raise exception 'sale_invalid_quantity' using errcode = '22023';
    end if;
    v_seen := array_append(v_seen, v_product_id);
    select p.id, p.name, p.unit, p.sale_price, p.cost_price, b.quantity as available
      into v_line
    from public.products p join public.stock_balances b on b.product_id = p.id
    where p.id = v_product_id and p.is_active
    for update of p, b;
    if not found or v_line.sale_price <= 0 then
      raise exception 'sale_product_unavailable' using errcode = '22023';
    end if;
    if v_line.unit in ('UN', 'CX', 'PCT') and v_quantity <> trunc(v_quantity) then
      raise exception 'sale_whole_unit_required' using errcode = '22023';
    end if;
    if v_line.available < v_quantity then
      raise exception 'sale_insufficient_stock' using errcode = 'P0001';
    end if;
    v_gross := round(v_line.sale_price * v_quantity, 2);
    v_subtotal := v_subtotal + v_gross;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'product_id', v_line.id, 'name', v_line.name, 'unit', v_line.unit,
      'quantity', v_quantity, 'unit_price', v_line.sale_price,
      'unit_cost', v_line.cost_price, 'gross', v_gross, 'previous', v_line.available
    ));
  end loop;
  if p_discount_amount >= v_subtotal then
    raise exception 'sale_discount_too_high' using errcode = '22023';
  end if;
  v_total := v_subtotal - p_discount_amount;
  if v_total <> p_expected_total then
    raise exception 'sale_price_changed' using errcode = 'P0001';
  end if;
  select id into v_cash_session_id from public.cash_sessions
    where opened_by = (select auth.uid()) and status = 'ABERTO' for update;
  if not found then
    raise exception 'cash_open_session_required' using errcode = '22023';
  end if;
  insert into public.sales (
    operator_id, subtotal, discount_amount, discount_reason, total,
    request_id, request_fingerprint, cash_session_id
  ) values (
    (select auth.uid()), v_subtotal, p_discount_amount, btrim(p_discount_reason),
    v_total, p_request_id, v_fingerprint, v_cash_session_id
  ) returning * into v_sale;
  v_remaining_discount := p_discount_amount;
  v_remaining_gross := v_subtotal;
  for v_item in select value from jsonb_array_elements(v_lines) loop
    v_index := v_index + 1;
    v_gross := (v_item ->> 'gross')::numeric;
    if v_index = jsonb_array_length(v_lines) then
      v_line_discount := v_remaining_discount;
    else
      v_line_discount := greatest(
        0, v_remaining_discount - (v_remaining_gross - v_gross),
        least(v_gross, v_remaining_discount,
          round(v_gross * v_remaining_discount / v_remaining_gross, 2))
      );
    end if;
    v_remaining_discount := v_remaining_discount - v_line_discount;
    v_remaining_gross := v_remaining_gross - v_gross;
    insert into public.sale_items (
      sale_id, product_id, product_name, unit, quantity,
      unit_price, unit_cost, gross_subtotal, discount_amount
    ) values (
      v_sale.id, (v_item ->> 'product_id')::uuid, v_item ->> 'name', v_item ->> 'unit',
      (v_item ->> 'quantity')::numeric, (v_item ->> 'unit_price')::numeric,
      (v_item ->> 'unit_cost')::numeric, v_gross, v_line_discount
    );
    update public.stock_balances
    set quantity = quantity - (v_item ->> 'quantity')::numeric, updated_at = now()
    where product_id = (v_item ->> 'product_id')::uuid;
    insert into public.stock_movements (
      product_id, type, quantity, previous_quantity, new_quantity,
      unit_cost, reason, sale_id, user_id, idempotency_key
    ) values (
      (v_item ->> 'product_id')::uuid, 'VENDA', -(v_item ->> 'quantity')::numeric,
      (v_item ->> 'previous')::numeric,
      (v_item ->> 'previous')::numeric - (v_item ->> 'quantity')::numeric,
      (v_item ->> 'unit_cost')::numeric, 'Venda #' || v_sale.sale_number,
      v_sale.id, (select auth.uid()), gen_random_uuid()
    );
  end loop;
  insert into public.sale_payments (sale_id, method, amount)
  values (v_sale.id, p_payment_method, v_total);
  insert into public.cash_movements (sale_id, session_id, user_id, method, amount)
  values (v_sale.id, v_cash_session_id, (select auth.uid()), p_payment_method, v_total);
  insert into public.financial_entries (sale_id, user_id, amount)
  values (v_sale.id, (select auth.uid()), v_total);
  insert into public.audit_logs (user_id, action, entity, entity_id, after_data)
  values ((select auth.uid()), 'SALE_COMPLETED', 'sales', v_sale.id,
    jsonb_build_object('sale_number', v_sale.sale_number, 'total', v_total,
      'payment_method', p_payment_method, 'discount_amount', p_discount_amount));
  return v_sale;
end;
$$;
revoke all on function public.checkout_sale(uuid,jsonb,text,numeric,numeric,text)
from public, anon, authenticated;
grant execute on function public.checkout_sale(uuid,jsonb,text,numeric,numeric,text)
to authenticated;

-- O cancelamento registra devoluções na sessão aberta apropriada.
create or replace function public.resolve_sale_cancellation(
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
  v_reversal_session_id uuid;
  v_cash_balance numeric(14,2);
  v_cash_refund numeric(14,2);
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
  -- Nunca atribui uma devolução a uma sessão já fechada. Quando necessário,
  -- usa a sessão aberta de quem aprovou o cancelamento.
  select id into v_reversal_session_id from public.cash_sessions
    where id = v_sale.cash_session_id and status = 'ABERTO' for update;
  if v_reversal_session_id is null then
    select id into v_reversal_session_id from public.cash_sessions
      where opened_by = (select auth.uid()) and status = 'ABERTO' for update;
  end if;
  select coalesce(sum(amount), 0) into v_cash_refund from public.sale_payments
    where sale_id = v_sale_id and method = 'DINHEIRO';
  if v_cash_refund > 0 then
    if v_reversal_session_id is null then
      raise exception 'cash_open_session_required' using errcode = '22023';
    end if;
    select coalesce(sum(amount), 0) into v_cash_balance from public.cash_movements
      where session_id = v_reversal_session_id and method = 'DINHEIRO';
    if v_cash_balance < v_cash_refund then
      raise exception 'cash_insufficient' using errcode = '22023';
    end if;
  end if;
  for v_payment in select id, method, amount from public.sale_payments where sale_id = v_sale_id loop
    insert into public.cash_movements (sale_id, session_id, user_id, kind, method, amount, source_payment_id)
      values (v_sale_id, v_reversal_session_id, (select auth.uid()), 'SALE_REVERSAL', v_payment.method,
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

-- Exibe a sessão original no detalhe da venda.
create or replace function public.get_sale_context(p_sale_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_context jsonb;
begin
  if not private.has_permission('sales.read') then
    raise exception 'sales_permission_denied' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'operator_name', coalesce(nullif(btrim(p.display_name), ''), 'Operador ' || left(p.id::text, 8)),
    'cash_session_number', (select cs.session_number from public.cash_sessions cs where cs.id = s.cash_session_id),
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

