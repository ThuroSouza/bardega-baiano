-- Bloco 12: receitas opcionais de um nível. Produtos compostos não guardam
-- saldo físico próprio; o PDV usa a disponibilidade dos ingredientes.
alter table public.products add column is_composite boolean not null default false;
alter table public.products add constraint composite_product_settings check
  (not is_composite or (unit in ('UN','CX','PCT') and minimum_stock = 0 and cost_price = 0));
revoke insert,update on public.products from authenticated;
grant insert (name,description,category_id,internal_code,barcode,unit,
  cost_price,sale_price,minimum_stock,is_active,image_path)
  on public.products to authenticated;
grant update (name,description,category_id,internal_code,barcode,unit,
  cost_price,sale_price,minimum_stock,is_active,image_path)
  on public.products to authenticated;

create table public.product_recipe_items (
  product_id uuid not null references public.products(id) on delete restrict,
  ingredient_id uuid not null references public.products(id) on delete restrict,
  quantity numeric(14,3) not null check (quantity > 0 and quantity = trunc(quantity,3)),
  primary key (product_id, ingredient_id),
  constraint recipe_not_self check (product_id <> ingredient_id)
);
create index product_recipe_ingredient_idx on public.product_recipe_items(ingredient_id);
alter table public.product_recipe_items enable row level security;
revoke all on public.product_recipe_items from public, anon, authenticated;
grant select on public.product_recipe_items to authenticated;
create policy product_recipe_read on public.product_recipe_items for select to authenticated
  using ((select private.has_permission('products.read')));

-- Snapshot do consumo de cada item composto. O custo não é exposto ao CAIXA.
create table public.sale_item_components (
  sale_item_id uuid not null references public.sale_items(id) on delete restrict,
  ingredient_id uuid not null references public.products(id) on delete restrict,
  ingredient_name text not null,
  unit text not null,
  quantity numeric(14,3) not null check (quantity > 0),
  unit_cost numeric(12,2) not null check (unit_cost >= 0),
  primary key (sale_item_id, ingredient_id)
);
create index sale_item_components_ingredient_idx on public.sale_item_components(ingredient_id);
alter table public.sale_item_components enable row level security;
revoke all on public.sale_item_components from public, anon, authenticated;
grant select (sale_item_id,ingredient_id,ingredient_name,unit,quantity)
  on public.sale_item_components to authenticated;
create policy sale_item_components_read on public.sale_item_components for select to authenticated
  using ((select private.has_permission('sales.read')));

-- Um composto nunca recebe movimentação física própria. Em caso de tentativa,
-- o erro reverte também qualquer atualização de saldo da função chamadora.
create function private.prevent_composite_stock_movement()
returns trigger language plpgsql set search_path = '' as $$
begin
  if exists (select 1 from public.products where id = new.product_id and is_composite) then
    raise exception 'recipe_virtual_stock' using errcode = '22023';
  end if;
  return new;
end;
$$;
revoke all on function private.prevent_composite_stock_movement() from public, anon, authenticated;
create trigger prevent_composite_stock_movement before insert on public.stock_movements
for each row execute function private.prevent_composite_stock_movement();

create function public.set_product_recipe(p_product_id uuid,p_items jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_parent public.products;
  v_item jsonb;
  v_ingredient public.products;
  v_id uuid;
  v_qty numeric(14,3);
  v_seen uuid[] := '{}'::uuid[];
  v_count integer;
begin
  if (select auth.uid()) is null or not private.has_permission('products.manage')
    or not private.has_permission('stock.manage') then
    raise exception 'recipe_permission_denied' using errcode = '42501';
  end if;
  if p_product_id is null or p_items is null or jsonb_typeof(p_items)<>'array'
    or jsonb_array_length(p_items)>30 then
    raise exception 'recipe_invalid_items' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(72219912);
  select * into v_parent from public.products where id=p_product_id for update;
  if not found then raise exception 'recipe_product_not_found' using errcode = '22023'; end if;
  v_count := jsonb_array_length(p_items);
  if v_count>0 then
    if v_parent.unit not in ('UN','CX','PCT') or v_parent.minimum_stock<>0
      or exists (select 1 from public.stock_balances where product_id=p_product_id and quantity<>0)
      or exists (select 1 from public.product_recipe_items where ingredient_id=p_product_id) then
      raise exception 'recipe_parent_ineligible' using errcode = '22023';
    end if;
  end if;
  for v_item in select value from jsonb_array_elements(p_items) loop
    if jsonb_typeof(v_item)<>'object' or
      (select count(*) from jsonb_object_keys(v_item))<>2 or
      not (v_item ? 'ingredient_id' and v_item ? 'quantity') then
      raise exception 'recipe_invalid_items' using errcode = '22023';
    end if;
    v_id := (v_item->>'ingredient_id')::uuid;
    v_qty := (v_item->>'quantity')::numeric;
    if v_id is null or v_id=p_product_id or v_id=any(v_seen) or
      v_qty is null or v_qty<=0 or v_qty>999999999.999 or v_qty<>trunc(v_qty,3) then
      raise exception 'recipe_invalid_items' using errcode = '22023';
    end if;
    v_seen := array_append(v_seen,v_id);
    select * into v_ingredient from public.products where id=v_id for update;
    if not found or not v_ingredient.is_active or v_ingredient.is_composite then
      raise exception 'recipe_ingredient_unavailable' using errcode = '22023';
    end if;
    if v_ingredient.unit in ('UN','CX','PCT') and v_qty<>trunc(v_qty) then
      raise exception 'recipe_whole_unit_required' using errcode = '22023';
    end if;
  end loop;
  delete from public.product_recipe_items where product_id=p_product_id;
  if v_count>0 then
    insert into public.product_recipe_items(product_id,ingredient_id,quantity)
      select p_product_id,(x->>'ingredient_id')::uuid,(x->>'quantity')::numeric
      from jsonb_array_elements(p_items) x;
  end if;
  update public.products set is_composite=(v_count>0),
    cost_price=case when v_count>0 then 0 else cost_price end
    where id=p_product_id;
  insert into public.audit_logs(user_id,action,entity,entity_id,after_data)
    values ((select auth.uid()),'PRODUCT_RECIPE_UPDATED','products',p_product_id,
      jsonb_build_object('ingredients_count',v_count));
  return jsonb_build_object('product_id',p_product_id,'is_composite',v_count>0,
    'ingredients_count',v_count);
end;
$$;
revoke all on function public.set_product_recipe(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.set_product_recipe(uuid,jsonb) to authenticated;

create or replace function public.search_pdv_products(
  p_search text default '', p_product_ids uuid[] default null, p_limit integer default 40
) returns table (
  product_id uuid, name text, internal_code text, barcode text,
  unit text, sale_price numeric, stock_quantity numeric
) language plpgsql stable security definer set search_path = '' as $$
declare v_search text := btrim(coalesce(p_search,''));
begin
  if not private.has_permission('pdv.use') then
    raise exception 'pdv_permission_denied' using errcode = '42501';
  end if;
  if char_length(v_search)>80 or p_limit is null or p_limit<1 or p_limit>100 or
    (p_product_ids is not null and coalesce(array_length(p_product_ids,1),0)>100) then
    raise exception 'pdv_invalid_search' using errcode = '22023';
  end if;
  return query
  select p.id,p.name,p.internal_code,p.barcode,p.unit,p.sale_price,
    case when p.is_composite then coalesce((
      select min(case when ing.is_active then floor(ib.quantity/ri.quantity) else 0 end)
      from public.product_recipe_items ri
      join public.products ing on ing.id=ri.ingredient_id
      join public.stock_balances ib on ib.product_id=ri.ingredient_id
      where ri.product_id=p.id
    ),0)::numeric else b.quantity end
  from public.products p join public.stock_balances b on b.product_id=p.id
  where p.is_active and (
    (p_product_ids is not null and p.id=any(p_product_ids)) or
    (p_product_ids is null and (v_search='' or
      position(lower(v_search) in lower(p.name))>0 or
      position(lower(v_search) in lower(p.internal_code))>0 or
      position(v_search in coalesce(p.barcode,''))>0))
  )
  order by (p.barcode=v_search) desc,(lower(p.internal_code)=lower(v_search)) desc,p.name
  limit p_limit;
end;
$$;
revoke all on function public.search_pdv_products(text,uuid[],integer) from public,anon,authenticated;
grant execute on function public.search_pdv_products(text,uuid[],integer) to authenticated;

-- O fechamento usa uma única lista de necessidades físicas. Assim, vender um
-- ingrediente avulso e em dois combos na mesma compra não ultrapassa o saldo.
create or replace function public.checkout_sale(
  p_request_id uuid,p_items jsonb,p_payment_method text,p_expected_total numeric,
  p_discount_amount numeric default 0,p_discount_reason text default ''
) returns public.sales language plpgsql security definer set search_path = '' as $$
declare
  v_sale public.sales;
  v_item jsonb;
  v_line record;
  v_component record;
  v_stock record;
  v_product_id uuid;
  v_quantity numeric;
  v_required numeric;
  v_unit_cost numeric;
  v_component_count integer;
  v_gross numeric(14,2);
  v_subtotal numeric(14,2) := 0;
  v_total numeric(14,2);
  v_line_discount numeric(14,2);
  v_remaining_discount numeric(14,2);
  v_remaining_gross numeric(14,2);
  v_requested jsonb := '[]'::jsonb;
  v_lines jsonb := '[]'::jsonb;
  v_need jsonb := '{}'::jsonb;
  v_stock_map jsonb := '{}'::jsonb;
  v_seen uuid[] := '{}'::uuid[];
  v_key text;
  v_previous numeric(14,3);
  v_fingerprint text;
  v_cash_session_id uuid;
  v_sale_item_id uuid;
  v_index integer := 0;
begin
  if not private.has_permission('pdv.use') or (select auth.uid()) is null then
    raise exception 'pdv_permission_denied' using errcode = '42501';
  end if;
  if p_request_id is null or p_items is null or jsonb_typeof(p_items)<>'array' or
    jsonb_array_length(p_items) not between 1 and 100 then
    raise exception 'sale_invalid_items' using errcode = '22023';
  end if;
  if p_payment_method is null or p_payment_method not in
    ('DINHEIRO','PIX','CARTAO_DEBITO','CARTAO_CREDITO') then
    raise exception 'sale_invalid_payment' using errcode = '22023';
  end if;
  if p_discount_amount is null or p_discount_amount<0 or
    p_discount_amount<>trunc(p_discount_amount,2) or
    p_expected_total is null or p_expected_total<=0 or
    p_expected_total<>trunc(p_expected_total,2) or
    p_discount_reason is null or char_length(p_discount_reason)>500 then
    raise exception 'sale_invalid_amount' using errcode = '22023';
  end if;
  v_fingerprint := md5(p_items::text || '|' || p_payment_method || '|' ||
    p_expected_total::text || '|' || p_discount_amount::text || '|' || p_discount_reason);
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,0));
  perform pg_advisory_xact_lock(72219912);
  select * into v_sale from public.sales where request_id=p_request_id;
  if found then
    if v_sale.request_fingerprint<>v_fingerprint or v_sale.operator_id<>(select auth.uid()) then
      raise exception 'sale_request_reused' using errcode = '22023';
    end if;
    return v_sale;
  end if;
  if p_discount_amount>0 then
    if not private.has_permission('sales.discount') then
      raise exception 'sale_discount_denied' using errcode = '42501';
    end if;
    if char_length(btrim(p_discount_reason))<3 then
      raise exception 'sale_discount_reason_required' using errcode = '22023';
    end if;
  end if;
  for v_item in select value from jsonb_array_elements(p_items) order by value->>'product_id' loop
    if jsonb_typeof(v_item)<>'object' or
      (select count(*) from jsonb_object_keys(v_item))<>2 or
      not (v_item ? 'product_id' and v_item ? 'quantity') then
      raise exception 'sale_invalid_item' using errcode = '22023';
    end if;
    v_product_id := (v_item->>'product_id')::uuid;
    v_quantity := (v_item->>'quantity')::numeric;
    if v_product_id is null or v_product_id=any(v_seen) or
      v_quantity is null or v_quantity<=0 or v_quantity>999999999.999 or
      v_quantity<>trunc(v_quantity,3) then
      raise exception 'sale_invalid_quantity' using errcode = '22023';
    end if;
    v_seen := array_append(v_seen,v_product_id);
    v_requested := v_requested || jsonb_build_array(jsonb_build_object(
      'product_id',v_product_id,'quantity',v_quantity));
  end loop;

  -- A trava global coordena a edição das fichas; os bloqueios de linha protegem
  -- entradas e ajustes de estoque concorrentes.
  for v_stock in
    select p.id,p.name,p.unit,p.sale_price,p.cost_price,p.is_active,p.is_composite,
      b.quantity as available
    from public.products p join public.stock_balances b on b.product_id=p.id
    where p.id in (
      select (x->>'product_id')::uuid from jsonb_array_elements(v_requested) x
      union
      select ri.ingredient_id from public.product_recipe_items ri
      join jsonb_array_elements(v_requested) x
        on ri.product_id=(x->>'product_id')::uuid
    )
    order by p.id for update of p,b
  loop
    v_stock_map := v_stock_map || jsonb_build_object(v_stock.id::text,
      jsonb_build_object('available',v_stock.available,'cost',v_stock.cost_price));
  end loop;

  for v_item in select value from jsonb_array_elements(v_requested) loop
    v_product_id := (v_item->>'product_id')::uuid;
    v_quantity := (v_item->>'quantity')::numeric;
    select p.id,p.name,p.unit,p.sale_price,p.cost_price,p.is_composite,p.is_active
      into v_line from public.products p where p.id=v_product_id;
    if not found or not v_line.is_active or v_line.sale_price<=0 then
      raise exception 'sale_product_unavailable' using errcode = '22023';
    end if;
    if v_line.unit in ('UN','CX','PCT') and v_quantity<>trunc(v_quantity) then
      raise exception 'sale_whole_unit_required' using errcode = '22023';
    end if;
    v_unit_cost := v_line.cost_price;
    if v_line.is_composite then
      v_unit_cost := 0;
      v_component_count := 0;
      for v_component in
        select ri.ingredient_id,ri.quantity,p.cost_price,p.is_active,p.is_composite
        from public.product_recipe_items ri join public.products p on p.id=ri.ingredient_id
        where ri.product_id=v_product_id order by ri.ingredient_id
      loop
        if not v_component.is_active or v_component.is_composite then
          raise exception 'recipe_ingredient_unavailable' using errcode = '22023';
        end if;
        v_component_count := v_component_count+1;
        v_unit_cost := v_unit_cost+v_component.quantity*v_component.cost_price;
        v_required := v_component.quantity*v_quantity;
        v_key := v_component.ingredient_id::text;
        v_need := jsonb_set(v_need,array[v_key],to_jsonb(
          coalesce((v_need->>v_key)::numeric,0)+v_required),true);
      end loop;
      if v_component_count=0 then
        raise exception 'recipe_empty' using errcode = '22023';
      end if;
      v_unit_cost := round(v_unit_cost,2);
    else
      v_key := v_product_id::text;
      v_need := jsonb_set(v_need,array[v_key],to_jsonb(
        coalesce((v_need->>v_key)::numeric,0)+v_quantity),true);
    end if;
    if v_unit_cost>9999999999.99 then
      raise exception 'recipe_cost_too_high' using errcode = '22023';
    end if;
    v_gross := round(v_line.sale_price*v_quantity,2);
    v_subtotal := v_subtotal+v_gross;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'product_id',v_line.id,'name',v_line.name,'unit',v_line.unit,
      'quantity',v_quantity,'unit_price',v_line.sale_price,
      'unit_cost',v_unit_cost,'is_composite',v_line.is_composite,'gross',v_gross));
  end loop;
  for v_key in select key from jsonb_each(v_need) order by key loop
    v_required := (v_need->>v_key)::numeric;
    if v_required>99999999999.999 or v_required<>trunc(v_required,3) or
      (v_stock_map->v_key) is null or
      (v_stock_map->v_key->>'available')::numeric<v_required then
      raise exception 'sale_insufficient_stock' using errcode = 'P0001';
    end if;
  end loop;
  if p_discount_amount>=v_subtotal then
    raise exception 'sale_discount_too_high' using errcode = '22023';
  end if;
  v_total := v_subtotal-p_discount_amount;
  if v_total<>p_expected_total then
    raise exception 'sale_price_changed' using errcode = 'P0001';
  end if;
  select id into v_cash_session_id from public.cash_sessions
    where opened_by=(select auth.uid()) and status='ABERTO' for update;
  if not found then
    raise exception 'cash_open_session_required' using errcode = '22023';
  end if;
  insert into public.sales(operator_id,subtotal,discount_amount,discount_reason,total,
    request_id,request_fingerprint,cash_session_id)
    values ((select auth.uid()),v_subtotal,p_discount_amount,btrim(p_discount_reason),
      v_total,p_request_id,v_fingerprint,v_cash_session_id) returning * into v_sale;
  v_remaining_discount := p_discount_amount;
  v_remaining_gross := v_subtotal;
  for v_item in select value from jsonb_array_elements(v_lines) loop
    v_index := v_index+1;
    v_gross := (v_item->>'gross')::numeric;
    if v_index=jsonb_array_length(v_lines) then
      v_line_discount := v_remaining_discount;
    else
      v_line_discount := greatest(0,v_remaining_discount-(v_remaining_gross-v_gross),
        least(v_gross,v_remaining_discount,
          round(v_gross*v_remaining_discount/v_remaining_gross,2)));
    end if;
    v_remaining_discount := v_remaining_discount-v_line_discount;
    v_remaining_gross := v_remaining_gross-v_gross;
    insert into public.sale_items(sale_id,product_id,product_name,unit,quantity,
      unit_price,unit_cost,gross_subtotal,discount_amount)
      values (v_sale.id,(v_item->>'product_id')::uuid,v_item->>'name',v_item->>'unit',
        (v_item->>'quantity')::numeric,(v_item->>'unit_price')::numeric,
        (v_item->>'unit_cost')::numeric,v_gross,v_line_discount)
      returning id into v_sale_item_id;
    if (v_item->>'is_composite')::boolean then
      insert into public.sale_item_components(sale_item_id,ingredient_id,ingredient_name,
        unit,quantity,unit_cost)
        select v_sale_item_id,ri.ingredient_id,p.name,p.unit,
          ri.quantity*(v_item->>'quantity')::numeric,p.cost_price
        from public.product_recipe_items ri join public.products p on p.id=ri.ingredient_id
        where ri.product_id=(v_item->>'product_id')::uuid;
    end if;
  end loop;
  for v_key in select key from jsonb_each(v_need) order by key loop
    v_required := (v_need->>v_key)::numeric;
    v_previous := (v_stock_map->v_key->>'available')::numeric;
    update public.stock_balances set quantity=quantity-v_required,updated_at=now()
      where product_id=v_key::uuid;
    insert into public.stock_movements(product_id,type,quantity,previous_quantity,
      new_quantity,unit_cost,reason,sale_id,user_id,idempotency_key)
      values (v_key::uuid,'VENDA',-v_required,v_previous,v_previous-v_required,
        (v_stock_map->v_key->>'cost')::numeric,'Venda #' || v_sale.sale_number,
        v_sale.id,(select auth.uid()),gen_random_uuid());
  end loop;
  insert into public.sale_payments(sale_id,method,amount)
    values (v_sale.id,p_payment_method,v_total);
  insert into public.cash_movements(sale_id,session_id,user_id,method,amount)
    values (v_sale.id,v_cash_session_id,(select auth.uid()),p_payment_method,v_total);
  insert into public.financial_entries(sale_id,user_id,amount)
    values (v_sale.id,(select auth.uid()),v_total);
  insert into public.audit_logs(user_id,action,entity,entity_id,after_data)
    values ((select auth.uid()),'SALE_COMPLETED','sales',v_sale.id,
      jsonb_build_object('sale_number',v_sale.sale_number,'total',v_total,
        'payment_method',p_payment_method,'discount_amount',p_discount_amount));
  return v_sale;
end;
$$;
revoke all on function public.checkout_sale(uuid,jsonb,text,numeric,numeric,text)
  from public,anon,authenticated;
grant execute on function public.checkout_sale(uuid,jsonb,text,numeric,numeric,text)
  to authenticated;

-- O cancelamento devolve o snapshot dos ingredientes, nunca a receita atual.
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
  perform pg_advisory_xact_lock(72219912);
  -- Estoque é travado em ordem estável; falhas revertem todos os lançamentos.
  for v_item in
    with restored as (
      select coalesce(c.ingredient_id,i.product_id) as product_id,
        case when c.sale_item_id is null then i.quantity else c.quantity end as quantity,
        case when c.sale_item_id is null then i.unit_cost else c.unit_cost end as unit_cost
      from public.sale_items i
      left join public.sale_item_components c on c.sale_item_id=i.id
      where i.sale_id=v_sale_id
    )
    select product_id,sum(quantity) as quantity,max(unit_cost) as unit_cost
    from restored group by product_id order by product_id
  loop
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


-- O relatório de estoque representa apenas saldos físicos; compostos são virtuais.
-- Bloco 11: relatórios paginados. Todas as leituras são agregadas no banco;
-- reports.read sozinho não amplia acesso a vendas, estoque, caixa e finanças.
create or replace function public.get_operational_report(
  p_report text, p_from_date date, p_to_date date,
  p_page integer default 0, p_page_size integer default 25
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_start timestamptz;
  v_end timestamptz;
  v_offset integer;
  v_rows jsonb := '[]'::jsonb;
  v_total bigint := 0;
  v_summary jsonb := '{}'::jsonb;
  v_profit jsonb;
begin
  if (select auth.uid()) is null or not private.has_permission('reports.read')
    or not private.has_permission('sales.read') or not private.has_permission('stock.read')
    or not private.has_permission('finance.read') or not private.has_permission('cash.view_all') then
    raise exception 'reports_permission_denied' using errcode = '42501';
  end if;
  if p_report not in ('sales','products','stock','movements','entries','losses',
      'finance','expenses','revenues','profit','cash','payments','operators')
    or p_report is null or p_from_date is null or p_to_date is null
    or p_from_date > p_to_date or p_to_date - p_from_date > 3660
    or p_page is null or p_page < 0 or p_page > 100000
    or p_page_size is null or p_page_size < 1 or p_page_size > 100 then
    raise exception 'reports_invalid_filter' using errcode = '22023';
  end if;
  v_start := p_from_date::timestamp at time zone 'America/Sao_Paulo';
  v_end := (p_to_date + 1)::timestamp at time zone 'America/Sao_Paulo';
  v_offset := p_page * p_page_size;

  if p_report = 'sales' then
    select count(*), jsonb_build_object('sales_count',count(*),
      'gross_sales',coalesce(sum(subtotal),0), 'discounts',coalesce(sum(discount_amount),0),
      'completed_total',coalesce(sum(total) filter (where status='CONCLUIDA'),0),
      'cancelled_count',count(*) filter (where status<>'CONCLUIDA'))
      into v_total, v_summary from public.sales
      where created_at >= v_start and created_at < v_end;
    select coalesce(jsonb_agg(to_jsonb(q)), '[]'::jsonb) into v_rows from (
      select s.id, s.sale_number, s.created_at, s.status,
        coalesce(nullif(p.display_name,''),'Operador') as operator,
        s.subtotal, s.discount_amount, s.total
      from public.sales s join public.profiles p on p.id=s.operator_id
      where s.created_at >= v_start and s.created_at < v_end
      order by s.created_at desc, s.id desc limit p_page_size offset v_offset
    ) q;

  elsif p_report = 'products' then
    select count(*) into v_total from (
      select i.product_id from public.sale_items i join public.sales s on s.id=i.sale_id
      where s.created_at >= v_start and s.created_at < v_end and s.status='CONCLUIDA'
      group by i.product_id
    ) g;
    select coalesce(jsonb_agg(to_jsonb(q)), '[]'::jsonb) into v_rows from (
      select i.product_id as id, max(p.name) as product, max(c.name) as category,
        max(i.unit) as unit, sum(i.quantity) as quantity,
        sum(i.net_subtotal) as revenue,
        sum(round(i.unit_cost*i.quantity,2)) as cmv,
        sum(i.net_subtotal)-sum(round(i.unit_cost*i.quantity,2)) as gross_profit
      from public.sale_items i join public.sales s on s.id=i.sale_id
      join public.products p on p.id=i.product_id
      join public.categories c on c.id=p.category_id
      where s.created_at >= v_start and s.created_at < v_end and s.status='CONCLUIDA'
      group by i.product_id order by revenue desc, product
      limit p_page_size offset v_offset
    ) q;
    select jsonb_build_object('products_count',v_total,'quantity',coalesce(sum(i.quantity),0),
      'revenue',coalesce(sum(i.net_subtotal),0),
      'cmv',coalesce(sum(round(i.unit_cost*i.quantity,2)),0)) into v_summary
    from public.sale_items i join public.sales s on s.id=i.sale_id
    where s.created_at >= v_start and s.created_at < v_end and s.status='CONCLUIDA';

  elsif p_report = 'stock' then
    select count(*), jsonb_build_object('products_count',count(*),
      'low_stock_count',count(*) filter (where p.minimum_stock>0 and b.quantity<=p.minimum_stock),
      'stock_value',coalesce(sum(round(b.quantity*p.cost_price,2)),0))
      into v_total, v_summary
    from public.products p join public.stock_balances b on b.product_id=p.id
    where p.is_active and not p.is_composite;
    select coalesce(jsonb_agg(to_jsonb(q)), '[]'::jsonb) into v_rows from (
      select p.id, p.name as product, c.name as category, p.unit,
        b.quantity, p.minimum_stock, p.cost_price,
        round(b.quantity*p.cost_price,2) as stock_value,
        p.minimum_stock>0 and b.quantity<=p.minimum_stock as low_stock
      from public.products p join public.stock_balances b on b.product_id=p.id
      join public.categories c on c.id=p.category_id
      where p.is_active and not p.is_composite order by low_stock desc, p.name, p.id
      limit p_page_size offset v_offset
    ) q;

  elsif p_report in ('movements','entries','losses') then
    select count(*), jsonb_build_object('movements_count',count(*),
      'quantity',coalesce(sum(abs(quantity)),0),
      'recorded_cost',coalesce(sum(total_cost),0)) into v_total, v_summary
    from public.stock_movements
    where created_at >= v_start and created_at < v_end
      and (p_report='movements' or (p_report='entries' and type='ENTRADA')
        or (p_report='losses' and type in ('PERDA','AVARIA')));
    select coalesce(jsonb_agg(to_jsonb(q)), '[]'::jsonb) into v_rows from (
      select m.id, m.created_at, m.type, p.name as product, p.unit,
        m.quantity, m.previous_quantity, m.new_quantity,
        m.unit_cost, m.total_cost, m.reason,
        coalesce(nullif(m.operator_name,''),nullif(u.display_name,''),'Operador') as operator,
        coalesce(s.name,'') as supplier
      from public.stock_movements m join public.products p on p.id=m.product_id
      left join public.profiles u on u.id=m.user_id
      left join public.suppliers s on s.id=m.supplier_id
      where m.created_at >= v_start and m.created_at < v_end
        and (p_report='movements' or (p_report='entries' and m.type='ENTRADA')
          or (p_report='losses' and m.type in ('PERDA','AVARIA')))
      order by m.created_at desc, m.id desc limit p_page_size offset v_offset
    ) q;

  elsif p_report = 'finance' then
    v_profit := public.get_profit_and_loss(p_from_date,p_to_date);
    v_summary := v_profit;
    v_total := 8;
    select coalesce(jsonb_agg(to_jsonb(q)), '[]'::jsonb) into v_rows from (
      select * from (values
        (1,'Faturamento bruto',(v_profit->>'gross_sales')::numeric),
        (2,'Descontos',-(v_profit->>'discounts')::numeric),
        (3,'Cancelamentos',-(v_profit->>'cancellations')::numeric),
        (4,'Faturamento líquido',(v_profit->>'net_sales')::numeric),
        (5,'CMV',-(v_profit->>'cmv')::numeric),
        (6,'Outras receitas',(v_profit->>'other_revenue')::numeric),
        (7,'Despesas operacionais',-(v_profit->>'operating_expenses')::numeric),
        (8,'Resultado',(v_profit->>'result')::numeric)
      ) as t(sort_order,label,amount) order by sort_order
      limit p_page_size offset v_offset
    ) q;

  elsif p_report = 'expenses' then
    select count(*), jsonb_build_object('expenses_count',count(*),
      'operating_amount',coalesce(sum(amount) filter
        (where status<>'CANCELADA' and category<>'MERCADORIAS'),0),
      'inventory_amount',coalesce(sum(amount) filter
        (where status<>'CANCELADA' and category='MERCADORIAS'),0),
      'pending_amount',coalesce(sum(amount) filter (where status='PENDENTE'),0))
      into v_total,v_summary from public.financial_expenses
      where due_on between p_from_date and p_to_date;
    select coalesce(jsonb_agg(to_jsonb(q)), '[]'::jsonb) into v_rows from (
      select id, due_on, description, category, supplier_name,
        amount, status, paid_on, payment_method
      from public.financial_expenses where due_on between p_from_date and p_to_date
      order by due_on desc, id desc limit p_page_size offset v_offset
    ) q;

  elsif p_report = 'revenues' then
    select count(*), jsonb_build_object('entries_count',count(*),
      'sales_net',coalesce(sum(amount) filter (where type in ('RECEITA','ESTORNO')),0),
      'other_net',coalesce(sum(amount) filter
        (where type in ('RECEITA_MANUAL','ESTORNO_MANUAL')),0),
      'total_net',coalesce(sum(amount),0)) into v_total,v_summary
    from public.financial_entries where received_on between p_from_date and p_to_date;
    select coalesce(jsonb_agg(to_jsonb(q)), '[]'::jsonb) into v_rows from (
      select id, received_on, created_at, type, description, amount,
        payment_method, sale_id, receivable_id
      from public.financial_entries where received_on between p_from_date and p_to_date
      order by received_on desc, created_at desc, id desc
      limit p_page_size offset v_offset
    ) q;

  elsif p_report = 'profit' then
    v_profit := public.get_profit_and_loss(p_from_date,p_to_date);
    v_summary := v_profit;
    v_total := 7;
    select coalesce(jsonb_agg(to_jsonb(q)), '[]'::jsonb) into v_rows from (
      select * from (values
        (1,'Faturamento líquido',(v_profit->>'net_sales')::numeric),
        (2,'CMV',-(v_profit->>'cmv')::numeric),
        (3,'Lucro bruto',(v_profit->>'gross_profit')::numeric),
        (4,'Outras receitas',(v_profit->>'other_revenue')::numeric),
        (5,'Despesas operacionais',-(v_profit->>'operating_expenses')::numeric),
        (6,'Resultado',(v_profit->>'result')::numeric),
        (7,'Margem percentual',(v_profit->>'margin_percent')::numeric)
      ) as t(sort_order,label,amount) order by sort_order
      limit p_page_size offset v_offset
    ) q;

  elsif p_report = 'cash' then
    select count(*), jsonb_build_object('sessions_count',count(*),
      'open_count',count(*) filter (where status='ABERTO'),
      'closed_count',count(*) filter (where status='FECHADO'),
      'total_difference',coalesce(sum(difference_amount),0))
      into v_total,v_summary from public.cash_sessions
      where opened_at >= v_start and opened_at < v_end;
    select coalesce(jsonb_agg(to_jsonb(q)), '[]'::jsonb) into v_rows from (
      select c.id,c.session_number,c.opened_at,c.closed_at,c.status,
        coalesce(nullif(p.display_name,''),'Operador') as operator,
        c.opening_amount,c.expected_amount,c.counted_amount,c.difference_amount
      from public.cash_sessions c join public.profiles p on p.id=c.opened_by
      where c.opened_at >= v_start and c.opened_at < v_end
      order by c.opened_at desc,c.id desc limit p_page_size offset v_offset
    ) q;

  elsif p_report = 'payments' then
    select count(*), jsonb_build_object('methods_count',count(*),
      'amount',coalesce(sum(amount),0),'sales_count',coalesce(sum(sales_count),0))
      into v_total,v_summary from (
        select sp.method,sum(sp.amount) as amount,count(*) as sales_count
        from public.sale_payments sp join public.sales s on s.id=sp.sale_id
        where s.created_at >= v_start and s.created_at < v_end and s.status='CONCLUIDA'
        group by sp.method
      ) g;
    select coalesce(jsonb_agg(to_jsonb(q)), '[]'::jsonb) into v_rows from (
      select sp.method,sum(sp.amount) as amount,count(*) as sales_count
      from public.sale_payments sp join public.sales s on s.id=sp.sale_id
      where s.created_at >= v_start and s.created_at < v_end and s.status='CONCLUIDA'
      group by sp.method order by amount desc,sp.method
      limit p_page_size offset v_offset
    ) q;

  elsif p_report = 'operators' then
    select count(*),jsonb_build_object('operators_count',count(*),
      'sales_count',coalesce(sum(sales_count),0),
      'completed_amount',coalesce(sum(completed_amount),0))
      into v_total,v_summary from (
        select s.operator_id,count(*) as sales_count,
          coalesce(sum(s.total) filter (where s.status='CONCLUIDA'),0) as completed_amount
        from public.sales s where s.created_at >= v_start and s.created_at < v_end
        group by s.operator_id
      ) g;
    select coalesce(jsonb_agg(to_jsonb(q)), '[]'::jsonb) into v_rows from (
      select s.operator_id as id,coalesce(nullif(p.display_name,''),'Operador') as operator,
        count(*) as sales_count,
        count(*) filter (where s.status<>'CONCLUIDA') as cancelled_count,
        coalesce(sum(s.total) filter (where s.status='CONCLUIDA'),0) as completed_amount
      from public.sales s join public.profiles p on p.id=s.operator_id
      where s.created_at >= v_start and s.created_at < v_end
      group by s.operator_id,p.display_name order by completed_amount desc,operator
      limit p_page_size offset v_offset
    ) q;
  end if;

  return jsonb_build_object('report',p_report,'from_date',p_from_date,
    'to_date',p_to_date,'page',p_page,'page_size',p_page_size,
    'total',v_total,'summary',v_summary,'rows',v_rows);
end;
$$;
revoke all on function public.get_operational_report(text,date,date,integer,integer)
  from public, anon, authenticated;
grant execute on function public.get_operational_report(text,date,date,integer,integer)
  to authenticated;
