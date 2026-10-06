-- Corrige o sinal dos estornos na série diária do dashboard.
-- Bloco 10: resumo gerencial agregado no banco. Somente ADMIN/GERENTE têm
-- dashboard.read e finance.read; a verificação consulta o papel atual.
create or replace function public.get_dashboard_metrics()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_today date := (now() at time zone 'America/Sao_Paulo')::date;
  v_month_start date;
  v_today_report jsonb;
  v_month_report jsonb;
  v_open_cash_count bigint;
  v_cash_balance numeric(18,2);
  v_low_stock_count bigint;
  v_low_stock jsonb;
  v_top_products jsonb;
  v_top_categories jsonb;
  v_daily_sales jsonb;
  v_payment_methods jsonb;
begin
  if (select auth.uid()) is null or not private.has_permission('dashboard.read')
      or not private.has_permission('finance.read') then
    raise exception 'dashboard_permission_denied' using errcode = '42501';
  end if;
  v_month_start := v_today - (extract(day from v_today)::int - 1);
  v_today_report := public.get_profit_and_loss(v_today, v_today);
  v_month_report := public.get_profit_and_loss(v_month_start, v_today);

  -- Dinheiro físico somado dos caixas abertos, não a soma de PIX/cartões.
  select count(distinct cs.id), coalesce(sum(cm.amount), 0)
    into v_open_cash_count, v_cash_balance
  from public.cash_sessions cs
  left join public.cash_movements cm on cm.session_id = cs.id and cm.method = 'DINHEIRO'
  where cs.status = 'ABERTO';

  select count(*) into v_low_stock_count
  from public.products p join public.stock_balances b on b.product_id = p.id
  where p.is_active and p.minimum_stock > 0 and b.quantity <= p.minimum_stock;
  select coalesce(jsonb_agg(jsonb_build_object('id', q.id, 'name', q.name,
    'quantity', q.quantity, 'minimum_stock', q.minimum_stock, 'unit', q.unit)
    order by q.quantity / q.minimum_stock, q.name), '[]'::jsonb)
    into v_low_stock
  from (
    select p.id, p.name, b.quantity, p.minimum_stock, p.unit
    from public.products p join public.stock_balances b on b.product_id = p.id
    where p.is_active and p.minimum_stock > 0 and b.quantity <= p.minimum_stock
    order by b.quantity / p.minimum_stock, p.name limit 5
  ) q;

  -- Rankings excluem vendas canceladas. O nome do produto vem do item histórico.
  select coalesce(jsonb_agg(jsonb_build_object('id', q.id, 'name', q.name,
    'quantity', q.quantity, 'revenue', q.revenue, 'unit', q.unit)
    order by q.quantity desc, q.revenue desc, q.name), '[]'::jsonb)
    into v_top_products
  from (
    select i.product_id as id, max(i.product_name) as name, max(i.unit) as unit,
      sum(i.quantity) as quantity, sum(i.net_subtotal) as revenue
    from public.sales s join public.sale_items i on i.sale_id = s.id
    where s.created_at >= (v_month_start::timestamp at time zone 'America/Sao_Paulo')
      and s.created_at < ((v_today + 1)::timestamp at time zone 'America/Sao_Paulo')
      and s.status = 'CONCLUIDA'
    group by i.product_id
    order by quantity desc, revenue desc, name limit 5
  ) q;

  -- A categoria reflete o cadastro atual; alterações de categoria também
  -- reclassificam vendas antigas no ranking.
  select coalesce(jsonb_agg(jsonb_build_object('id', q.id, 'name', q.name,
    'quantity', q.quantity, 'revenue', q.revenue)
    order by q.revenue desc, q.quantity desc, q.name), '[]'::jsonb)
    into v_top_categories
  from (
    select c.id, c.name, sum(i.quantity) as quantity, sum(i.net_subtotal) as revenue
    from public.sales s join public.sale_items i on i.sale_id = s.id
    join public.products p on p.id = i.product_id
    join public.categories c on c.id = p.category_id
    where s.created_at >= (v_month_start::timestamp at time zone 'America/Sao_Paulo')
      and s.created_at < ((v_today + 1)::timestamp at time zone 'America/Sao_Paulo')
      and s.status = 'CONCLUIDA'
    group by c.id, c.name
    order by revenue desc, quantity desc, c.name limit 5
  ) q;

  -- Série de faturamento líquido por evento: venda no dia da finalização,
  -- estorno no dia da confirmação, inclusive de vendas de meses anteriores.
  with days as (
    select generate_series((v_today - 6)::timestamp, v_today::timestamp, interval '1 day')::date as day
  ), sold as (
    select (s.created_at at time zone 'America/Sao_Paulo')::date as day,
      sum(s.total) as amount
    from public.sales s
    where s.created_at >= ((v_today - 6)::timestamp at time zone 'America/Sao_Paulo')
      and s.created_at < ((v_today + 1)::timestamp at time zone 'America/Sao_Paulo')
    group by 1
  ), cancelled as (
    select (fe.created_at at time zone 'America/Sao_Paulo')::date as day,
      sum(fe.amount) as amount
    from public.financial_entries fe
    where fe.type = 'ESTORNO' and fe.sale_id is not null
      and fe.created_at >= ((v_today - 6)::timestamp at time zone 'America/Sao_Paulo')
      and fe.created_at < ((v_today + 1)::timestamp at time zone 'America/Sao_Paulo')
    group by 1
  )
  select coalesce(jsonb_agg(jsonb_build_object('date', d.day,
    'net_sales', coalesce(s.amount,0) + coalesce(c.amount,0)) order by d.day), '[]'::jsonb)
    into v_daily_sales
  from days d left join sold s on s.day = d.day left join cancelled c on c.day = d.day;

  select coalesce(jsonb_agg(jsonb_build_object('method', q.method,
    'amount', q.amount, 'sales_count', q.sales_count)
    order by q.amount desc, q.method), '[]'::jsonb)
    into v_payment_methods
  from (
    select sp.method, sum(sp.amount) as amount, count(*) as sales_count
    from public.sales s join public.sale_payments sp on sp.sale_id = s.id
    where s.created_at >= (v_month_start::timestamp at time zone 'America/Sao_Paulo')
      and s.created_at < ((v_today + 1)::timestamp at time zone 'America/Sao_Paulo')
      and s.status = 'CONCLUIDA'
    group by sp.method
  ) q;

  return jsonb_build_object(
    'as_of_date', v_today, 'today', v_today_report, 'month', v_month_report,
    'open_cash_count', v_open_cash_count, 'cash_balance', v_cash_balance,
    'low_stock_count', v_low_stock_count, 'low_stock', v_low_stock,
    'top_products', v_top_products, 'top_categories', v_top_categories,
    'daily_sales', v_daily_sales, 'payment_methods', v_payment_methods
  );
end;
$$;
revoke all on function public.get_dashboard_metrics() from public, anon, authenticated;
grant execute on function public.get_dashboard_metrics() to authenticated;
