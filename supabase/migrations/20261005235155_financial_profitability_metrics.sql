-- Bloco 9: demonstrativo por evento de venda/cancelamento e vencimento da despesa.
create index financial_expenses_reporting_due_idx on public.financial_expenses(due_on)
  where status <> 'CANCELADA';

create function public.get_profit_and_loss(p_from_date date, p_to_date date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_start timestamptz;
  v_end timestamptz;
  v_gross numeric(18,2) := 0;
  v_discounts numeric(18,2) := 0;
  v_cancelled numeric(18,2) := 0;
  v_sales_count bigint := 0;
  v_cancellations_count bigint := 0;
  v_cost_sold numeric(18,2) := 0;
  v_cost_reversed numeric(18,2) := 0;
  v_cmv numeric(18,2);
  v_net_sales numeric(18,2);
  v_gross_profit numeric(18,2);
  v_other_revenue numeric(18,2) := 0;
  v_expenses numeric(18,2) := 0;
  v_expenses_paid numeric(18,2) := 0;
  v_expenses_open numeric(18,2) := 0;
  v_inventory_purchases numeric(18,2) := 0;
  v_result numeric(18,2);
  v_margin numeric(12,2);
  v_average_ticket numeric(18,2);
  v_expense_categories jsonb;
begin
  if not private.has_permission('finance.read') or (select auth.uid()) is null then
    raise exception 'finance_permission_denied' using errcode = '42501';
  end if;
  if p_from_date is null or p_to_date is null or p_from_date > p_to_date or
    p_to_date - p_from_date > 3660 then
    raise exception 'profit_invalid_period' using errcode = '22023';
  end if;
  v_start := p_from_date::timestamp at time zone 'America/Sao_Paulo';
  v_end := (p_to_date + 1)::timestamp at time zone 'America/Sao_Paulo';

  -- Uma venda entra no dia da finalização. O custo vem do snapshot sale_items.unit_cost.
  select coalesce(sum(s.subtotal),0), coalesce(sum(s.discount_amount),0), count(*),
    coalesce(sum(coalesce((select sum(round(i.unit_cost * i.quantity, 2))
      from public.sale_items i where i.sale_id = s.id),0)),0)
  into v_gross, v_discounts, v_sales_count, v_cost_sold
  from public.sales s where s.created_at >= v_start and s.created_at < v_end;

  -- Estornos entram no dia do cancelamento, inclusive de vendas de períodos anteriores.
  select -coalesce(sum(fe.amount),0), count(*),
    coalesce(sum(coalesce((select sum(round(i.unit_cost * i.quantity, 2))
      from public.sale_items i where i.sale_id = fe.sale_id),0)),0)
  into v_cancelled, v_cancellations_count, v_cost_reversed
  from public.financial_entries fe
  where fe.type = 'ESTORNO' and fe.sale_id is not null
    and fe.created_at >= v_start and fe.created_at < v_end;

  v_net_sales := v_gross - v_discounts - v_cancelled;
  v_cmv := v_cost_sold - v_cost_reversed;
  v_gross_profit := v_net_sales - v_cmv;

  -- Receitas fora do PDV entram somente quando confirmadas, inclusive correções negativas.
  select coalesce(sum(fe.amount),0) into v_other_revenue
  from public.financial_entries fe
  where fe.type in ('RECEITA_MANUAL','ESTORNO_MANUAL')
    and fe.received_on between p_from_date and p_to_date;

  -- Vencimento representa a competência disponível. MERCADORIAS é compra de estoque;
  -- o custo da mercadoria vendida já aparece em CMV e não deve ser duplicado.
  select coalesce(sum(e.amount) filter (where e.category <> 'MERCADORIAS'),0),
    coalesce(sum(e.amount) filter (where e.category <> 'MERCADORIAS' and e.status = 'PAGA'),0),
    coalesce(sum(e.amount) filter (where e.category <> 'MERCADORIAS' and e.status = 'PENDENTE'),0),
    coalesce(sum(e.amount) filter (where e.category = 'MERCADORIAS'),0)
  into v_expenses, v_expenses_paid, v_expenses_open, v_inventory_purchases
  from public.financial_expenses e
  where e.status <> 'CANCELADA' and e.due_on between p_from_date and p_to_date;

  select coalesce(jsonb_agg(jsonb_build_object('category', c.category,
    'amount', c.amount, 'paid', c.paid, 'open', c.open)
    order by c.amount desc, c.category), '[]'::jsonb)
  into v_expense_categories
  from (
    select e.category, sum(e.amount) as amount,
      coalesce(sum(e.amount) filter (where e.status = 'PAGA'),0) as paid,
      coalesce(sum(e.amount) filter (where e.status = 'PENDENTE'),0) as open
    from public.financial_expenses e
    where e.status <> 'CANCELADA' and e.category <> 'MERCADORIAS'
      and e.due_on between p_from_date and p_to_date
    group by e.category
  ) c;

  v_result := v_gross_profit + v_other_revenue - v_expenses;
  v_margin := case when v_net_sales > 0 then round(v_result / v_net_sales * 100,2) else null end;
  v_average_ticket := case when v_sales_count > 0 then
    round((v_gross - v_discounts) / v_sales_count,2) else null end;

  return jsonb_build_object(
    'from_date', p_from_date, 'to_date', p_to_date,
    'gross_sales', v_gross, 'discounts', v_discounts,
    'cancellations', v_cancelled, 'net_sales', v_net_sales,
    'cost_sold', v_cost_sold, 'cost_reversed', v_cost_reversed, 'cmv', v_cmv,
    'gross_profit', v_gross_profit, 'other_revenue', v_other_revenue,
    'operating_expenses', v_expenses, 'expenses_paid', v_expenses_paid,
    'expenses_open', v_expenses_open, 'inventory_purchases', v_inventory_purchases,
    'result', v_result, 'margin_percent', v_margin,
    'average_ticket', v_average_ticket, 'sales_count', v_sales_count,
    'cancellations_count', v_cancellations_count,
    'expense_categories', v_expense_categories
  );
end;
$$;
revoke all on function public.get_profit_and_loss(date,date) from public, anon, authenticated;
grant execute on function public.get_profit_and_loss(date,date) to authenticated;
