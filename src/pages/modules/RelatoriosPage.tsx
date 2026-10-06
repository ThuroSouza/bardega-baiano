import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { Card } from "../../components/ui/Card";
import { EmptyState, ErrorState, LoadingState } from "../../components/ui/Feedback";
import { Input } from "../../components/ui/Input";
import { Select } from "../../components/ui/Select";
import { financePaymentLabels, expenseCategories, localToday } from "../../features/finance/api";
import { FinancePagination } from "../../features/finance/FinancePagination";
import { formatMoney, priceCents } from "../../features/pdv/money";
import { getOperationalReport, reportNames, reportsError } from "../../features/reports/api";
import type { ReportKey } from "../../features/reports/api";
import { reportConfig } from "../../features/reports/config";
import type { Column } from "../../features/reports/config";
import { operationLabels } from "../../features/stock/labels";

type Period = "today" | "yesterday" | "week" | "month" | "custom";
const periodLabels: Record<Period, string> = {
  today: "Hoje", yesterday: "Ontem", week: "Semana", month: "Mês", custom: "Personalizado",
};
const money = (value: number) => formatMoney(priceCents(value));
const quantity = (value: number) => new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 }).format(value);
const dateText = (value: string) => value.split("-").reverse().join("/");
const datetime = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short",
});
const labels: Record<string, string> = {
  CONCLUIDA: "Concluída", CANCELADA: "Cancelada", ESTORNADA: "Estornada",
  PENDENTE: "Pendente", PAGA: "Paga", ABERTO: "Aberto", FECHADO: "Fechado",
  RECEITA: "Venda", ESTORNO: "Estorno de venda",
  RECEITA_MANUAL: "Receita manual", ESTORNO_MANUAL: "Estorno manual",
};
function shiftDate(date: string, days: number) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
function rangeFor(period: Exclude<Period, "custom">) {
  const today = localToday();
  if (period === "today") return { fromDate: today, toDate: today };
  if (period === "yesterday") { const yesterday = shiftDate(today, -1); return { fromDate: yesterday, toDate: yesterday }; }
  if (period === "month") return { fromDate: `${today.slice(0, 7)}-01`, toDate: today };
  const day = new Date(`${today}T12:00:00Z`).getUTCDay();
  return { fromDate: shiftDate(today, -((day + 6) % 7)), toDate: today };
}
function formatCell(value: unknown, column: Column, report: ReportKey, row: Record<string, unknown>) {
  if (value === null || value === undefined || value === "") return "—";
  if (column.kind === "bool") return value ? "Sim" : "Não";
  if (column.kind === "date") return dateText(String(value));
  if (column.kind === "datetime") return datetime.format(new Date(String(value)));
  if (column.kind === "qty") return quantity(Number(value));
  if (column.kind === "percent" || (report === "profit" && row.label === "Margem percentual" && column.key === "amount")) return `${quantity(Number(value))}%`;
  if (column.kind === "money") return money(Number(value));
  if (column.kind === "status" || column.kind === "type") {
    const key = String(value);
    return labels[key] || financePaymentLabels[key as keyof typeof financePaymentLabels]
      || expenseCategories[key as keyof typeof expenseCategories]
      || operationLabels[key as keyof typeof operationLabels] || key;
  }
  if (column.key === "sale_number" && report === "sales") return <Link to={`/vendas/${row.id}`} className="report-row-link">#{String(value)}</Link>;
  if (column.key === "product" && (report === "stock" || report === "products")) return <Link to={`/produtos/${row.id}`} className="report-row-link">{String(value)}</Link>;
  return String(value);
}

export default function RelatoriosPage() {
  const [report, setReport] = useState<ReportKey>("sales");
  const [period, setPeriod] = useState<Period>("month");
  const [dates, setDates] = useState(() => rangeFor("month"));
  const [page, setPage] = useState(0);
  const interval = dates.fromDate && dates.toDate ?
    (Date.parse(`${dates.toDate}T12:00:00Z`) - Date.parse(`${dates.fromDate}T12:00:00Z`)) / 86400000 : NaN;
  const validDates = Boolean(dates.fromDate && dates.toDate && dates.fromDate <= dates.toDate && interval <= 3660);
  const query = useQuery({
    queryKey: ["operational-report", report, dates.fromDate, dates.toDate, page],
    queryFn: () => getOperationalReport(report, dates.fromDate, dates.toDate, page),
    enabled: validDates,
  });
  const config = reportConfig[report];
  const data = query.data;
  function choosePeriod(next: Period) {
    setPeriod(next);
    setPage(0);
    if (next !== "custom") setDates(rangeFor(next));
  }
  function chooseReport(next: ReportKey) { setReport(next); setPage(0); }
  return <div className="page-stack report-page">
    <div className="page-heading"><div><div className="eyebrow">ANÁLISE · OPERAÇÃO</div><h1>Relatórios</h1><p>Explore vendas, estoque, finanças e operadores por período.</p></div></div>
    <div className="report-tabs" role="group" aria-label="Tipo de relatório">{(Object.entries(reportNames) as [ReportKey, string][]).map(([key, label]) => <button type="button" key={key} aria-pressed={report === key} className={report === key ? "active" : ""} onClick={() => chooseReport(key)}>{label}</button>)}</div>
    <Select label="Tipo de relatório" className="report-mobile-select" value={report} onChange={(event) => chooseReport(event.target.value as ReportKey)}>{(Object.entries(reportNames) as [ReportKey, string][]).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</Select>
    <Card className="report-filter-card"><div className="report-filter-heading"><div><span className="eyebrow">FILTROS</span><h2>Período de análise</h2></div>{report === "stock" && <span className="report-snapshot">Estoque atual</span>}</div><div className="report-periods" role="group" aria-label="Período do relatório">{(Object.entries(periodLabels) as [Period, string][]).map(([key, label]) => <button type="button" key={key} aria-pressed={period === key} className={period === key ? "active" : ""} onClick={() => choosePeriod(key)}>{label}</button>)}</div>{period === "custom" && <div className="report-dates"><Input label="De" type="date" value={dates.fromDate} onChange={(event) => { setDates({ ...dates, fromDate: event.target.value }); setPage(0); }} /><Input label="Até" type="date" value={dates.toDate} onChange={(event) => { setDates({ ...dates, toDate: event.target.value }); setPage(0); }} /></div>}<p>{report === "stock" ? "O saldo de estoque é atual; as datas não alteram os números desta seção." : `De ${dateText(dates.fromDate || "—")} a ${dateText(dates.toDate || "—")} · Horário de São Paulo`}</p></Card>
    <div className="report-section-heading"><div><span className="eyebrow">{reportNames[report].toUpperCase()}</span><h2>{reportNames[report]}</h2><p>{config.description}</p></div><span>PDF · CSV · Excel: exportação futura</span></div>
    {!validDates ? <div className="sales-error" role="alert">Escolha um período válido de até 10 anos.</div> : query.isPending ? <LoadingState label="Preparando relatório..." /> : query.isError ? <ErrorState message={reportsError(query.error)} onRetry={() => void query.refetch()} /> : data ? <>
      <div className="report-summary">{config.summary.map((item) => <Card key={item.key}><span>{item.label}</span><strong>{item.kind === "money" ? money(Number(data.summary[item.key] ?? 0)) : quantity(Number(data.summary[item.key] ?? 0))}</strong></Card>)}</div>
      <Card className="report-note"><strong>Como ler este relatório</strong><p>{config.note}</p></Card>
      {data.rows.length ? <><div className="report-table-wrap"><table><thead><tr>{config.columns.map((column) => <th key={column.key} scope="col">{column.label}</th>)}</tr></thead><tbody>{data.rows.map((row, index) => <tr key={String(row.id ?? `${report}-${page}-${index}`)}>{config.columns.map((column) => <td key={column.key} data-label={column.label} className={column.kind === "money" && Number(row[column.key]) < 0 ? "cash-negative" : ""}>{formatCell(row[column.key], column, report, row)}</td>)}</tr>)}</tbody></table></div><div className="report-count">{data.total} registro{data.total === 1 ? "" : "s"} · exibindo {page * 25 + 1}–{Math.min((page + 1) * 25, data.total)}</div><FinancePagination total={data.total} page={page} pageSize={25} onPage={setPage} /></> : <EmptyState title="Nenhum resultado" description={report === "stock" ? "Ainda não há produtos ativos no estoque." : "Nenhum registro encontrado para este período."} />}
    </> : null}
  </div>;
}
