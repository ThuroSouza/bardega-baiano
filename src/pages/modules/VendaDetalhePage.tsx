import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Printer } from "lucide-react";
import { Link, useParams } from "react-router";
import { toast } from "sonner";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { ErrorState, LoadingState } from "../../components/ui/Feedback";
import { Modal } from "../../components/ui/Modal";
import { can } from "../../config/permissions";
import { getSaleDetail, paymentLabels } from "../../features/pdv/api";
import { formatMoney, priceCents } from "../../features/pdv/money";
import { getSaleContext, requestSaleCancellation, resolveSaleCancellation, saleStatusLabels, salesError } from "../../features/sales/api";
import type { SaleStatus } from "../../features/sales/api";
import { useAuth } from "../../hooks/useAuth";

type Action = "request" | "approve" | "reject" | null;
const dateTime = (value: string) => new Date(value).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });

export default function VendaDetalhePage() {
  const { id = "" } = useParams();
  const auth = useAuth();
  const mayCancel = Boolean(auth.profile && can(auth.permissions, "sales.cancel"));
  const queryClient = useQueryClient();
  const [action, setAction] = useState<Action>(null);
  const [reason, setReason] = useState("");
  const [actionError, setActionError] = useState("");
  const detail = useQuery({ queryKey: ["sale", id], queryFn: () => getSaleDetail(id), enabled: Boolean(id) });
  const context = useQuery({ queryKey: ["sale-context", id], queryFn: () => getSaleContext(id), enabled: Boolean(id) });
  const mutation = useMutation({
    mutationFn: async () => {
      if (action === "request") return requestSaleCancellation(id, reason);
      if ((action === "approve" || action === "reject") && context.data?.request) {
        return resolveSaleCancellation(context.data.request.id, action === "approve", reason);
      }
      throw new Error("Escolha uma ação válida.");
    },
    onSuccess: () => {
      const message = action === "request" ? "Cancelamento solicitado." : action === "approve" ? "Venda cancelada e lançamentos corrigidos." : "Solicitação recusada.";
      setAction(null); setReason(""); setActionError(""); toast.success(message);
      void queryClient.invalidateQueries({ queryKey: ["sale", id] });
      void queryClient.invalidateQueries({ queryKey: ["sale-context", id] });
      void queryClient.invalidateQueries({ queryKey: ["sales"] });
      void queryClient.invalidateQueries({ queryKey: ["stock"] });
      void queryClient.invalidateQueries({ queryKey: ["cash-session"] });
      void queryClient.invalidateQueries({ queryKey: ["cash-history"] });
    },
    onError: (error) => setActionError(salesError(error)),
  });
  function openAction(next: Action) { setAction(next); setReason(""); setActionError(""); }
  if (detail.isPending || context.isPending) return <LoadingState label="Carregando venda..." />;
  if (detail.isError || context.isError) return <ErrorState message={salesError(detail.error ?? context.error)} onRetry={() => { void detail.refetch(); void context.refetch(); }} />;
  const { sale, items, payments, components } = detail.data;
  const info = context.data;
  const request = info.request;
  const pending = request?.status === "PENDENTE";
  const reasonValid = action === "request" ? reason.trim().length >= 10 && reason.trim().length <= 500
    : action === "reject" ? reason.trim().length >= 3 : true;
  return <div className="page-stack sale-receipt-page">
    <Link to="/vendas" className="back-link"><ArrowLeft size={17} /> Voltar às vendas</Link>
    <div className="page-heading"><div><div className="eyebrow">OPERAÇÃO · VENDA</div><h1>Venda #{sale.sale_number}</h1><p>Registrada em {dateTime(sale.created_at)}</p></div><div className="sale-heading-actions"><Badge tone={sale.status === "CONCLUIDA" ? "success" : sale.status === "CANCELADA" ? "danger" : "amber"}>{saleStatusLabels[sale.status as SaleStatus]}</Badge><Button variant="secondary" className="sale-print" onClick={() => window.print()}><Printer size={16} /> Imprimir</Button></div></div>
    <Card className="sale-metadata"><div><span>Operador</span><strong>{info.operator_name}</strong></div><div><span>Data e hora</span><strong>{dateTime(sale.created_at)}</strong></div><div><span>Caixa · lançamento líquido</span><strong>{formatMoney(priceCents(info.cash_net))}</strong></div><div><span>Sessão de caixa</span><strong>{info.cash_session_number ? `Caixa #${info.cash_session_number}` : "Venda anterior às sessões"}</strong></div></Card>
    <Card className="sale-receipt"><div className="sale-receipt-head"><strong>Bardega do Baiano</strong><span>Comprovante da venda #{sale.sale_number}</span><small>{dateTime(sale.created_at)} · {info.operator_name}</small></div>
      <div className="sale-receipt-items">{items.map((item) => <div key={item.id}><div><strong>{item.product_name}</strong><small>{new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 }).format(item.quantity)} {item.unit} × {formatMoney(priceCents(item.unit_price))}</small>{item.discount_amount > 0 && <small>Desconto: {formatMoney(priceCents(item.discount_amount))}</small>}</div><div className="sale-line-values"><small>Subtotal {formatMoney(priceCents(item.gross_subtotal))}</small><strong>{formatMoney(priceCents(item.net_subtotal))}</strong></div></div>)}</div>
      <div className="sale-receipt-totals"><div><span>Subtotal</span><strong>{formatMoney(priceCents(sale.subtotal))}</strong></div>{sale.discount_amount > 0 && <div><span>Desconto</span><strong>− {formatMoney(priceCents(sale.discount_amount))}</strong></div>}<div className="sale-receipt-total"><span>Total</span><strong>{formatMoney(priceCents(sale.total))}</strong></div></div>
      <div className="sale-receipt-payments"><h2>Pagamento</h2>{payments.map((payment) => <div key={payment.id}><span>{paymentLabels[payment.method]}</span><strong>{formatMoney(priceCents(payment.amount))}</strong></div>)}</div>
      {sale.discount_amount > 0 && sale.discount_reason && <p className="sale-receipt-note">Motivo do desconto: {sale.discount_reason}</p>}
    </Card>
    {components.length > 0 && <Card className="sale-management sale-components"><h2>Consumo de ingredientes</h2><p>Composição registrada na finalização. O cancelamento devolve estas quantidades, mesmo se a ficha técnica mudar depois.</p>
      {items.filter((item) => components.some((part) => part.sale_item_id === item.id)).map((item) => <div className="sale-component-group" key={item.id}><strong>{item.product_name} · {item.quantity} {item.unit}</strong><ul>{components.filter((part) => part.sale_item_id === item.id).map((part) => <li key={part.ingredient_id}>{part.ingredient_name}: {new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 }).format(part.quantity)} {part.unit}</li>)}</ul></div>)}
    </Card>}
    {sale.status === "CANCELADA" && <Card className="sale-management"><h2>Venda cancelada</h2><p>Cancelada em {info.cancelled_at ? dateTime(info.cancelled_at) : "—"}. Motivo: {info.cancellation_reason}</p><p>Estoque devolvido. Lançamentos internos de caixa e financeiro corrigidos.</p></Card>}
    {sale.status === "CONCLUIDA" && <Card className="sale-management"><div className="sale-management-heading"><div><h2>Cancelamento</h2><p>O caixa pode solicitar. Gerente ou administrador decide.</p></div>{!pending && <Button variant="secondary" onClick={() => openAction("request")}>Solicitar cancelamento</Button>}</div>
      {pending && <div className="sale-request"><Badge tone="amber">Aguardando decisão</Badge><p><strong>Motivo:</strong> {request.reason}</p><small>Solicitado por {request.requested_by_name} em {dateTime(request.requested_at)}</small>{mayCancel && <div className="sale-request-actions"><Button variant="secondary" onClick={() => openAction("reject")}>Recusar</Button><Button variant="danger" onClick={() => openAction("approve")}>Confirmar cancelamento</Button></div>}</div>}
      {!pending && request?.status === "REJEITADA" && <p className="sale-previous-decision">Solicitação anterior recusada: {request.decision_reason}. Uma nova solicitação pode ser feita.</p>}
    </Card>}
    <Modal title={action === "request" ? "Solicitar cancelamento" : action === "approve" ? "Confirmar cancelamento" : "Recusar solicitação"} description={action === "request" ? "Explique por que a venda deve ser cancelada." : action === "approve" ? "A venda será marcada como cancelada; estoque, caixa e financeiro serão corrigidos juntos." : "Informe por que a solicitação foi recusada."} open={action !== null} onOpenChange={(open) => { if (!open && !mutation.isPending) openAction(null); }}>
      {action === "approve" && <p className="sale-external-note">Pagamentos PIX e cartão precisam de devolução efetiva fora deste sistema. Esta confirmação ajusta os registros internos.</p>}
      <div className="field"><label htmlFor="sale-action-reason">{action === "request" ? "Motivo da solicitação" : action === "reject" ? "Motivo da recusa" : "Observação da aprovação (opcional)"}</label><textarea id="sale-action-reason" maxLength={500} rows={4} value={reason} onChange={(event) => { setReason(event.target.value); setActionError(""); }} /></div>
      {actionError && <div className="sales-error" role="alert">{actionError}</div>}
      <div className="dialog-actions"><Button variant="secondary" disabled={mutation.isPending} onClick={() => openAction(null)}>Voltar</Button><Button variant={action === "approve" ? "danger" : "primary"} disabled={!reasonValid || mutation.isPending} onClick={() => mutation.mutate()}>{mutation.isPending ? "Processando..." : action === "request" ? "Enviar solicitação" : action === "approve" ? "Confirmar cancelamento" : "Recusar solicitação"}</Button></div>
    </Modal>
  </div>;
}
