import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { ArrowRight, RefreshCw, TrendingDown, TrendingUp } from "lucide-react";
import { Card } from "../components/ui/Card";
import { EmptyState, ErrorState, LoadingState } from "../components/ui/Feedback";
import { dashboardError, getDashboardMetrics } from "../features/dashboard/api";
import { financePaymentLabels } from "../features/finance/api";
import { formatMoney, priceCents } from "../features/pdv/money";

const money = (value: number) => formatMoney(priceCents(value));
const quantity = (value: number) => new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 }).format(value);
const shortDate = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}`;

function Metric({ label, value, detail, tone = "normal", to }: {
  label: string; value: string; detail: string; tone?: "normal" | "good" | "bad"; to?: string;
}) {
  const content = <><span>{label}</span><strong>{value}</strong><small>{detail}</small>{to && <ArrowRight size={15} aria-hidden="true" />}</>;
  return <Card className={`dashboard-metric dashboard-metric-${tone}`}>{to ? <Link to={to} aria-label={`${label}: ${value}. ${detail}`}>{content}</Link> : <div>{content}</div>}</Card>;
}

export default function DashboardPage() {
  const query = useQuery({ queryKey: ["dashboard-metrics"], queryFn: getDashboardMetrics, refetchInterval: 60_000 });
  const data = query.data;
  const dailyMax = Math.max(1, ...(data?.daily_sales.map((item) => Math.abs(item.net_sales)) ?? []));
  const paymentMax = Math.max(1, ...(data?.payment_methods.map((item) => item.amount) ?? []));

  return <div className="page-stack dashboard-page">
    <div className="page-heading dashboard-heading"><div><div className="eyebrow">PAINEL GERENCIAL</div><h1>Visão do negócio<span className="accent-dot">.</span></h1><p>Vendas, resultado, caixa e estoque em uma visão.</p></div><button type="button" className="dashboard-refresh" onClick={() => void query.refetch()} disabled={query.isFetching}><RefreshCw size={16} className={query.isFetching ? "spin" : ""} /> Atualizar</button></div>
    {query.isPending ? <LoadingState label="Calculando indicadores..." /> : query.isError ? <ErrorState message={dashboardError(query.error)} onRetry={() => void query.refetch()} /> : data ? <>
      <div className="dashboard-date">Dados até {shortDate(data.as_of_date)} · Horário de São Paulo · Atualização automática a cada minuto</div>
      <div className="dashboard-metrics">
        <Metric label="Faturamento líquido hoje" value={money(data.today.net_sales)} detail="Vendas após descontos e estornos" to="/financeiro/resultado" />
        <Metric label="Lucro bruto estimado hoje" value={money(data.today.gross_profit)} detail="Faturamento líquido − CMV histórico" tone={data.today.gross_profit < 0 ? "bad" : "good"} to="/financeiro/resultado" />
        <Metric label="Vendas hoje" value={String(data.today.sales_count)} detail="Finalizadas hoje" to="/vendas" />
        <Metric label="Ticket médio hoje" value={data.today.average_ticket === null ? "—" : money(data.today.average_ticket)} detail="Antes dos cancelamentos" to="/financeiro/resultado" />
        <Metric label="Saldo dos caixas abertos" value={money(data.cash_balance)} detail={`${data.open_cash_count} caixa${data.open_cash_count === 1 ? "" : "s"} aberto${data.open_cash_count === 1 ? "" : "s"} · dinheiro físico`} to="/caixa" />
        <Metric label="Despesas deste mês" value={money(data.month.operating_expenses)} detail="Operacionais, pagas e pendentes" to="/financeiro/despesas" />
        <Metric label="Resultado deste mês" value={money(data.month.result)} detail="Lucro bruto + outras receitas − despesas" tone={data.month.result < 0 ? "bad" : "good"} to="/financeiro/resultado" />
        <Metric label="Estoque baixo" value={String(data.low_stock_count)} detail="Produtos ativos no limite ou abaixo" tone={data.low_stock_count > 0 ? "bad" : "normal"} to="/estoque" />
      </div>
      <div className="dashboard-visuals">
        <Card className="dashboard-panel"><div className="dashboard-panel-heading"><div><span className="eyebrow">TENDÊNCIA</span><h2>Vendas dos últimos 7 dias</h2><p>Faturamento líquido por dia, com estornos na data da confirmação.</p></div><TrendingUp size={20} aria-hidden="true" /></div><div className="dashboard-seven-days" role="list" aria-label="Faturamento líquido nos últimos sete dias">{data.daily_sales.map((item) => <div role="listitem" className="dashboard-day" key={item.date}><span className="dashboard-day-value">{money(item.net_sales)}</span><div className="dashboard-day-track"><div className={`dashboard-day-fill ${item.net_sales < 0 ? "negative" : ""}`} style={{ height: `${Math.max(item.net_sales === 0 ? 3 : 12, Math.abs(item.net_sales) / dailyMax * 100)}%` }} /></div><span>{shortDate(item.date)}</span></div>)}</div></Card>
        <Card className="dashboard-panel"><div className="dashboard-panel-heading"><div><span className="eyebrow">MÊS ATUAL</span><h2>Formas de pagamento</h2><p>Valor das vendas não canceladas por meio de pagamento.</p></div></div>{data.payment_methods.length ? <div className="dashboard-payment-list">{data.payment_methods.map((item) => <div className="dashboard-payment" key={item.method}><div><span>{financePaymentLabels[item.method as keyof typeof financePaymentLabels] ?? item.method}</span><strong>{money(item.amount)}</strong></div><div className="dashboard-progress"><span style={{ width: `${item.amount / paymentMax * 100}%` }} /></div><small>{item.sales_count} venda{item.sales_count === 1 ? "" : "s"}</small></div>)}</div> : <EmptyState title="Sem pagamentos no mês" description="As formas de pagamento aparecerão após a primeira venda." />}</Card>
      </div>
      <div className="dashboard-lists">
        <Card className="dashboard-panel"><div className="dashboard-panel-heading"><div><span className="eyebrow">MÊS ATUAL</span><h2>Produtos mais vendidos</h2><p>Por quantidade, somente vendas não canceladas.</p></div></div>{data.top_products.length ? <ol className="dashboard-ranking">{data.top_products.map((item) => <li key={item.id}><span>{item.name}</span><strong>{quantity(item.quantity)} {item.unit}</strong><small>{money(item.revenue)}</small></li>)}</ol> : <p className="dashboard-empty">Nenhum produto vendido neste mês.</p>}</Card>
        <Card className="dashboard-panel"><div className="dashboard-panel-heading"><div><span className="eyebrow">MÊS ATUAL</span><h2>Categorias mais vendidas</h2><p>Por faturamento, conforme a categoria atual dos produtos.</p></div></div>{data.top_categories.length ? <ol className="dashboard-ranking">{data.top_categories.map((item) => <li key={item.id}><span>{item.name}</span><strong>{money(item.revenue)}</strong><small>{quantity(item.quantity)} itens</small></li>)}</ol> : <p className="dashboard-empty">Nenhuma categoria com vendas neste mês.</p>}</Card>
        <Card className="dashboard-panel"><div className="dashboard-panel-heading"><div><span className="eyebrow">ATENÇÃO</span><h2>Estoque baixo</h2><p>{data.low_stock_count} produto{data.low_stock_count === 1 ? "" : "s"} no limite ou abaixo.</p></div><TrendingDown size={20} aria-hidden="true" /></div>{data.low_stock.length ? <ul className="dashboard-stock-list">{data.low_stock.map((item) => <li key={item.id}><span>{item.name}</span><strong>{quantity(item.quantity)} / {quantity(item.minimum_stock)} {item.unit}</strong></li>)}</ul> : <p className="dashboard-empty">Nenhum produto ativo com estoque baixo.</p>}<Link to="/estoque" className="dashboard-panel-link">Ver estoque <ArrowRight size={15} /></Link></Card>
      </div>
      <p className="dashboard-note">O lucro bruto de hoje considera o CMV histórico. O resultado do mês também inclui outras receitas e despesas operacionais pelo vencimento. A categoria Mercadorias fica fora dessas despesas para evitar dupla contagem com o CMV. <Link to="/financeiro/resultado">Ver metodologia completa →</Link></p>
    </> : null}
  </div>;
}
