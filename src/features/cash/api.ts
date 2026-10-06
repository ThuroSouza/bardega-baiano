import { requireSupabase } from "../../lib/supabase";
import type { PaymentMethod } from "../pdv/api";

export type CashSession = {
  id: string; session_number: number; opened_by: string; opened_at: string;
  opening_amount: number; status: "ABERTO" | "FECHADO";
  closed_at: string | null; closed_by: string | null;
  counted_amount: number | null; expected_amount: number | null;
  difference_amount: number | null; close_note: string;
};
export type CashSummary = {
  cash_sales: number; pix_sales: number; debit_sales: number; credit_sales: number;
  supplies: number; withdrawals: number; cancellations: number;
  cash_cancellations: number; expected_cash: number;
};
export type CashMovement = {
  id: string; kind: "OPENING" | "SALE_PAYMENT" | "SALE_REVERSAL" | "SUPPLY" | "WITHDRAWAL";
  method: PaymentMethod; amount: number; reason: string; sale_id: string | null;
  sale_number: number | null; user_name: string; created_at: string;
};
export type CashDetail = {
  session: CashSession; operator_name: string; summary: CashSummary;
  movement_count: number; movements: CashMovement[];
};
export type CashHistoryRow = CashSession & { operator_name: string; sale_count: number };

export async function getMyOpenCashSession(userId: string): Promise<Pick<CashSession, "id" | "session_number"> | null> {
  const { data, error } = await requireSupabase().from("cash_sessions")
    .select("id,session_number").eq("opened_by", userId).eq("status", "ABERTO").maybeSingle();
  if (error) throw error;
  return data;
}

export async function listCashSessions(limit = 30, offset = 0): Promise<{ rows: CashHistoryRow[]; total: number }> {
  const { data, error } = await requireSupabase().rpc("list_cash_sessions", { p_limit: limit, p_offset: offset });
  if (error) throw error;
  return data as { rows: CashHistoryRow[]; total: number };
}

export async function getCashSession(id: string, limit = 50, offset = 0): Promise<CashDetail> {
  const { data, error } = await requireSupabase().rpc("get_cash_session", {
    p_session_id: id, p_limit: limit, p_offset: offset,
  });
  if (error) throw error;
  return data as CashDetail;
}

export async function openCashSession(requestId: string, amount: string): Promise<CashSession> {
  const { data, error } = await requireSupabase().rpc("open_cash_session", {
    p_request_id: requestId, p_opening_amount: Number(amount),
  });
  if (error) throw error;
  return data as CashSession;
}

export async function addCashAdjustment(input: {
  sessionId: string; requestId: string; kind: "SUPPLY" | "WITHDRAWAL";
  amount: string; reason: string;
}): Promise<CashMovement> {
  const { data, error } = await requireSupabase().rpc("add_cash_adjustment", {
    p_session_id: input.sessionId, p_request_id: input.requestId,
    p_kind: input.kind, p_amount: Number(input.amount), p_reason: input.reason.trim(),
  });
  if (error) throw error;
  return data as CashMovement;
}

export async function closeCashSession(id: string, amount: string, note: string): Promise<CashSession> {
  const { data, error } = await requireSupabase().rpc("close_cash_session", {
    p_session_id: id, p_counted_amount: Number(amount), p_note: note.trim(),
  });
  if (error) throw error;
  return data as CashSession;
}

export function cashError(error: unknown): string {
  const message = error && typeof error === "object" && "message" in error ? String(error.message) : "";
  const known: Record<string, string> = {
    cash_permission_denied: "Você não tem permissão para operar este caixa.",
    cash_invalid_amount: "Informe um valor válido com até duas casas decimais.",
    cash_invalid_adjustment: "Confira o valor e informe um motivo de pelo menos 3 caracteres.",
    cash_request_reused: "Esta tentativa já foi usada com outros dados.",
    cash_already_open: "Você já possui um caixa aberto.",
    cash_session_not_found: "Caixa não encontrado.",
    cash_session_closed: "Este caixa já foi fechado.",
    cash_insufficient: "O dinheiro disponível no caixa é insuficiente.",
    cash_negative_expected: "O saldo esperado não pode ficar negativo.",
    cash_invalid_filter: "Não foi possível consultar este período do histórico.",
    cash_open_session_required: "Abra um caixa antes de finalizar vendas ou devolver dinheiro.",
  };
  return known[message] || "Não foi possível concluir a operação no caixa.";
}
