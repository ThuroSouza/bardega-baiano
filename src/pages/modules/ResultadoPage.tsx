import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "../../components/ui/Badge";
import { Card } from "../../components/ui/Card";
import { EmptyState, ErrorState, LoadingState } from "../../components/ui/Feedback";
import { Input } from "../../components/ui/Input";
import { expenseCategories, financeError, getProfitAndLoss, localToday } from "../../features/finance/api";
import { FinanceNav } from "../../features/finance/FinanceNav";
import { formatMoney, priceCents } from "../../features/pdv/money";

type Period = "month" | "previous" | "7days" | "30days" | "custom";
const periodLabels: Record<Period, string> = {
  month: "Este mês", previous: "Mês anterior", "7days": "7 dias", "30days": "30 dias", custom: "Personalizado",
};
const money = (value: number) => formatMoney(priceCents(value));
const dateText = (value: string) => value.split("-").reverse().join("/");
function shiftDate(date: string, days: number) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
function rangeFor(period: Exclude<Period, "custom">) {
  const today = localToday();
  if (period === "month") return { fromDate: `${today.slice(0, 7)}-01`, toDate: today };
  if (period === "previous") {
    const end = shiftDate(`${today.slice(0, 7)}-01`, -1);
    return { fromDate: `${end.slice(0, 7)}-01`, toDate: end };
  }
  return { fromDate: shiftDate(today, period === "7days" ? -6 : -29), toDate: today };
}
function FormulaRow({ label, value, detail, operator, strong = false }: {
  label: string; value: number; detail?: string; operator?: string; strong?: boolean;
}) {
  return <div className={`profit-formula-row ${strong ? "profit-formula-strong" : ""}`}><span className="profit-formula-operator">{operator ?? ""}</span><div><span>{label}</span>{detail && <small>{detail}</small>}</div><strong className={value < 0 ? "cash-negative" : ""}>{money(value)}</strong></div>;
}

export default function ResultadoPage() {
  const [period, setPeriod] = useState<Period>("month");
  const [dates, setDates] = useState(() => rangeFor("month"));
  const interval = dates.fromDate && dates.toDate ?
    (Date.parse(`${dates.toDate}T12:00:00Z`) - Date.parse(`${dates.fromDate}T12:00:00Z`)) / 86400000 : NaN;
  const validDates = Boolean(dates.fromDate && dates.toDate && dates.fromDate <= dates.toDate && interval <= 3660);
  const report = useQuery({
    queryKey: ["profit-loss", dates.fromDate, dates.toDate],
    queryFn: () => getProfitAndLoss(dates.fromDate, dates.toDate),
    enabled: validDates,
  });
  function choosePeriod(next: Period) {
    setPeriod(next);
    if (next !== "custom") setDates(rangeFor(next));
  }
  const data = report.data;
  return <div className="page-stack">
    <div className="page-heading"><div><div className="eyebrow">FINANCEIRO · GERENCIAL</div><h1>Lucro e prejuízo</h1><p>Da venda ao resultado, com custos históricos e despesas do período.</p></div></div>
    <FinanceNav />
    <div className="profit-period" role="group" aria-label="Período do demonstrativo">{(Object.entries(periodLabels) as [Period, string][]).map(([value, label]) => <button type="button" key={value} className={period === value ? "active" : ""} aria-pressed={period === value} onClick={() => choosePeriod(value)}>{label}</button>)}</div>
    {period === "custom" && <div className="profit-dates"><Input label="De" type="date" value={dates.fromDate} onChange={(event) => setDates({ ...dates, fromDate: event.target.value })} /><Input label="Até" type="date" value={dates.toDate} onChange={(event) => setDates({ ...dates, toDate: event.target.value })} /></div>}
    {!validDates ? <div className="sales-error" role="alert">Escolha um período válido de até 10 anos.</div> : report.isPending ? <LoadingState label="Calculando resultado..." /> : report.isError ? <ErrorState message={financeError(report.error)} onRetry={() => void report.refetch()} /> : data ? <>
      <div className="profit-period-caption">Período: {dateText(data.from_date)} a {dateText(data.to_date)} · Horário de São Paulo</div>
      <Card className={`profit-result ${data.result < 0 ? "profit-loss" : ""}`}><div><span>RESULTADO GERENCIAL</span><strong>{money(data.result)}</strong><small>Lucro bruto + outras receitas − despesas operacionais</small></div><Badge tone={data.result < 0 ? "danger" : data.result > 0 ? "success" : "neutral"}>{data.result < 0 ? "Prejuízo" : data.result > 0 ? "Lucro" : "Equilíbrio"}</Badge></Card>
      <div className="profit-kpis"><Card><span>Margem do resultado</span><strong>{data.margin_percent === null ? "—" : `${new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(data.margin_percent)}%`}</strong><small>Resultado ÷ faturamento líquido positivo</small></Card><Card><span>Ticket médio na venda</span><strong>{data.average_ticket === null ? "—" : money(data.average_ticket)}</strong><small>Vendas após desconto ÷ quantidade de vendas</small></Card><Card><span>Quantidade de vendas</span><strong>{data.sales_count}</strong><small>Finalizadas no período, antes dos cancelamentos</small></Card><Card><span>Cancelamentos</span><strong>{data.cancellations_count}</strong><small>Confirmados no período</small></Card></div>
      <div className="profit-columns"><Card className="profit-formula"><h2>Faturamento e CMV</h2><FormulaRow label="Faturamento bruto" value={data.gross_sales} detail="Subtotal das vendas no período" /><FormulaRow label="Descontos" value={data.discounts} operator="−" /><FormulaRow label="Cancelamentos" value={data.cancellations} operator="−" detail="Estornos confirmados no período" /><FormulaRow label="Faturamento líquido" value={data.net_sales} operator="=" strong /><FormulaRow label="CMV" value={data.cmv} operator="−" detail="Custo salvo no item da venda, menos custos estornados" /><FormulaRow label="Lucro bruto" value={data.gross_profit} operator="=" strong /></Card><Card className="profit-formula"><h2>Do lucro bruto ao resultado</h2><FormulaRow label="Lucro bruto" value={data.gross_profit} /><FormulaRow label="Outras receitas" value={data.other_revenue} operator="+" detail="Receitas manuais e contas recebidas, líquidas de estornos" /><FormulaRow label="Despesas operacionais" value={data.operating_expenses} operator="−" detail="Títulos não cancelados com vencimento no período" /><FormulaRow label="Resultado" value={data.result} operator="=" strong /><div className="profit-expense-split"><div><span>Despesas pagas</span><strong>{money(data.expenses_paid)}</strong></div><div><span>Despesas pendentes</span><strong>{money(data.expenses_open)}</strong></div></div></Card></div>
      <div className="cash-section-heading"><div><h2>Despesas por categoria</h2><p>Valores operacionais do período, conforme vencimento.</p></div></div>
      {data.expense_categories.length ? <div className="profit-category-grid">{data.expense_categories.map((item) => <Card key={item.category} className="profit-category"><span>{expenseCategories[item.category]}</span><strong>{money(item.amount)}</strong><small>Pago {money(item.paid)} · Pendente {money(item.open)}</small></Card>)}</div> : <EmptyState title="Sem despesas operacionais" description="Nenhuma despesa não cancelada venceu neste período." />}
      <Card className="profit-methodology"><h2>Como este resultado é calculado</h2><p>Vendas entram pela data da finalização; cancelamentos pela data do estorno. Um cancelamento de venda antiga pode deixar o faturamento líquido deste período negativo. O CMV usa o custo registrado em cada item no momento da venda e o reverte no cancelamento.</p><p>Despesas entram pelo vencimento, pagas ou pendentes. A categoria Mercadorias não integra a despesa operacional para evitar duplicação com o CMV; compras dessa categoria no período: <strong>{money(data.inventory_purchases)}</strong>. Classifique compras de estoque como Mercadorias. Este demonstrativo gerencial não é um extrato de caixa nem um demonstrativo contábil formal.</p></Card>
    </> : null}
  </div>;
}
