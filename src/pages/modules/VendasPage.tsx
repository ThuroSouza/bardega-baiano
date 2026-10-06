import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import { Link } from "react-router";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { EmptyState, ErrorState, LoadingState } from "../../components/ui/Feedback";
import { Input } from "../../components/ui/Input";
import { Select } from "../../components/ui/Select";
import { paymentLabels } from "../../features/pdv/api";
import { formatMoney, priceCents } from "../../features/pdv/money";
import { listSaleOperators, listSales, saleStatusLabels, salesError } from "../../features/sales/api";
import type { SaleStatus } from "../../features/sales/api";

type Period = "today" | "yesterday" | "7days" | "30days" | "custom";
const pageSize = 30;
function saoPauloDate() {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const part = (name: string) => parts.find((item) => item.type === name)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}
function shiftDate(date: string, days: number) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
function rangeFor(period: Exclude<Period, "custom">) {
  const today = saoPauloDate();
  if (period === "today") return { fromDate: today, toDate: today };
  if (period === "yesterday") return { fromDate: shiftDate(today, -1), toDate: shiftDate(today, -1) };
  return { fromDate: shiftDate(today, period === "7days" ? -6 : -29), toDate: today };
}
function saleDate(value: string) {
  return new Date(value).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });
}

export default function VendasPage() {
  const [period, setPeriod] = useState<Period>("30days");
  const [dates, setDates] = useState(() => rangeFor("30days"));
  const [operatorId, setOperatorId] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(0);
  const validDates = Boolean(dates.fromDate && dates.toDate && dates.fromDate <= dates.toDate);
  const filters = { ...dates, operatorId, paymentMethod, status, page, pageSize };
  const sales = useQuery({ queryKey: ["sales", filters], queryFn: () => listSales(filters), enabled: validDates });
  const operators = useQuery({ queryKey: ["sale-operators"], queryFn: listSaleOperators });
  function selectPeriod(next: Period) {
    setPeriod(next);
    if (next !== "custom") setDates(rangeFor(next));
    setPage(0);
  }
  const rows = sales.data?.rows ?? [];
  const total = sales.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  return <div className="page-stack">
    <div className="page-heading"><div><div className="eyebrow">OPERAÇÃO</div><h1>Vendas</h1><p>Histórico, pagamentos e solicitações de cancelamento.</p></div><Button asChild><Link to="/pdv">Nova venda <ArrowRight size={16} /></Link></Button></div>
    <div className="sales-period" role="group" aria-label="Período das vendas">{([
      ["today", "Hoje"], ["yesterday", "Ontem"], ["7days", "7 dias"], ["30days", "30 dias"], ["custom", "Personalizado"],
    ] as const).map(([value, label]) => <button key={value} type="button" className={period === value ? "active" : ""} aria-pressed={period === value} onClick={() => selectPeriod(value)}>{label}</button>)}</div>
    <div className="sales-filters">
      {period === "custom" && <><Input label="De" type="date" value={dates.fromDate} onChange={(event) => { setDates({ ...dates, fromDate: event.target.value }); setPage(0); }} /><Input label="Até" type="date" value={dates.toDate} onChange={(event) => { setDates({ ...dates, toDate: event.target.value }); setPage(0); }} /></>}
      <Select label="Operador" value={operatorId} onChange={(event) => { setOperatorId(event.target.value); setPage(0); }}><option value="">Todos</option>{operators.data?.map((operator) => <option key={operator.id} value={operator.id}>{operator.display_name}</option>)}</Select>
      <Select label="Pagamento" value={paymentMethod} onChange={(event) => { setPaymentMethod(event.target.value); setPage(0); }}><option value="">Todos</option>{Object.entries(paymentLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select>
      <Select label="Status" value={status} onChange={(event) => { setStatus(event.target.value); setPage(0); }}><option value="">Todos</option>{Object.entries(saleStatusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select>
    </div>
    {!validDates ? <div className="sales-error" role="alert">Escolha um período válido.</div> : sales.isPending || operators.isPending ? <LoadingState label="Carregando vendas..." /> : sales.isError || operators.isError ? <ErrorState message={salesError(sales.error ?? operators.error)} onRetry={() => { void sales.refetch(); void operators.refetch(); }} /> : rows.length === 0 ? <EmptyState title="Nenhuma venda neste período" description="Ajuste os filtros ou registre uma nova venda no PDV." /> : <>
      <div className="sales-list-header"><span>Venda / data</span><span>Operador</span><span>Itens</span><span>Pagamento</span><span>Valor</span><span>Status</span><span></span></div>
      <div className="sales-list">{rows.map((sale) => <Link to={`/vendas/${sale.id}`} className="sales-row" key={sale.id} aria-label={`Abrir venda ${sale.sale_number}`}><div className="sales-row-title"><strong>#{sale.sale_number}</strong><small>{saleDate(sale.created_at)}</small></div><div className="sales-row-operator">{sale.operator_name}</div><div className="sales-row-items">{sale.item_count} {sale.item_count === 1 ? "item" : "itens"}</div><div className="sales-row-payment">{sale.payment_methods.map((method) => paymentLabels[method] ?? method).join(" + ") || "—"}</div><strong className="sales-row-total">{formatMoney(priceCents(sale.total))}</strong><Badge tone={sale.status === "CONCLUIDA" ? "success" : sale.status === "CANCELADA" ? "danger" : "amber"}>{saleStatusLabels[sale.status as SaleStatus]}</Badge><ArrowRight size={16} className="sales-row-arrow" /></Link>)}</div>
      <div className="sales-footer"><span>{total} venda{total === 1 ? "" : "s"} encontrada{total === 1 ? "" : "s"}</span><div><Button variant="secondary" disabled={page === 0} onClick={() => setPage(page - 1)}>Anterior</Button><span>Página {page + 1} de {totalPages}</span><Button variant="secondary" disabled={page + 1 >= totalPages} onClick={() => setPage(page + 1)}>Próxima</Button></div></div>
    </>}
  </div>;
}
