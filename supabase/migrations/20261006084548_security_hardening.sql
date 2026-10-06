-- Bloco 16: convites limitados no servidor e objetos de imagem controlados pelo backend.
create table private.invite_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now()
);
create index invite_attempts_user_created_idx on private.invite_attempts(user_id, created_at desc);
alter table private.invite_attempts enable row level security;
revoke all on private.invite_attempts from public, anon, authenticated;

create function public.admin_claim_invite_slot()
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_user uuid := (select auth.uid());
begin
  if v_user is null or not public.admin_check_access() then
    raise exception 'users_permission_denied' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('invite:' || v_user::text, 0));
  delete from private.invite_attempts
    where user_id = v_user and created_at < now() - interval '7 days';
  if (select count(*) from private.invite_attempts
      where user_id = v_user and created_at >= now() - interval '1 hour') >= 5
    or exists (select 1 from private.invite_attempts
      where user_id = v_user and created_at >= now() - interval '1 minute') then
    return false;
  end if;
  insert into private.invite_attempts(user_id) values (v_user);
  return true;
end;
$$;
revoke all on function public.admin_claim_invite_slot() from public, anon, authenticated;
grant execute on function public.admin_claim_invite_slot() to authenticated;

-- Upload e exclusão direta não verificavam a assinatura do arquivo. A Edge
-- Function product-image passará a fazer a validação antes de gravar.
drop policy if exists product_images_insert on storage.objects;
drop policy if exists product_images_delete on storage.objects;
drop policy if exists product_images_read on storage.objects;
create policy product_images_read on storage.objects for select to authenticated
using (
  bucket_id = 'product-images'
  and (select private.has_permission('products.read'))
  and exists (select 1 from public.products p where p.image_path = storage.objects.name)
);
update storage.buckets set public = false, file_size_limit = 3145728,
  allowed_mime_types = array['image/jpeg','image/png','image/webp']
where id = 'product-images';

-- Replays de estoque devem repetir todos os parâmetros, não apenas produto/tipo.
alter table public.stock_movements add column request_fingerprint text
  check (request_fingerprint ~ '^[0-9a-f]{32}$');

create or replace function public.record_stock_movement(
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
  v_fingerprint text;
begin
  if not private.has_permission('stock.manage') or (select auth.uid()) is null then
    raise exception 'stock_permission_denied' using errcode = '42501';
  end if;
  if p_product_id is null or p_request_id is null then
    raise exception 'stock_required_fields' using errcode = '22023';
  end if;
  v_fingerprint := md5(jsonb_build_object(
    'product_id', p_product_id, 'type', p_type, 'quantity', p_quantity,
    'counted_quantity', p_counted_quantity, 'expected_previous', p_expected_previous,
    'unit_cost', p_unit_cost, 'reason', btrim(p_reason), 'supplier_id', p_supplier_id,
    'invoice_number', btrim(p_invoice_number), 'notes', btrim(p_notes),
    'occurred_on', p_occurred_on
  )::text);
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text, 0));
  select * into v_movement from public.stock_movements where idempotency_key = p_request_id;
  if found then
    if v_movement.user_id <> (select auth.uid()) or
      v_movement.request_fingerprint is distinct from v_fingerprint then
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
    reason, supplier_id, invoice_number, notes, occurred_on, user_id, idempotency_key, request_fingerprint
  ) values (
    p_product_id, p_type, v_delta, v_previous, v_new,
    case when p_type = 'ENTRADA' then p_unit_cost else null end,
    btrim(p_reason), p_supplier_id, btrim(p_invoice_number), btrim(p_notes),
    case when p_type = 'ENTRADA' then coalesce(p_occurred_on, current_date) else current_date end,
    (select auth.uid()), p_request_id, v_fingerprint
  ) returning * into v_movement;
  insert into public.audit_logs (user_id, action, entity, entity_id, before_data, after_data)
  values ((select auth.uid()), 'STOCK_' || p_type, 'stock_movements', v_movement.id,
    jsonb_build_object('product_id', p_product_id, 'quantity', v_previous),
    jsonb_build_object('product_id', p_product_id, 'quantity', v_new, 'movement_id', v_movement.id,
      'reason', p_reason));
  return v_movement;
end;
$$;
