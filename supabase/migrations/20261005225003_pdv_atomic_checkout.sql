-- Bloco 5: finalização do PDV. O cliente envia apenas IDs, quantidades,
-- pagamento e desconto autorizado; preços, saldos e total são validados aqui.
insert into private.role_permissions (role, permission) values
  ('ADMIN', 'sales.discount'), ('GERENTE', 'sales.discount');

create table public.sales (
  id uuid primary key default gen_random_uuid(),
  sale_number bigint generated always as identity unique,
  status text not null default 'CONCLUIDA' check (status in ('CONCLUIDA', 'CANCELADA', 'ESTORNADA')),
  operator_id uuid not null references public.profiles(id) on delete restrict,
  subtotal numeric(14,2) not null check (subtotal >= 0),
  discount_amount numeric(14,2) not null default 0 check (discount_amount >= 0),
  discount_reason text not null default '' check (char_length(discount_reason) <= 500),
  total numeric(14,2) not null check (total > 0 and total = subtotal - discount_amount),
  request_id uuid not null unique,
  request_fingerprint text not null check (char_length(request_fingerprint) = 32),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index sales_created_idx on public.sales (created_at desc);
create index sales_operator_created_idx on public.sales (operator_id, created_at desc);
create index sales_status_created_idx on public.sales (status, created_at desc);
create trigger sales_updated_at before update on public.sales
for each row execute function private.touch_catalog_updated_at();

create table public.sale_items (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.sales(id) on delete restrict,
  product_id uuid not null references public.products(id) on delete restrict,
  product_name text not null,
  unit text not null,
  quantity numeric(14,3) not null check (quantity > 0),
  unit_price numeric(12,2) not null check (unit_price >= 0),
  unit_cost numeric(12,2) not null check (unit_cost >= 0),
  gross_subtotal numeric(14,2) not null check (gross_subtotal >= 0),
  discount_amount numeric(14,2) not null default 0 check (discount_amount >= 0 and discount_amount <= gross_subtotal),
  net_subtotal numeric generated always as (gross_subtotal - discount_amount) stored,
  created_at timestamptz not null default now(),
  unique (sale_id, product_id)
);
create index sale_items_product_idx on public.sale_items (product_id, created_at desc);

create table public.sale_payments (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.sales(id) on delete restrict,
  method text not null check (method in ('DINHEIRO', 'PIX', 'CARTAO_DEBITO', 'CARTAO_CREDITO')),
  amount numeric(14,2) not null check (amount > 0),
  created_at timestamptz not null default now()
);
create index sale_payments_sale_idx on public.sale_payments (sale_id);
create index sale_payments_method_created_idx on public.sale_payments (method, created_at desc);

-- Os lançamentos são criados junto com a venda, sem depender da futura tela
-- de caixa ou do módulo financeiro. Sessões e conciliação virão nos blocos 7/8.
create table public.cash_movements (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.sales(id) on delete restrict,
  user_id uuid not null references public.profiles(id) on delete restrict,
  kind text not null default 'SALE_PAYMENT' check (kind = 'SALE_PAYMENT'),
  method text not null check (method in ('DINHEIRO', 'PIX', 'CARTAO_DEBITO', 'CARTAO_CREDITO')),
  amount numeric(14,2) not null check (amount > 0),
  created_at timestamptz not null default now()
);
create index cash_movements_sale_idx on public.cash_movements (sale_id);
create index cash_movements_created_idx on public.cash_movements (created_at desc);

create table public.financial_entries (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null unique references public.sales(id) on delete restrict,
  user_id uuid not null references public.profiles(id) on delete restrict,
  type text not null default 'RECEITA' check (type = 'RECEITA'),
  status text not null default 'CONFIRMADA' check (status = 'CONFIRMADA'),
  amount numeric(14,2) not null check (amount > 0),
  created_at timestamptz not null default now()
);
create index financial_entries_created_idx on public.financial_entries (created_at desc);

alter table public.stock_movements
add constraint stock_movements_sale_fk foreign key (sale_id) references public.sales(id) on delete restrict;
create index stock_movements_sale_idx on public.stock_movements (sale_id) where sale_id is not null;

alter table public.sales enable row level security;
alter table public.sale_items enable row level security;
alter table public.sale_payments enable row level security;
alter table public.cash_movements enable row level security;
alter table public.financial_entries enable row level security;
revoke all on public.sales, public.sale_items, public.sale_payments,
  public.cash_movements, public.financial_entries from public, anon, authenticated;
grant select on public.sales, public.sale_items, public.sale_payments,
  public.cash_movements, public.financial_entries to authenticated;
create policy sales_read on public.sales for select to authenticated
using ((select private.has_permission('sales.read')));
create policy sale_items_read on public.sale_items for select to authenticated
using ((select private.has_permission('sales.read')));
create policy sale_payments_read on public.sale_payments for select to authenticated
using ((select private.has_permission('sales.read')));
create policy cash_movements_read on public.cash_movements for select to authenticated
using ((select private.has_permission('cash.manage')));
create policy financial_entries_read on public.financial_entries for select to authenticated
using ((select private.has_permission('finance.read')));

-- Catálogo seguro para o CAIXA: sem preço de custo e com limite de resultados.
create function public.search_pdv_products(
  p_search text default '',
  p_product_ids uuid[] default null,
  p_limit integer default 40
)
returns table (
  product_id uuid, name text, internal_code text, barcode text,
  unit text, sale_price numeric, stock_quantity numeric
)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_search text := btrim(coalesce(p_search, ''));
begin
  if not private.has_permission('pdv.use') then
    raise exception 'pdv_permission_denied' using errcode = '42501';
  end if;
  if char_length(v_search) > 80 or p_limit is null or p_limit < 1 or p_limit > 100 or
    (p_product_ids is not null and coalesce(array_length(p_product_ids, 1), 0) > 100) then
    raise exception 'pdv_invalid_search' using errcode = '22023';
  end if;
  return query
  select p.id, p.name, p.internal_code, p.barcode, p.unit, p.sale_price, b.quantity
  from public.products p join public.stock_balances b on b.product_id = p.id
  where p.is_active and (
    (p_product_ids is not null and p.id = any(p_product_ids)) or
    (p_product_ids is null and (v_search = '' or
      position(lower(v_search) in lower(p.name)) > 0 or
      position(lower(v_search) in lower(p.internal_code)) > 0 or
      position(v_search in coalesce(p.barcode, '')) > 0))
  )
  order by (p.barcode = v_search) desc, (lower(p.internal_code) = lower(v_search)) desc, p.name
  limit p_limit;
end;
$$;
revoke all on function public.search_pdv_products(text,uuid[],integer) from public, anon, authenticated;
grant execute on function public.search_pdv_products(text,uuid[],integer) to authenticated;

-- Advisory lock serializa tentativas com a mesma chave. Os bloqueios FOR UPDATE
-- são obtidos em ordem de produto para vendas concorrentes não se ultrapassarem.
create function public.checkout_sale(
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
  insert into public.sales (
    operator_id, subtotal, discount_amount, discount_reason, total,
    request_id, request_fingerprint
  ) values (
    (select auth.uid()), v_subtotal, p_discount_amount, btrim(p_discount_reason),
    v_total, p_request_id, v_fingerprint
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
  insert into public.cash_movements (sale_id, user_id, method, amount)
  values (v_sale.id, (select auth.uid()), p_payment_method, v_total);
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
