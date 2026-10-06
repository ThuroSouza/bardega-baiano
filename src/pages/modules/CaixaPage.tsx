import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDownLeft, ArrowUpRight, LockKeyhole, Plus, Wallet } from "lucide-react";
import { Link, useSearchParams } from "react-router";
import { toast } from "sonner";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { EmptyState, ErrorState, LoadingState } from "../../components/ui/Feedback";
import { Input } from "../../components/ui/Input";
import { Modal } from "../../components/ui/Modal";
import { can } from "../../config/permissions";
import { addCashAdjustment, cashError, closeCashSession, getCashSession, getMyOpenCashSession, listCashSessions, openCashSession } from "../../features/cash/api";
import type { CashMovement } from "../../features/cash/api";
import { paymentLabels } from "../../features/pdv/api";
import { formatMoney, moneyDecimal, parseMoneyCents, priceCents } from "../../features/pdv/money";
import { useAuth } from "../../hooks/useAuth";

type Action = "open" | "supply" | "withdrawal" | "close" | null;
const fmt = (value: number) => formatMoney(priceCents(value));
const dateTime = (value: string) => new Date(value).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
const movementLabels: Record<CashMovement["kind"], string> = {
  OPENING: "Abertura", SALE_PAYMENT: "Venda", SALE_REVERSAL: "Cancelamento",
  SUPPLY: "Suprimento", WITHDRAWAL: "Sangria",
};

export default function CaixaPage() {
  const auth = useAuth();
  const profile = auth.profile!;
  const mayViewAll = can(auth.permissions, "cash.view_all");
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [historyPage, setHistoryPage] = useState(0);
  const [movementPage, setMovementPage] = useState(0);
  const [action, setAction] = useState<Action>(null);
  const [amount, setAmount] = useState("0");
  const [reason, setReason] = useState("");
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [actionError, setActionError] = useState("");
  const openSession = useQuery({ queryKey: ["cash-open", profile.id], queryFn: () => getMyOpenCashSession(profile.id) });
  const history = useQuery({ queryKey: ["cash-history", historyPage], queryFn: () => listCashSessions(20, historyPage * 20) });
  const selectedId = searchParams.get("session") || openSession.data?.id || history.data?.rows[0]?.id || "";
  const detail = useQuery({ queryKey: ["cash-session", selectedId, movementPage], queryFn: () => getCashSession(selectedId, 50, movementPage * 50), enabled: Boolean(selectedId) });
  const selected = detail.data;
  const canOperate = Boolean(selected?.session.status === "ABERTO" && (selected.session.opened_by === profile.id || mayViewAll));
  const cents = parseMoneyCents(amount);
  const validAmount = cents !== null && cents >= 0n && cents <= 99999999999999n;
  const actionIssue = !validAmount ? "Informe um valor válido com até duas casas decimais."
    : (action === "supply" || action === "withdrawal") && cents === 0n ? "O valor precisa ser maior que zero."
    : (action === "supply" || action === "withdrawal") && reason.trim().length < 3 ? "Informe um motivo com pelo menos 3 caracteres."
    : "";
  const difference = selected && cents !== null ? cents - priceCents(selected.summary.expected_cash) : null;
  function openAction(next: Action) {
    setAction(next); setAmount(next === "close" ? String(selected?.summary.expected_cash ?? 0) : "0");
    setReason(""); setRequestId(crypto.randomUUID()); setActionError("");
  }
  const mutation = useMutation({
    mutationFn: async () => {
      if (action === "open") return openCashSession(requestId, moneyDecimal(cents!));
      if (!selectedId) throw new Error("Caixa não selecionado.");
      if (action === "supply" || action === "withdrawal") return addCashAdjustment({
        sessionId: selectedId, requestId, kind: action === "supply" ? "SUPPLY" : "WITHDRAWAL",
        amount: moneyDecimal(cents!), reason,
      });
      if (action === "close") return closeCashSession(selectedId, moneyDecimal(cents!), reason);
      throw new Error("Escolha uma operação.");
    },
    onSuccess: (result) => {
      const done = action;
      setAction(null); setActionError(""); setMovementPage(0); setHistoryPage(0);
      if (done === "open") setSearchParams({ session: result.id });
      void queryClient.invalidateQueries({ queryKey: ["cash-open"] });
      void queryClient.invalidateQueries({ queryKey: ["cash-history"] });
      void queryClient.invalidateQueries({ queryKey: ["cash-session"] });
      toast.success(done === "open" ? "Caixa aberto." : done === "close" ? "Caixa fechado e conferência registrada." : done === "supply" ? "Suprimento registrado." : "Sangria registrada.");
    },
    onError: (error) => setActionError(cashError(error)),
  });
  const rows = history.data?.rows ?? [];
  const totalHistory = history.data?.total ?? 0;
  const totalMovements = selected?.movement_count ?? 0;
  return <div className="page-stack">
    <div className="page-heading"><div><div className="eyebrow">OPERAÇÃO</div><h1>Caixa</h1><p>Abertura, movimentos de dinheiro e conferência do fechamento.</p></div>{!openSession.isPending && !openSession.data && <Button onClick={() => openAction("open")}><Plus size={16} /> Abrir meu caixa</Button>}</div>
    {openSession.isPending || history.isPending ? <LoadingState label="Carregando caixas..." /> : openSession.isError || history.isError ? <ErrorState message={cashError(openSession.error ?? history.error)} onRetry={() => { void openSession.refetch(); void history.refetch(); }} /> : <>
      {openSession.data && <Card className="cash-active-banner"><Wallet size={21} /><div><strong>Seu caixa #{openSession.data.session_number} está aberto</strong><span>Vendas e pagamentos serão vinculados a esta sessão.</span></div>{selectedId !== openSession.data.id && <Button variant="secondary" onClick={() => { setMovementPage(0); setSearchParams({ session: openSession.data!.id }); }}>Ver meu caixa</Button>}</Card>}
      {!openSession.data && <Card className="cash-active-banner cash-closed-banner"><LockKeyhole size={21} /><div><strong>Você não possui caixa aberto</strong><span>Abra um caixa para registrar novas vendas no PDV.</span></div></Card>}
      {selectedId && (detail.isPending ? <LoadingState label="Carregando conferência..." /> : detail.isError ? <ErrorState message={cashError(detail.error)} onRetry={() => void detail.refetch()} /> : selected && <>
        <div className="cash-section-heading"><div><div className="eyebrow">SESSÃO #{selected.session.session_number}</div><h2>Caixa de {selected.operator_name}</h2><p>Aberto em {dateTime(selected.session.opened_at)}{selected.session.closed_at ? ` · Fechado em ${dateTime(selected.session.closed_at)}` : ""}</p></div><Badge tone={selected.session.status === "ABERTO" ? "success" : "neutral"}>{selected.session.status === "ABERTO" ? "Aberto" : "Fechado"}</Badge></div>
        <div className="cash-summary-grid"><Card><span>Saldo inicial</span><strong>{fmt(selected.session.opening_amount)}</strong></Card><Card><span>Vendas em dinheiro</span><strong>{fmt(selected.summary.cash_sales)}</strong></Card><Card><span>PIX</span><strong>{fmt(selected.summary.pix_sales)}</strong></Card><Card><span>Débito</span><strong>{fmt(selected.summary.debit_sales)}</strong></Card><Card><span>Crédito</span><strong>{fmt(selected.summary.credit_sales)}</strong></Card><Card><span>Suprimentos</span><strong>{fmt(selected.summary.supplies)}</strong></Card><Card><span>Sangrias</span><strong>− {fmt(selected.summary.withdrawals)}</strong></Card><Card><span>Cancelamentos</span><strong>− {fmt(selected.summary.cancellations)}</strong></Card></div>
        <Card className="cash-reconciliation"><div><span>Saldo esperado em dinheiro</span><strong>{fmt(selected.summary.expected_cash)}</strong><small>Abertura + vendas em dinheiro + suprimentos − sangrias − devoluções em dinheiro</small></div>{selected.session.status === "FECHADO" && <><div><span>Saldo contado</span><strong>{fmt(selected.session.counted_amount ?? 0)}</strong></div><div><span>Diferença</span><strong className={(selected.session.difference_amount ?? 0) < 0 ? "cash-negative" : ""}>{fmt(selected.session.difference_amount ?? 0)}</strong></div></>}</Card>
        {selected.session.close_note && <p className="cash-close-note">Observação do fechamento: {selected.session.close_note}</p>}
        {canOperate && <div className="cash-actions"><Button variant="secondary" onClick={() => openAction("supply")}><ArrowDownLeft size={16} /> Suprimento</Button><Button variant="secondary" onClick={() => openAction("withdrawal")}><ArrowUpRight size={16} /> Sangria</Button><Button onClick={() => openAction("close")}><LockKeyhole size={16} /> Fechar caixa</Button></div>}
        <div className="cash-section-heading"><div><h2>Movimentações</h2><p>Registros da sessão, com operador, data e motivo.</p></div></div>
        {selected.movements.length ? <div className="cash-movements">{selected.movements.map((movement) => <Card key={movement.id} className="cash-movement"><div><strong>{movementLabels[movement.kind]}</strong><small>{dateTime(movement.created_at)} · {movement.user_name}</small><small>{movement.sale_id ? <Link to={`/vendas/${movement.sale_id}`}>Venda #{movement.sale_number}</Link> : movement.reason}{movement.kind.startsWith("SALE") ? ` · ${paymentLabels[movement.method]}` : ""}</small></div><strong className={movement.amount < 0 ? "cash-negative" : "cash-positive"}>{fmt(movement.amount)}</strong></Card>)}</div> : <EmptyState title="Sem movimentações" description="As operações desta sessão aparecerão aqui." />}
        {totalMovements > 50 && <div className="cash-pagination"><Button variant="secondary" disabled={movementPage === 0} onClick={() => setMovementPage(movementPage - 1)}>Anterior</Button><span>Página {movementPage + 1} de {Math.ceil(totalMovements / 50)}</span><Button variant="secondary" disabled={(movementPage + 1) * 50 >= totalMovements} onClick={() => setMovementPage(movementPage + 1)}>Próxima</Button></div>}
      </>)}
      <div className="cash-section-heading"><div><h2>Histórico de caixas</h2><p>Abertura, fechamento, vendas e diferença de cada sessão.</p></div></div>
      {rows.length ? <div className="cash-history">{rows.map((row) => <button type="button" key={row.id} className={`cash-history-row ${selectedId === row.id ? "active" : ""}`} onClick={() => { setMovementPage(0); setSearchParams({ session: row.id }); }}><span><strong>Caixa #{row.session_number}</strong><small>{row.operator_name} · {dateTime(row.opened_at)}</small></span><span><small>Abertura</small><strong>{fmt(row.opening_amount)}</strong></span><span><small>Fechamento</small><strong>{row.closed_at ? dateTime(row.closed_at) : "Em aberto"}</strong></span><span><small>Vendas</small><strong>{row.sale_count}</strong></span><span><small>Diferença</small><strong>{row.difference_amount === null ? "—" : fmt(row.difference_amount)}</strong></span><Badge tone={row.status === "ABERTO" ? "success" : "neutral"}>{row.status === "ABERTO" ? "Aberto" : "Fechado"}</Badge></button>)}</div> : <EmptyState title="Nenhum caixa registrado" description="Abra o primeiro caixa para começar." />}
      {totalHistory > 20 && <div className="cash-pagination"><Button variant="secondary" disabled={historyPage === 0} onClick={() => setHistoryPage(historyPage - 1)}>Anterior</Button><span>Página {historyPage + 1} de {Math.ceil(totalHistory / 20)}</span><Button variant="secondary" disabled={(historyPage + 1) * 20 >= totalHistory} onClick={() => setHistoryPage(historyPage + 1)}>Próxima</Button></div>}
    </>}
    <Modal title={action === "open" ? "Abrir caixa" : action === "close" ? "Fechar caixa" : action === "supply" ? "Registrar suprimento" : "Registrar sangria"} description={action === "open" ? "Informe o dinheiro inicial. O horário e o operador são registrados automaticamente." : action === "close" ? "Conte o dinheiro físico na gaveta. O sistema registra a diferença." : action === "supply" ? "Registre uma entrada manual de dinheiro." : "Registre uma retirada de dinheiro do caixa."} open={action !== null} onOpenChange={(open) => { if (!open && !mutation.isPending) openAction(null); }}>
      <div className="cash-modal-body"><Input label={action === "close" ? "Saldo contado (R$)" : action === "open" ? "Valor inicial (R$)" : "Valor (R$)"} inputMode="decimal" autoFocus value={amount} onChange={(event) => { setAmount(event.target.value); setRequestId(crypto.randomUUID()); setActionError(""); }} />
        {action !== "open" && <div className="field"><label htmlFor="cash-operation-reason">{action === "close" ? "Observação (opcional)" : "Motivo"}</label><textarea id="cash-operation-reason" rows={3} maxLength={500} value={reason} onChange={(event) => { setReason(event.target.value); setRequestId(crypto.randomUUID()); setActionError(""); }} /></div>}
        {action === "close" && selected && <div className="cash-close-preview"><div><span>Esperado</span><strong>{fmt(selected.summary.expected_cash)}</strong></div><div><span>Diferença</span><strong>{difference === null ? "—" : formatMoney(difference)}</strong></div></div>}
        {actionIssue && <p className="cash-form-error" role="status">{actionIssue}</p>}{actionError && <p className="cash-form-error" role="alert">{actionError}</p>}</div>
      <div className="dialog-actions"><Button variant="secondary" disabled={mutation.isPending} onClick={() => openAction(null)}>Voltar</Button><Button disabled={Boolean(actionIssue) || mutation.isPending} onClick={() => mutation.mutate()}>{mutation.isPending ? "Registrando..." : action === "open" ? "Abrir caixa" : action === "close" ? "Confirmar fechamento" : action === "supply" ? "Registrar suprimento" : "Registrar sangria"}</Button></div>
    </Modal>
  </div>;
}
