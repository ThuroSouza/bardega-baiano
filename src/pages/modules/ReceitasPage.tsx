import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { Link } from "react-router";
import { toast } from "sonner";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { EmptyState, ErrorState, LoadingState } from "../../components/ui/Feedback";
import { Input } from "../../components/ui/Input";
import { Modal } from "../../components/ui/Modal";
import { Select } from "../../components/ui/Select";
import { financeError, financePaymentLabels, listFinancialEntries, localToday, recordManualRevenue, reverseManualRevenue } from "../../features/finance/api";
import type { FinancePaymentMethod, FinancialEntry } from "../../features/finance/api";
import { FinanceNav } from "../../features/finance/FinanceNav";
import { FinancePagination } from "../../features/finance/FinancePagination";
import { formatMoney, moneyDecimal, parseMoneyCents, priceCents } from "../../features/pdv/money";

const pageSize = 25;
const dateText = (value: string) => value.split("-").reverse().join("/");
export default function ReceitasPage() {
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState(false);
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [receivedOn, setReceivedOn] = useState(localToday());
  const [method, setMethod] = useState<FinancePaymentMethod>("PIX");
  const [notes, setNotes] = useState("");
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [actionError, setActionError] = useState("");
  const [reverseTarget, setReverseTarget] = useState<FinancialEntry | null>(null);
  const [reverseReason, setReverseReason] = useState("");
  const [reverseError, setReverseError] = useState("");
  const queryClient = useQueryClient();
  const revenues = useQuery({ queryKey: ["finance-revenues", page], queryFn: () => listFinancialEntries(page, pageSize) });
  const cents = parseMoneyCents(amount);
  const issue = description.trim().length < 3 ? "Informe uma descrição com pelo menos 3 caracteres."
    : cents === null || cents <= 0n || cents > 99999999999999n ? "Informe um valor válido maior que zero."
    : !receivedOn ? "Informe a data de recebimento."
    : receivedOn > localToday() ? "A data de recebimento não pode ser futura." : "";
  const mutation = useMutation({
    mutationFn: () => recordManualRevenue({ requestId, description, amount: moneyDecimal(cents!), receivedOn, method, notes }),
    onSuccess: () => {
      setOpen(false); setActionError(""); setPage(0);
      void queryClient.invalidateQueries({ queryKey: ["finance-revenues"] });
      toast.success("Receita registrada.");
    },
    onError: (error) => setActionError(financeError(error)),
  });
  const reversal = useMutation({
    mutationFn: () => reverseManualRevenue(reverseTarget!.id, reverseReason),
    onSuccess: () => {
      setReverseTarget(null); setReverseError(""); setPage(0);
      void queryClient.invalidateQueries({ queryKey: ["finance-revenues"] });
      toast.success("Estorno registrado.");
    },
    onError: (error) => setReverseError(financeError(error)),
  });
  function start() {
    setDescription(""); setAmount(""); setReceivedOn(localToday()); setMethod("PIX");
    setNotes(""); setRequestId(crypto.randomUUID()); setActionError(""); setOpen(true);
  }
  const rows = revenues.data?.rows ?? [];
  return <div className="page-stack">
    <div className="page-heading"><div><div className="eyebrow">FINANCEIRO</div><h1>Receitas</h1><p>Vendas registradas automaticamente e outras entradas confirmadas.</p></div><Button onClick={start}><Plus size={16} /> Receita manual</Button></div>
    <FinanceNav />
    <Card className="finance-info">Vendas concluídas entram automaticamente. Cancelamentos aparecem como estorno. Valores a receber entram aqui quando a baixa é registrada.</Card>
    {revenues.isPending ? <LoadingState label="Carregando receitas..." /> : revenues.isError ? <ErrorState message={financeError(revenues.error)} onRetry={() => void revenues.refetch()} /> : rows.length === 0 ? <EmptyState title="Nenhuma receita registrada" description="Faça uma venda ou lance uma receita manual." /> : <>
      <div className="finance-records">{rows.map((entry) => <Card key={entry.id} className="finance-record finance-revenue-row"><div className="finance-record-main"><div><strong>{entry.sale_id ? entry.type === "ESTORNO" ? "Estorno de venda" : "Venda no PDV" : entry.description}</strong><small>{entry.sale_id ? <Link to={`/vendas/${entry.sale_id}`}>Abrir venda</Link> : entry.receivable_id ? "Conta a receber baixada" : entry.source_entry_id ? "Correção de receita manual" : "Receita manual"} · {dateText(entry.received_on)}</small>{entry.payment_method && <small>{financePaymentLabels[entry.payment_method]}</small>}{entry.notes && <small>Observação: {entry.notes}</small>}</div><div className="finance-record-value"><strong className={entry.amount < 0 ? "cash-negative" : "cash-positive"}>{formatMoney(priceCents(entry.amount))}</strong><Badge tone={entry.amount < 0 ? "danger" : entry.reversed_at ? "neutral" : "success"}>{entry.amount < 0 ? "Estorno" : entry.reversed_at ? "Estornada" : "Confirmada"}</Badge></div></div>{entry.type === "RECEITA_MANUAL" && !entry.receivable_id && !entry.reversed_at && <div className="finance-record-actions"><Button variant="ghost" onClick={() => { setReverseTarget(entry); setReverseReason(""); setReverseError(""); }}>Estornar receita</Button></div>}</Card>)}</div>
      <FinancePagination total={revenues.data?.total ?? 0} page={page} pageSize={pageSize} onPage={setPage} />
    </>}
    <Modal title="Registrar receita manual" description="Use para entradas confirmadas fora do PDV. Valores futuros devem ser cadastrados em Contas a receber." open={open} onOpenChange={(value) => { if (!value && !mutation.isPending) setOpen(false); }}>
      <div className="cash-modal-body"><Input label="Descrição" autoFocus maxLength={200} value={description} onChange={(event) => { setDescription(event.target.value); setRequestId(crypto.randomUUID()); setActionError(""); }} /><div className="finance-form-row"><Input label="Valor (R$)" inputMode="decimal" value={amount} onChange={(event) => { setAmount(event.target.value); setRequestId(crypto.randomUUID()); setActionError(""); }} /><Input label="Data do recebimento" type="date" value={receivedOn} onChange={(event) => { setReceivedOn(event.target.value); setRequestId(crypto.randomUUID()); }} /></div><Select label="Forma de pagamento" value={method} onChange={(event) => { setMethod(event.target.value as FinancePaymentMethod); setRequestId(crypto.randomUUID()); }}>{Object.entries(financePaymentLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select><div className="field"><label htmlFor="finance-revenue-notes">Observação (opcional)</label><textarea id="finance-revenue-notes" maxLength={500} rows={3} value={notes} onChange={(event) => { setNotes(event.target.value); setRequestId(crypto.randomUUID()); }} /></div>{issue && <p className="cash-form-error" role="status">{issue}</p>}{actionError && <p className="cash-form-error" role="alert">{actionError}</p>}</div>
      <div className="dialog-actions"><Button variant="secondary" disabled={mutation.isPending} onClick={() => setOpen(false)}>Voltar</Button><Button disabled={mutation.isPending || Boolean(issue)} onClick={() => mutation.mutate()}>{mutation.isPending ? "Registrando..." : "Registrar receita"}</Button></div>
    </Modal>
    <Modal title="Estornar receita manual" description="Uma entrada negativa corrigirá a receita sem apagar o lançamento original." open={reverseTarget !== null} onOpenChange={(value) => { if (!value && !reversal.isPending) setReverseTarget(null); }}>
      <div className="cash-modal-body"><p className="finance-modal-summary">{reverseTarget?.description} · {reverseTarget ? formatMoney(priceCents(reverseTarget.amount)) : ""}</p><div className="field"><label htmlFor="finance-reversal-reason">Motivo do estorno</label><textarea id="finance-reversal-reason" maxLength={500} rows={3} value={reverseReason} onChange={(event) => { setReverseReason(event.target.value); setReverseError(""); }} /></div>{reverseError && <p className="cash-form-error" role="alert">{reverseError}</p>}</div>
      <div className="dialog-actions"><Button variant="secondary" disabled={reversal.isPending} onClick={() => setReverseTarget(null)}>Voltar</Button><Button variant="danger" disabled={reversal.isPending || reverseReason.trim().length < 3} onClick={() => reversal.mutate()}>{reversal.isPending ? "Registrando..." : "Confirmar estorno"}</Button></div>
    </Modal>
  </div>;
}
