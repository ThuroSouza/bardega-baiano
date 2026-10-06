-- Bloco 19: regressão de vendas, estoque, caixa, financeiro e autorização.
-- Execute somente em desenvolvimento/homologação. Tudo é revertido no fim.
begin;

do $$
begin
  if has_table_privilege('anon','public.sales','SELECT')
     or has_table_privilege('anon','public.profiles','SELECT')
     or has_function_privilege('anon',
       'public.checkout_sale(uuid,jsonb,text,numeric,numeric,text)','EXECUTE')
     or has_function_privilege('anon',
       'public.get_sale_context(uuid)','EXECUTE') then
    raise exception 'anonymous_access_exposed';
  end if;
  if has_table_privilege('authenticated','public.sales','UPDATE')
     or has_table_privilege('authenticated','public.sale_items','UPDATE')
     or has_column_privilege('authenticated','public.sale_items','unit_cost','SELECT')
     or has_table_privilege('authenticated','public.financial_entries','INSERT') then
    raise exception 'direct_business_write_exposed';
  end if;
  if exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind in ('r','p') and not c.relrowsecurity) then
    raise exception 'public_table_without_rls';
  end if;
end;
$$;

insert into auth.users(id,email) values
  ('a1111111-1111-4111-8111-111111111111','admin-block19@test.invalid'),
  ('a2222222-2222-4222-8222-222222222222','caixa-block19@test.invalid'),
  ('a3333333-3333-4333-8333-333333333333','estoque-block19@test.invalid');
update public.profiles set role='ADMIN',is_active=true
  where id='a1111111-1111-4111-8111-111111111111';
update public.profiles set role='CAIXA',is_active=true
  where id='a2222222-2222-4222-8222-222222222222';
update public.profiles set role='ESTOQUE',is_active=true
  where id='a3333333-3333-4333-8333-333333333333';
insert into public.products(id,name,category_id,internal_code,cost_price,sale_price)
  values ('a4444444-4444-4444-8444-444444444444','Produto bloco 19',
    (select id from public.categories order by name limit 1),
    'BLOCO19-TEST',4,10);

set local role authenticated;
set local request.jwt.claim.sub = 'a1111111-1111-4111-8111-111111111111';
set local request.jwt.claims = '{"sub":"a1111111-1111-4111-8111-111111111111","role":"authenticated","aal":"aal1","is_anonymous":false}';
create temporary table block19_profit_baseline on commit drop as
  select public.get_profit_and_loss(
    (now() at time zone 'America/Sao_Paulo')::date,
    (now() at time zone 'America/Sao_Paulo')::date) as metrics;

set local role authenticated;
set local request.jwt.claim.sub = 'a3333333-3333-4333-8333-333333333333';
set local request.jwt.claims = '{"sub":"a3333333-3333-4333-8333-333333333333","role":"authenticated","aal":"aal1","is_anonymous":false}';
do $$
declare v_move public.stock_movements;
begin
  if private.has_permission('finance.read') or private.has_permission('sales.read') then
    raise exception 'stock_role_can_read_finance_or_sales';
  end if;
  begin
    perform public.get_profit_and_loss(current_date,current_date);
    raise exception 'stock_role_accessed_finance';
  exception when others then
    if sqlerrm <> 'finance_permission_denied' then raise; end if;
  end;
  begin
    perform public.get_sale_context('a7777777-7777-4777-8777-777777777777');
    raise exception 'stock_role_accessed_sale_by_url_id';
  exception when others then
    if sqlerrm <> 'sales_permission_denied' then raise; end if;
  end;
  v_move := public.record_stock_movement(
    p_product_id := 'a4444444-4444-4444-8444-444444444444',
    p_type := 'ENTRADA',p_request_id := 'a5555555-5555-4555-8555-555555555555',
    p_quantity := 5,p_unit_cost := 4);
  if v_move.new_quantity <> 5 then raise exception 'stock_entry_wrong_balance'; end if;
  if (public.record_stock_movement(
    p_product_id := 'a4444444-4444-4444-8444-444444444444',
    p_type := 'ENTRADA',p_request_id := 'a5555555-5555-4555-8555-555555555555',
    p_quantity := 5,p_unit_cost := 4)).id <> v_move.id then
    raise exception 'stock_retry_not_idempotent';
  end if;
  begin
    perform public.record_stock_movement(
      p_product_id := 'a4444444-4444-4444-8444-444444444444',
      p_type := 'ENTRADA',p_request_id := 'a5555555-5555-4555-8555-555555555555',
      p_quantity := 6,p_unit_cost := 4);
    raise exception 'stock_changed_request_accepted';
  exception when others then
    if sqlerrm <> 'stock_request_reused' then raise; end if;
  end;
end;
$$;

set local request.jwt.claim.sub = 'a2222222-2222-4222-8222-222222222222';
set local request.jwt.claims = '{"sub":"a2222222-2222-4222-8222-222222222222","role":"authenticated","aal":"aal1","is_anonymous":false,"user_metadata":{"role":"ADMIN"}}';
do $$
declare v_session public.cash_sessions;
        v_supply public.cash_movements;
begin
  if private.has_permission('users.read') or private.has_permission('finance.read') then
    raise exception 'cash_role_privilege_escalation';
  end if;
  begin
    perform public.admin_list_users('',0,10);
    raise exception 'cash_role_accessed_users_endpoint';
  exception when others then
    if sqlerrm <> 'users_permission_denied' then raise; end if;
  end;
  v_session := public.open_cash_session('a6666666-6666-4666-8666-666666666666',20);
  if (public.open_cash_session('a6666666-6666-4666-8666-666666666666',20)).id
     <> v_session.id then raise exception 'cash_open_retry_not_idempotent'; end if;
  begin
    perform public.open_cash_session('a6666666-6666-4666-8666-666666666666',21);
    raise exception 'cash_open_changed_request_accepted';
  exception when others then
    if sqlerrm <> 'cash_request_reused' then raise; end if;
  end;
  v_supply := public.add_cash_adjustment(v_session.id,
    'b3333333-3333-4333-8333-333333333333','SUPPLY',5,'Teste suprimento');
  if (public.add_cash_adjustment(v_session.id,
    'b3333333-3333-4333-8333-333333333333',
    'SUPPLY',5,'Teste suprimento')).id <> v_supply.id then
    raise exception 'cash_adjustment_retry_not_idempotent';
  end if;
  begin
    perform public.add_cash_adjustment(v_session.id,
      'b4444444-4444-4444-8444-444444444444',
      'WITHDRAWAL',26,'Teste sangria');
    raise exception 'cash_overdraft_accepted';
  exception when others then
    if sqlerrm <> 'cash_insufficient' then raise; end if;
  end;
end;
$$;

-- O total e o preço são calculados no banco. Campos extras em p_items são recusados.
do $$
declare v_items jsonb := '[{"product_id":"a4444444-4444-4444-8444-444444444444","quantity":1}]';
        v_sale public.sales;
begin
  begin
    perform public.checkout_sale('a7777777-7777-4777-8777-777777777777',
      v_items,'DINHEIRO',0.01,0,'');
    raise exception 'tampered_total_accepted';
  exception when others then
    if sqlerrm <> 'sale_price_changed' then raise; end if;
  end;
  begin
    perform public.checkout_sale('a7777777-7777-4777-8777-777777777777',
      '[{"product_id":"a4444444-4444-4444-8444-444444444444","quantity":1,"unit_price":0.01}]',
      'DINHEIRO',10,0,'');
    raise exception 'tampered_unit_price_accepted';
  exception when others then
    if sqlerrm <> 'sale_invalid_item' then raise; end if;
  end;
  begin
    perform public.checkout_sale('a7777777-7777-4777-8777-777777777777',
      v_items,'DINHEIRO',9,1,'desconto indevido');
    raise exception 'cash_role_discount_accepted';
  exception when others then
    if sqlerrm <> 'sale_discount_denied' then raise; end if;
  end;
  begin
    perform public.checkout_sale('b5555555-5555-4555-8555-555555555555',
      '[{"product_id":"a4444444-4444-4444-8444-444444444444","quantity":6}]',
      'DINHEIRO',60,0,'');
    raise exception 'sale_without_stock_accepted';
  exception when others then
    if sqlerrm <> 'sale_insufficient_stock' then raise; end if;
  end;
  v_sale := public.checkout_sale('a7777777-7777-4777-8777-777777777777',
    v_items,'DINHEIRO',10,0,'');
  if v_sale.total <> 10 or v_sale.subtotal <> 10 then
    raise exception 'sale_total_incorrect';
  end if;
  if (public.checkout_sale('a7777777-7777-4777-8777-777777777777',
    v_items,'DINHEIRO',10,0,'')).id <> v_sale.id then
    raise exception 'sale_retry_not_idempotent';
  end if;
  begin
    perform public.checkout_sale('a7777777-7777-4777-8777-777777777777',
      v_items,'PIX',10,0,'');
    raise exception 'sale_changed_request_accepted';
  exception when others then
    if sqlerrm <> 'sale_request_reused' then raise; end if;
  end;
  if (select count(*) from public.sale_items where sale_id=v_sale.id) <> 1
     or (select count(*) from public.sale_payments where sale_id=v_sale.id) <> 1 then
    raise exception 'sale_not_atomic';
  end if;
  begin
    perform public.get_sale_context('a9999999-9999-4999-8999-999999999999');
    raise exception 'modified_url_id_found_unrelated_sale';
  exception when others then
    if sqlerrm <> 'sale_not_found' then raise; end if;
  end;
end;
$$;

-- ADMIN confirma lucro, despesa e receita; uma venda cancelada reverte o CMV.
set local request.jwt.claim.sub = 'a1111111-1111-4111-8111-111111111111';
set local request.jwt.claims = '{"sub":"a1111111-1111-4111-8111-111111111111","role":"authenticated","aal":"aal1","is_anonymous":false}';
do $$
declare v_day date := (now() at time zone 'America/Sao_Paulo')::date;
        v_metrics jsonb;
        v_base jsonb;
        v_expense public.financial_expenses;
        v_revenue public.financial_entries;
begin
  if (select count(*) from public.financial_entries fe join public.sales s
      on s.id=fe.sale_id
      where s.request_id='a7777777-7777-4777-8777-777777777777') <> 1
     or (select quantity from public.stock_balances
         where product_id='a4444444-4444-4444-8444-444444444444') <> 4 then
    raise exception 'sale_finance_or_stock_not_atomic';
  end if;
  v_metrics := public.get_profit_and_loss(v_day,v_day);
  select metrics into v_base from pg_temp.block19_profit_baseline;
  if (v_metrics->>'gross_sales')::numeric-(v_base->>'gross_sales')::numeric <> 10
     or (v_metrics->>'net_sales')::numeric-(v_base->>'net_sales')::numeric <> 10
     or (v_metrics->>'cost_sold')::numeric-(v_base->>'cost_sold')::numeric <> 4
     or (v_metrics->>'cmv')::numeric-(v_base->>'cmv')::numeric <> 4
     or (v_metrics->>'gross_profit')::numeric-(v_base->>'gross_profit')::numeric <> 6
     or (v_metrics->>'sales_count')::bigint-(v_base->>'sales_count')::bigint <> 1 then
    raise exception 'profit_formula_incorrect';
  end if;
  v_expense := public.create_financial_expense(
    'b1111111-1111-4111-8111-111111111111','Despesa teste bloco 19',
    'OUTROS','',3,v_day,'');
  if (public.create_financial_expense(
    'b1111111-1111-4111-8111-111111111111','Despesa teste bloco 19',
    'OUTROS','',3,v_day,'')).id <> v_expense.id then
    raise exception 'expense_retry_not_idempotent';
  end if;
  begin
    perform public.create_financial_expense(
      'b1111111-1111-4111-8111-111111111111','Despesa teste bloco 19',
      'OUTROS','',4,v_day,'');
    raise exception 'expense_changed_request_accepted';
  exception when others then
    if sqlerrm <> 'finance_request_reused' then raise; end if;
  end;
  v_revenue := public.record_manual_revenue(
    'b2222222-2222-4222-8222-222222222222','Receita teste bloco 19',
    2,v_day,'PIX','');
  if (public.record_manual_revenue(
    'b2222222-2222-4222-8222-222222222222','Receita teste bloco 19',
    2,v_day,'PIX','')).id <> v_revenue.id then
    raise exception 'revenue_retry_not_idempotent';
  end if;
  v_metrics := public.get_profit_and_loss(v_day,v_day);
  if (v_metrics->>'operating_expenses')::numeric-
       (v_base->>'operating_expenses')::numeric <> 3
     or (v_metrics->>'other_revenue')::numeric-
       (v_base->>'other_revenue')::numeric <> 2
     or (v_metrics->>'result')::numeric-(v_base->>'result')::numeric <> 5 then
    raise exception 'finance_result_incorrect';
  end if;
end;
$$;

set local request.jwt.claim.sub = 'a2222222-2222-4222-8222-222222222222';
set local request.jwt.claims = '{"sub":"a2222222-2222-4222-8222-222222222222","role":"authenticated","aal":"aal1","is_anonymous":false}';
do $$
declare v_request public.sale_cancellation_requests;
        v_sale_id uuid;
begin
  select id into v_sale_id from public.sales
    where request_id='a7777777-7777-4777-8777-777777777777';
  v_request := public.request_sale_cancellation(
    v_sale_id,'Cancelamento teste bloco 19');
  if (public.request_sale_cancellation(
    v_sale_id,
    'Cancelamento teste bloco 19')).id <> v_request.id then
    raise exception 'cancellation_request_retry_not_idempotent';
  end if;
  begin
    perform public.resolve_sale_cancellation(v_request.id,true,'');
    raise exception 'cash_role_approved_cancellation';
  exception when others then
    if sqlerrm <> 'cancellation_permission_denied' then raise; end if;
  end;
end;
$$;

set local request.jwt.claim.sub = 'a1111111-1111-4111-8111-111111111111';
set local request.jwt.claims = '{"sub":"a1111111-1111-4111-8111-111111111111","role":"authenticated","aal":"aal1","is_anonymous":false}';
do $$
declare v_request_id uuid;
        v_sale public.sales;
        v_day date := (now() at time zone 'America/Sao_Paulo')::date;
        v_metrics jsonb;
        v_base jsonb;
begin
  select cr.id into v_request_id from public.sale_cancellation_requests cr
    join public.sales s on s.id=cr.sale_id
    where s.request_id='a7777777-7777-4777-8777-777777777777';
  v_sale := public.resolve_sale_cancellation(v_request_id,true,'');
  if v_sale.status <> 'CANCELADA'
     or (select quantity from public.stock_balances
         where product_id='a4444444-4444-4444-8444-444444444444') <> 5
     or (select count(*) from public.stock_movements
         where sale_id=v_sale.id and type='CANCELAMENTO') <> 1
     or (select sum(amount) from public.cash_movements
         where sale_id=v_sale.id) <> 0
     or (select sum(amount) from public.financial_entries
         where sale_id=v_sale.id) <> 0 then
    raise exception 'cancellation_not_atomic';
  end if;
  begin
    perform public.resolve_sale_cancellation(v_request_id,true,'');
    raise exception 'duplicate_cancellation_accepted';
  exception when others then
    if sqlerrm <> 'cancellation_already_resolved' then raise; end if;
  end;
  v_metrics := public.get_profit_and_loss(v_day,v_day);
  select metrics into v_base from pg_temp.block19_profit_baseline;
  if (v_metrics->>'cost_reversed')::numeric-
       (v_base->>'cost_reversed')::numeric <> 4
     or (v_metrics->>'cancellations')::numeric-
       (v_base->>'cancellations')::numeric <> 10
     or (v_metrics->>'cmv')::numeric <> (v_base->>'cmv')::numeric
     or (v_metrics->>'net_sales')::numeric <> (v_base->>'net_sales')::numeric
     or (v_metrics->>'gross_profit')::numeric <> (v_base->>'gross_profit')::numeric
     or (v_metrics->>'result')::numeric-(v_base->>'result')::numeric <> -1 then
    raise exception 'cancelled_profit_incorrect';
  end if;
end;
$$;

set local request.jwt.claim.sub = 'a2222222-2222-4222-8222-222222222222';
set local request.jwt.claims = '{"sub":"a2222222-2222-4222-8222-222222222222","role":"authenticated","aal":"aal1","is_anonymous":false}';
do $$
declare v_session_id uuid;
        v_closed public.cash_sessions;
begin
  select id into v_session_id from public.cash_sessions
    where open_request_id='a6666666-6666-4666-8666-666666666666';
  v_closed := public.close_cash_session(v_session_id,25,'Teste bloco 19');
  if v_closed.status <> 'FECHADO' or v_closed.expected_amount <> 25
     or v_closed.difference_amount <> 0 then
    raise exception 'cash_close_incorrect';
  end if;
  if (public.close_cash_session(v_session_id,25,'Teste bloco 19')).id
     <> v_closed.id then raise exception 'cash_close_retry_not_idempotent'; end if;
end;
$$;

-- Prova adicional de isolamento: nenhuma linha de teste pode sobreviver.
rollback;
