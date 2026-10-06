import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { EmptyState, ErrorState, LoadingState } from "../../components/ui/Feedback";
import { Input } from "../../components/ui/Input";
import { Modal } from "../../components/ui/Modal";
import { Select } from "../../components/ui/Select";
import { formatMoney, moneyDecimal, parseMoneyCents, priceCents } from "../pdv/money";
import { cancelExpense, cancelReceivable, createExpense, createReceivable, effectiveExpenseStatus, effectiveReceivableStatus, expenseCategories, expenseStatusLabels, financeError, financeFilterLabels, financePaymentLabels, listExpenses, listReceivables, localToday, receivableStatusLabels, settleExpense, settleReceivable } from "./api";
import type { ExpenseCategory, FinanceFilter, FinancePaymentMethod, FinancialExpense, FinancialReceivable } from "./api";
import { FinanceNav } from "./FinanceNav";
import { FinancePagination } from "./FinancePagination";

type Kind = "expense" | "receivable";
type Action = "create" | "settle" | "cancel" | null;
const pageSize = 25;
const amountText = (value: number) => formatMoney(priceCents(value));
const dateText = (value: string) => value.split("-").reverse().join("/");
const dateTime = (value: string) => new Date(value).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });

export function FinanceRecordPage({ kind, section }: { kind: Kind; section: "records" | "payables" }) {
  const expense = kind === "expense";
  const title = expense ? section === "payables" ? "Contas a pagar" : "Despesas" : "Contas a receber";
  const [filter, setFilter] = useState<FinanceFilter>(section === "payables" ? "open" : "all");
  const [page, setPage] = useState(0);
  const [action, setAction] = useState<Action>(null);
  const [selected, setSelected] = useState<FinancialExpense | FinancialReceivable | null>(null);
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<ExpenseCategory>("FORNECEDOR");
  const [counterparty, setCounterparty] = useState("");
  const [amount, setAmount] = useState("");
  const [dueOn, setDueOn] = useState(localToday());
  const [notes, setNotes] = useState("");
  const [settledOn, setSettledOn] = useState(localToday());
  const [method, setMethod] = useState<FinancePaymentMethod>("PIX");
  const [actionError, setActionError] = useState("");
  const queryClient = useQueryClient();
  const rows = useQuery({
    queryKey: [expense ? "finance-expenses" : "finance-receivables", filter, page],
    queryFn: async (): Promise<{ rows: (FinancialExpense | FinancialReceivable)[]; total: number }> =>
      expense ? await listExpenses(filter, page, pageSize) : await listReceivables(filter, page, pageSize),
  });
  const entries = rows.data?.rows ?? [];
  const total = rows.data?.total ?? 0;
  const cents = parseMoneyCents(amount);
  const validAmount = cents !== null && cents > 0n && cents <= 99999999999999n;
  const createIssue = description.trim().length < 3 ? "Informe uma descrição com pelo menos 3 caracteres."
    : !validAmount ? "Informe um valor maior que zero com até duas casas decimais."
    : !dueOn ? "Informe o vencimento." : "";
  const settleIssue = !settledOn ? "Informe a data da baixa." : settledOn > localToday() ? "A data da baixa não pode ser futura." : "";
  function startCreate() {
    setSelected(null); setAction("create"); setActionError(""); setRequestId(crypto.randomUUID());
    setDescription(""); setCategory("FORNECEDOR"); setCounterparty(""); setAmount("");
    setDueOn(localToday()); setNotes("");
  }
  function startAction(next: "settle" | "cancel", row: FinancialExpense | FinancialReceivable) {
    setSelected(row); setAction(next); setActionError(""); setSettledOn(localToday()); setMethod("PIX");
  }
  const mutation = useMutation({
    mutationFn: async () => {
      if (action === "create") {
        const base = { requestId, description, amount: moneyDecimal(cents!), dueOn, notes };
        return expense ? createExpense({ ...base, category, supplierName: counterparty })
          : createReceivable({ ...base, payerName: counterparty });
      }
      if (!selected) throw new Error("Selecione um registro.");
      if (action === "settle") return expense ? settleExpense(selected.id, settledOn, method)
        : settleReceivable(selected.id, settledOn, method);
      if (action === "cancel") return expense ? cancelExpense(selected.id) : cancelReceivable(selected.id);
      throw new Error("Selecione uma operação.");
    },
    onSuccess: () => {
      const done = action;
      setAction(null); setActionError(""); setPage(0);
      void queryClient.invalidateQueries({ queryKey: ["finance-expenses"] });
      void queryClient.invalidateQueries({ queryKey: ["finance-receivables"] });
      void queryClient.invalidateQueries({ queryKey: ["finance-revenues"] });
      void queryClient.invalidateQueries({ queryKey: ["finance-alerts"] });
      toast.success(done === "create" ? "Registro criado." : done === "settle" ? expense ? "Pagamento registrado." : "Recebimento registrado." : "Registro cancelado.");
    },
    onError: (error) => setActionError(financeError(error)),
  });
  return <div className="page-stack">
    <div className="page-heading"><div><div className="eyebrow">FINANCEIRO</div><h1>{title}</h1><p>{expense ? "Vencimentos, pagamentos e despesas da operação." : "Valores futuros e recebimentos fora do PDV."}</p></div><Button onClick={startCreate}><Plus size={16} /> {expense ? "Nova despesa" : "Nova conta"}</Button></div>
    <FinanceNav />
    <div className="finance-filters" role="group" aria-label="Filtrar registros">{(Object.entries(financeFilterLabels) as [FinanceFilter, string][]).map(([value, label]) => <button type="button" key={value} className={filter === value ? "active" : ""} aria-pressed={filter === value} onClick={() => { setFilter(value); setPage(0); }}>{label}</button>)}</div>
    {rows.isPending ? <LoadingState label="Carregando financeiro..." /> : rows.isError ? <ErrorState message={financeError(rows.error)} onRetry={() => void rows.refetch()} /> : entries.length === 0 ? <EmptyState title="Nenhum registro neste filtro" description="Cadastre um lançamento ou escolha outro status." /> : <>
      <div className="finance-records">{entries.map((row) => {
        const status = expense ? effectiveExpenseStatus(row as FinancialExpense) : effectiveReceivableStatus(row as FinancialReceivable);
        const done = row.status === (expense ? "PAGA" : "RECEBIDA");
        return <Card key={row.id} className="finance-record"><div className="finance-record-main"><div><strong>{row.description}</strong><small>{expense ? expenseCategories[(row as FinancialExpense).category] : "A receber"}{expense ? (row as FinancialExpense).supplier_name ? ` · ${(row as FinancialExpense).supplier_name}` : "" : (row as FinancialReceivable).payer_name ? ` · ${(row as FinancialReceivable).payer_name}` : ""}</small><small>Criado em {dateTime(row.created_at)} · Vence em {dateText(row.due_on)}</small>{done && <small>{expense ? "Pago" : "Recebido"} em {dateText(expense ? (row as FinancialExpense).paid_on! : (row as FinancialReceivable).received_on!)} · {financePaymentLabels[row.payment_method!]}</small>}{row.notes && <small>Observação: {row.notes}</small>}</div><div className="finance-record-value"><strong>{amountText(row.amount)}</strong><Badge tone={status === "ATRASADA" ? "danger" : done ? "success" : status === "CANCELADA" ? "neutral" : "amber"}>{expense ? expenseStatusLabels[status as keyof typeof expenseStatusLabels] : receivableStatusLabels[status as keyof typeof receivableStatusLabels]}</Badge></div></div>{row.status === "PENDENTE" && <div className="finance-record-actions"><Button variant="secondary" onClick={() => startAction("settle", row)}>{expense ? "Registrar pagamento" : "Registrar recebimento"}</Button><Button variant="ghost" onClick={() => startAction("cancel", row)}>Cancelar</Button></div>}</Card>;
      })}</div>
      <FinancePagination total={total} page={page} pageSize={pageSize} onPage={setPage} />
    </>}
    <Modal title={action === "create" ? expense ? "Nova despesa" : "Nova conta a receber" : action === "settle" ? expense ? "Registrar pagamento" : "Registrar recebimento" : "Cancelar registro"} description={action === "cancel" ? "O registro permanecerá no histórico com status cancelado." : undefined} open={action !== null} onOpenChange={(open) => { if (!open && !mutation.isPending) setAction(null); }}>
      <div className="cash-modal-body">{action === "create" && <>
        <Input label="Descrição" maxLength={200} autoFocus value={description} onChange={(event) => { setDescription(event.target.value); setRequestId(crypto.randomUUID()); setActionError(""); }} />
        {expense && <Select label="Categoria" value={category} onChange={(event) => { setCategory(event.target.value as ExpenseCategory); setRequestId(crypto.randomUUID()); }}>{Object.entries(expenseCategories).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</Select>}
        <Input label={expense ? "Fornecedor (opcional)" : "Cliente / origem (opcional)"} maxLength={160} value={counterparty} onChange={(event) => { setCounterparty(event.target.value); setRequestId(crypto.randomUUID()); }} />
        <div className="finance-form-row"><Input label="Valor (R$)" inputMode="decimal" value={amount} onChange={(event) => { setAmount(event.target.value); setRequestId(crypto.randomUUID()); setActionError(""); }} /><Input label="Vencimento" type="date" value={dueOn} onChange={(event) => { setDueOn(event.target.value); setRequestId(crypto.randomUUID()); }} /></div>
        <div className="field"><label htmlFor="finance-create-notes">Observação (opcional)</label><textarea id="finance-create-notes" maxLength={500} rows={3} value={notes} onChange={(event) => { setNotes(event.target.value); setRequestId(crypto.randomUUID()); }} /></div>
        {createIssue && <p className="cash-form-error" role="status">{createIssue}</p>}
      </>}{action === "settle" && selected && <><p className="finance-modal-summary">{selected.description} · {amountText(selected.amount)}</p><div className="finance-form-row"><Input label={expense ? "Data do pagamento" : "Data do recebimento"} type="date" value={settledOn} onChange={(event) => setSettledOn(event.target.value)} /><Select label="Forma de pagamento" value={method} onChange={(event) => setMethod(event.target.value as FinancePaymentMethod)}>{Object.entries(financePaymentLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select></div></>}
      {action === "settle" && settleIssue && <p className="cash-form-error" role="status">{settleIssue}</p>}
      {action === "cancel" && selected && <p className="finance-modal-summary">{selected.description} · {amountText(selected.amount)}</p>}
      {actionError && <p className="cash-form-error" role="alert">{actionError}</p>}</div>
      <div className="dialog-actions"><Button variant="secondary" disabled={mutation.isPending} onClick={() => setAction(null)}>Voltar</Button><Button variant={action === "cancel" ? "danger" : "primary"} disabled={mutation.isPending || action === "create" && Boolean(createIssue) || action === "settle" && Boolean(settleIssue)} onClick={() => mutation.mutate()}>{mutation.isPending ? "Registrando..." : action === "create" ? "Criar registro" : action === "settle" ? "Confirmar baixa" : "Confirmar cancelamento"}</Button></div>
    </Modal>
  </div>;
}
