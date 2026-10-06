import { requireSupabase } from "../../lib/supabase";
import type { PaymentMethod, Sale } from "../pdv/api";

export type SaleStatus = "CONCLUIDA" | "CANCELADA" | "ESTORNADA";
export const saleStatusLabels: Record<SaleStatus, string> = {
  CONCLUIDA: "Concluída", CANCELADA: "Cancelada", ESTORNADA: "Estornada",
};
export type SaleListRow = {
  id: string; sale_number: number; created_at: string; status: SaleStatus;
  operator_id: string; operator_name: string; item_count: number;
  payment_methods: PaymentMethod[]; total: number;
};
export type SaleOperator = { id: string; display_name: string };
export type CancellationRequest = {
  id: string; status: "PENDENTE" | "APROVADA" | "REJEITADA";
  reason: string; requested_by_name: string; requested_at: string;
  decision_reason: string; decided_at: string | null;
};
export type SaleContext = {
  operator_name: string; cash_net: number; financial_net: number;
  cash_session_number: number | null;
  request: CancellationRequest | null; cancelled_at: string | null;
  cancellation_reason: string;
};
export type SalesFilters = {
  fromDate: string; toDate: string; operatorId: string;
  paymentMethod: string; status: string; page: number; pageSize: number;
};

export async function listSales(filters: SalesFilters): Promise<{ rows: SaleListRow[]; total: number }> {
  const { data, error } = await requireSupabase().rpc("list_sales", {
    p_from_date: filters.fromDate, p_to_date: filters.toDate,
    p_operator_id: filters.operatorId || null,
    p_payment_method: filters.paymentMethod, p_status: filters.status,
    p_page: filters.page, p_page_size: filters.pageSize,
  });
  if (error) throw error;
  return data as { rows: SaleListRow[]; total: number };
}

export async function listSaleOperators(): Promise<SaleOperator[]> {
  const { data, error } = await requireSupabase().rpc("list_sale_operators");
  if (error) throw error;
  return data ?? [];
}

export async function getSaleContext(id: string): Promise<SaleContext> {
  const { data, error } = await requireSupabase().rpc("get_sale_context", { p_sale_id: id });
  if (error) throw error;
  return data as SaleContext;
}

export async function requestSaleCancellation(id: string, reason: string): Promise<void> {
  const { error } = await requireSupabase().rpc("request_sale_cancellation", {
    p_sale_id: id, p_reason: reason.trim(),
  });
  if (error) throw error;
}

export async function resolveSaleCancellation(id: string, approve: boolean, reason: string): Promise<Sale> {
  const { data, error } = await requireSupabase().rpc("resolve_sale_cancellation", {
    p_request_id: id, p_approve: approve, p_decision_reason: reason.trim(),
  });
  if (error) throw error;
  return data as Sale;
}

export function salesError(error: unknown): string {
  const message = error && typeof error === "object" && "message" in error ? String(error.message) : "";
  const known: Record<string, string> = {
    sales_permission_denied: "Você não tem permissão para consultar vendas.",
    sales_invalid_filter: "Confira o período e os filtros.",
    sale_not_found: "Venda não encontrada.",
    sale_not_cancellable: "Esta venda não pode mais ser cancelada.",
    cancellation_invalid_reason: "Informe um motivo com 10 a 500 caracteres.",
    cancellation_already_pending: "Já existe uma solicitação de cancelamento pendente.",
    cancellation_permission_denied: "Somente gerente ou administrador pode decidir o cancelamento.",
    cancellation_invalid_decision: "Informe o motivo da recusa com pelo menos 3 caracteres.",
    cancellation_request_not_found: "Solicitação não encontrada.",
    cancellation_already_resolved: "Esta solicitação já foi decidida.",
    cancellation_stock_missing: "Saldo de estoque indisponível para devolver os itens.",
    cash_open_session_required: "Abra um caixa antes de devolver dinheiro desta venda.",
    cash_insufficient: "O caixa não tem dinheiro suficiente para a devolução.",
  };
  return known[message] || "Não foi possível concluir a operação.";
}
