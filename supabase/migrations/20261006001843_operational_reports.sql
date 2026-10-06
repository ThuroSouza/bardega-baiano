-- Bloco 11: relatórios paginados. Todas as leituras são agregadas no banco;
-- reports.read sozinho não amplia acesso a vendas, estoque, caixa e finanças.
create function public.get_operational_report(
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
    where p.is_active;
    select coalesce(jsonb_agg(to_jsonb(q)), '[]'::jsonb) into v_rows from (
      select p.id, p.name as product, c.name as category, p.unit,
        b.quantity, p.minimum_stock, p.cost_price,
        round(b.quantity*p.cost_price,2) as stock_value,
        p.minimum_stock>0 and b.quantity<=p.minimum_stock as low_stock
      from public.products p join public.stock_balances b on b.product_id=p.id
      join public.categories c on c.id=p.category_id
      where p.is_active order by low_stock desc, p.name, p.id
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
