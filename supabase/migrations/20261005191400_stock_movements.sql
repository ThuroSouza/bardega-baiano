-- Bloco 4: saldo e histórico são alterados somente pela operação atômica.
insert into private.role_permissions (role, permission) values
  ('ADMIN', 'stock.manage'), ('GERENTE', 'stock.manage'), ('ESTOQUE', 'stock.manage');

create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 2 and 160 and name = btrim(name)),
  phone text not null default '' check (char_length(phone) <= 40),
  email text not null default '' check (char_length(email) <= 254),
  notes text not null default '' check (char_length(notes) <= 1000),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index suppliers_name_unique on public.suppliers (lower(name));
create index suppliers_active_name_idx on public.suppliers (is_active, name);
create trigger suppliers_updated_at before update on public.suppliers
for each row execute function private.touch_catalog_updated_at();

create table public.stock_balances (
  product_id uuid primary key references public.products(id) on delete restrict,
  quantity numeric(14,3) not null default 0 check (quantity >= 0),
  updated_at timestamptz not null default now()
);

create table public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete restrict,
  type text not null check (type in ('ENTRADA', 'SAIDA', 'VENDA', 'CANCELAMENTO', 'AJUSTE', 'PERDA', 'AVARIA', 'INVENTARIO')),
  quantity numeric(14,3) not null,
  previous_quantity numeric(14,3) not null check (previous_quantity >= 0),
  new_quantity numeric(14,3) not null check (new_quantity >= 0),
  unit_cost numeric(12,2) check (unit_cost is null or unit_cost >= 0),
  total_cost numeric generated always as (abs(quantity) * unit_cost) stored,
  reason text not null default '' check (char_length(reason) <= 500),
  supplier_id uuid references public.suppliers(id) on delete restrict,
  invoice_number text not null default '' check (char_length(invoice_number) <= 80),
  notes text not null default '' check (char_length(notes) <= 1000),
  occurred_on date not null default current_date,
  sale_id uuid,
  user_id uuid not null references public.profiles(id) on delete restrict,
  idempotency_key uuid not null unique,
  created_at timestamptz not null default now(),
  constraint stock_movement_arithmetic check (new_quantity = previous_quantity + quantity),
  constraint stock_movement_nonzero check (quantity <> 0 or type = 'INVENTARIO'),
  constraint stock_movement_direction check (
    (type in ('ENTRADA', 'CANCELAMENTO') and quantity > 0) or
    (type in ('SAIDA', 'VENDA', 'PERDA', 'AVARIA') and quantity < 0) or
    (type in ('AJUSTE', 'INVENTARIO'))
  )
);
create index stock_movements_product_created_idx on public.stock_movements (product_id, created_at desc);
create index stock_movements_created_idx on public.stock_movements (created_at desc);
create index stock_movements_type_created_idx on public.stock_movements (type, created_at desc);
create index stock_movements_user_created_idx on public.stock_movements (user_id, created_at desc);
create index stock_movements_supplier_idx on public.stock_movements (supplier_id) where supplier_id is not null;

-- Estrutura reutilizável para a auditoria completa do bloco 14.
create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete restrict,
  action text not null,
  entity text not null,
  entity_id uuid not null,
  before_data jsonb not null default '{}'::jsonb,
  after_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_logs_created_idx on public.audit_logs (created_at desc);
create index audit_logs_entity_idx on public.audit_logs (entity, entity_id, created_at desc);
create index audit_logs_user_idx on public.audit_logs (user_id, created_at desc);

create function private.create_stock_balance()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.stock_balances (product_id) values (new.id);
  return new;
end;
$$;
revoke all on function private.create_stock_balance() from public, anon, authenticated;
create trigger product_initial_stock after insert on public.products
for each row execute function private.create_stock_balance();
insert into public.stock_balances (product_id)
select id from public.products on conflict (product_id) do nothing;

alter table public.suppliers enable row level security;
alter table public.stock_balances enable row level security;
alter table public.stock_movements enable row level security;
alter table public.audit_logs enable row level security;
revoke all on public.suppliers, public.stock_balances, public.stock_movements, public.audit_logs
from public, anon, authenticated;
grant select, insert, update on public.suppliers to authenticated;
grant select on public.stock_balances, public.stock_movements, public.audit_logs to authenticated;

create policy suppliers_read on public.suppliers for select to authenticated
using ((select private.has_permission('products.read')) or (select private.has_permission('stock.read')));
create policy suppliers_insert on public.suppliers for insert to authenticated
with check ((select private.has_permission('stock.manage')));
create policy suppliers_update on public.suppliers for update to authenticated
using ((select private.has_permission('stock.manage')))
with check ((select private.has_permission('stock.manage')));
create policy stock_balances_read on public.stock_balances for select to authenticated
using ((select private.has_permission('stock.read')));
create policy stock_movements_read on public.stock_movements for select to authenticated
using ((select private.has_permission('stock.read')));
create policy audit_logs_read on public.audit_logs for select to authenticated
using ((select private.has_permission('audit.read')));

-- A função bloqueia a linha de saldo, valida os parâmetros, grava o movimento
-- e a auditoria na mesma transação. VENDA/CANCELAMENTO terão fluxo próprio no PDV.
create function public.record_stock_movement(
  p_product_id uuid,
  p_type text,
  p_request_id uuid,
  p_quantity numeric default null,
  p_counted_quantity numeric default null,
  p_expected_previous numeric default null,
  p_unit_cost numeric default null,
  p_reason text default '',
  p_supplier_id uuid default null,
  p_invoice_number text default '',
  p_notes text default '',
  p_occurred_on date default null
)
returns public.stock_movements
language plpgsql security definer set search_path = '' as $$
declare
  v_previous numeric(14,3);
  v_delta numeric(14,3);
  v_new numeric(14,3);
  v_movement public.stock_movements;
begin
  if not private.has_permission('stock.manage') or (select auth.uid()) is null then
    raise exception 'stock_permission_denied' using errcode = '42501';
  end if;
  if p_product_id is null or p_request_id is null then
    raise exception 'stock_required_fields' using errcode = '22023';
  end if;
  select * into v_movement from public.stock_movements
  where idempotency_key = p_request_id and user_id = (select auth.uid());
  if found then
    if v_movement.product_id <> p_product_id or v_movement.type <> p_type then
      raise exception 'stock_request_reused' using errcode = '22023';
    end if;
    return v_movement;
  end if;
  if p_type not in ('ENTRADA', 'SAIDA', 'AJUSTE', 'PERDA', 'AVARIA', 'INVENTARIO') or p_type is null then
    raise exception 'stock_invalid_type' using errcode = '22023';
  end if;
  if p_reason is null or char_length(p_reason) > 500 or
    (p_type in ('SAIDA', 'AJUSTE', 'PERDA', 'AVARIA', 'INVENTARIO') and char_length(btrim(p_reason)) < 3) then
    raise exception 'stock_reason_required' using errcode = '22023';
  end if;
  if p_notes is null or char_length(p_notes) > 1000 or p_invoice_number is null or char_length(p_invoice_number) > 80 then
    raise exception 'stock_invalid_notes' using errcode = '22023';
  end if;
  if (p_quantity is not null and p_quantity <> trunc(p_quantity, 3)) or
    (p_counted_quantity is not null and p_counted_quantity <> trunc(p_counted_quantity, 3)) or
    (p_expected_previous is not null and p_expected_previous <> trunc(p_expected_previous, 3)) then
    raise exception 'stock_invalid_precision' using errcode = '22023';
  end if;
  if (p_type = 'INVENTARIO' and p_quantity is not null) or
    (p_type <> 'INVENTARIO' and (p_counted_quantity is not null or p_expected_previous is not null)) then
    raise exception 'stock_unexpected_fields' using errcode = '22023';
  end if;
  if p_type = 'ENTRADA' then
    if p_quantity is null or p_quantity <= 0 or p_quantity > 999999999.999 or p_unit_cost is null or p_unit_cost < 0 or p_unit_cost > 9999999999.99 then
      raise exception 'stock_invalid_entry' using errcode = '22023';
    end if;
  elsif p_type = 'INVENTARIO' then
    if p_counted_quantity is null or p_counted_quantity < 0 or p_counted_quantity > 999999999.999 or p_expected_previous is null then
      raise exception 'stock_invalid_count' using errcode = '22023';
    end if;
  elsif p_quantity is null or p_quantity = 0 or abs(p_quantity) > 999999999.999 or
    (p_type in ('SAIDA', 'PERDA', 'AVARIA') and p_quantity < 0) then
    raise exception 'stock_invalid_quantity' using errcode = '22023';
  end if;
  if p_type <> 'ENTRADA' and (p_supplier_id is not null or p_invoice_number <> '' or p_unit_cost is not null or p_occurred_on is not null) then
    raise exception 'stock_entry_fields_only' using errcode = '22023';
  end if;
  if p_type = 'ENTRADA' and p_supplier_id is not null and not exists (
    select 1 from public.suppliers where id = p_supplier_id and is_active
  ) then
    raise exception 'stock_invalid_supplier' using errcode = '22023';
  end if;
  if not exists (select 1 from public.products where id = p_product_id) then
    raise exception 'stock_product_not_found' using errcode = '22023';
  end if;
  insert into public.stock_balances (product_id) values (p_product_id)
  on conflict (product_id) do nothing;
  select quantity into v_previous from public.stock_balances
  where product_id = p_product_id for update;
  if p_type = 'INVENTARIO' then
    if v_previous <> p_expected_previous then
      raise exception 'stock_balance_changed' using errcode = 'P0001';
    end if;
    v_delta := p_counted_quantity - v_previous;
  elsif p_type = 'AJUSTE' then
    v_delta := p_quantity;
  elsif p_type = 'ENTRADA' then
    v_delta := p_quantity;
  else
    v_delta := -p_quantity;
  end if;
  v_new := v_previous + v_delta;
  if v_new < 0 then
    raise exception 'stock_insufficient' using errcode = 'P0001';
  end if;
  update public.stock_balances set quantity = v_new, updated_at = now()
  where product_id = p_product_id;
  insert into public.stock_movements (
    product_id, type, quantity, previous_quantity, new_quantity, unit_cost,
    reason, supplier_id, invoice_number, notes, occurred_on, user_id, idempotency_key
  ) values (
    p_product_id, p_type, v_delta, v_previous, v_new,
    case when p_type = 'ENTRADA' then p_unit_cost else null end,
    btrim(p_reason), p_supplier_id, btrim(p_invoice_number), btrim(p_notes),
    case when p_type = 'ENTRADA' then coalesce(p_occurred_on, current_date) else current_date end,
    (select auth.uid()), p_request_id
  ) returning * into v_movement;
  insert into public.audit_logs (user_id, action, entity, entity_id, before_data, after_data)
  values ((select auth.uid()), 'STOCK_' || p_type, 'stock_movements', v_movement.id,
    jsonb_build_object('product_id', p_product_id, 'quantity', v_previous),
    jsonb_build_object('product_id', p_product_id, 'quantity', v_new, 'movement_id', v_movement.id,
      'reason', p_reason));
  return v_movement;
end;
$$;
revoke all on function public.record_stock_movement(uuid,text,uuid,numeric,numeric,numeric,numeric,text,uuid,text,text,date)
from public, anon, authenticated;
grant execute on function public.record_stock_movement(uuid,text,uuid,numeric,numeric,numeric,numeric,text,uuid,text,text,date)
to authenticated;
