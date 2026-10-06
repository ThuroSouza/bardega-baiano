import { requireSupabase } from "../../lib/supabase";

export const expenseCategories = {
  FORNECEDOR: "Fornecedor", ALUGUEL: "Aluguel", ENERGIA: "Energia", AGUA: "Água",
  INTERNET: "Internet", FUNCIONARIOS: "Funcionários", IMPOSTOS: "Impostos",
  MERCADORIAS: "Mercadorias", MANUTENCAO: "Manutenção", MARKETING: "Marketing",
  TAXAS: "Taxas", OUTROS: "Outros",
} as const;
export type ExpenseCategory = keyof typeof expenseCategories;
export const financePaymentLabels = {
  DINHEIRO: "Dinheiro", PIX: "PIX", CARTAO_DEBITO: "Cartão de débito",
  CARTAO_CREDITO: "Cartão de crédito", BOLETO: "Boleto",
  TRANSFERENCIA: "Transferência", OUTRO: "Outro",
} as const;
export type FinancePaymentMethod = keyof typeof financePaymentLabels;
export type ExpenseStatus = "PENDENTE" | "PAGA" | "CANCELADA";
export type ReceivableStatus = "PENDENTE" | "RECEBIDA" | "CANCELADA";
export type FinanceFilter = "all" | "open" | "overdue" | "paid" | "cancelled";
export type FinancialExpense = {
  id: string; created_at: string; created_by: string; description: string;
  category: ExpenseCategory; supplier_name: string; amount: number; due_on: string;
  status: ExpenseStatus; paid_on: string | null; payment_method: FinancePaymentMethod | null;
  notes: string; settled_by: string | null;
};
export type FinancialReceivable = {
  id: string; created_at: string; created_by: string; description: string;
  payer_name: string; amount: number; due_on: string; status: ReceivableStatus;
  received_on: string | null; payment_method: FinancePaymentMethod | null;
  notes: string; settled_by: string | null;
};
export type FinancialEntry = {
  id: string; sale_id: string | null; receivable_id: string | null;
  source_entry_id: string | null; reversed_at: string | null;
  type: "RECEITA" | "ESTORNO" | "RECEITA_MANUAL" | "ESTORNO_MANUAL";
  amount: number; created_at: string; received_on: string;
  description: string; payment_method: FinancePaymentMethod | null; notes: string;
};
export type ProfitLossCategory = { category: ExpenseCategory; amount: number; paid: number; open: number };
export type ProfitLoss = {
  from_date: string; to_date: string;
  gross_sales: number; discounts: number; cancellations: number; net_sales: number;
  cost_sold: number; cost_reversed: number; cmv: number; gross_profit: number;
  other_revenue: number; operating_expenses: number; expenses_paid: number;
  expenses_open: number; inventory_purchases: number; result: number;
  margin_percent: number | null; average_ticket: number | null;
  sales_count: number; cancellations_count: number;
  expense_categories: ProfitLossCategory[];
};

export function localToday() {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const pick = (name: string) => parts.find((part) => part.type === name)?.value ?? "";
  return `${pick("year")}-${pick("month")}-${pick("day")}`;
}
export function effectiveExpenseStatus(row: FinancialExpense): ExpenseStatus | "ATRASADA" {
  return row.status === "PENDENTE" && row.due_on < localToday() ? "ATRASADA" : row.status;
}
export function effectiveReceivableStatus(row: FinancialReceivable): ReceivableStatus | "ATRASADA" {
  return row.status === "PENDENTE" && row.due_on < localToday() ? "ATRASADA" : row.status;
}
export const expenseStatusLabels = { PENDENTE: "Pendente", PAGA: "Paga", ATRASADA: "Atrasada", CANCELADA: "Cancelada" } as const;
export const receivableStatusLabels = { PENDENTE: "Pendente", RECEBIDA: "Recebida", ATRASADA: "Atrasada", CANCELADA: "Cancelada" } as const;
export const financeFilterLabels = { all: "Todos", open: "Em aberto", overdue: "Atrasados", paid: "Baixados", cancelled: "Cancelados" } as const;

function check<T>(data: T, error: { message: string } | null): T {
  if (error) throw error;
  return data;
}
export async function listFinancialEntries(page = 0, pageSize = 25) {
  const result = await requireSupabase().from("financial_entries")
    .select("id,sale_id,receivable_id,source_entry_id,reversed_at,type,amount,created_at,received_on,description,payment_method,notes", { count: "exact" })
    .order("created_at", { ascending: false }).range(page * pageSize, (page + 1) * pageSize - 1);
  return { rows: check(result.data, result.error) as FinancialEntry[], total: result.count ?? 0 };
}
export async function listExpenses(filter: FinanceFilter, page = 0, pageSize = 25) {
  let query = requireSupabase().from("financial_expenses").select("*", { count: "exact" });
  if (filter === "open") query = query.eq("status", "PENDENTE");
  if (filter === "overdue") query = query.eq("status", "PENDENTE").lt("due_on", localToday());
  if (filter === "paid") query = query.eq("status", "PAGA");
  if (filter === "cancelled") query = query.eq("status", "CANCELADA");
  const result = await query.order("due_on", { ascending: false }).range(page * pageSize, (page + 1) * pageSize - 1);
  return { rows: check(result.data, result.error) as FinancialExpense[], total: result.count ?? 0 };
}
export async function listReceivables(filter: FinanceFilter, page = 0, pageSize = 25) {
  let query = requireSupabase().from("financial_receivables").select("*", { count: "exact" });
  if (filter === "open") query = query.eq("status", "PENDENTE");
  if (filter === "overdue") query = query.eq("status", "PENDENTE").lt("due_on", localToday());
  if (filter === "paid") query = query.eq("status", "RECEBIDA");
  if (filter === "cancelled") query = query.eq("status", "CANCELADA");
  const result = await query.order("due_on", { ascending: false }).range(page * pageSize, (page + 1) * pageSize - 1);
  return { rows: check(result.data, result.error) as FinancialReceivable[], total: result.count ?? 0 };
}
export async function getFinanceAlerts() {
  const today = localToday();
  const client = requireSupabase();
  const [expenses, receivables] = await Promise.all([
    client.from("financial_expenses").select("id", { count: "exact", head: true }).eq("status", "PENDENTE").lt("due_on", today),
    client.from("financial_receivables").select("id", { count: "exact", head: true }).eq("status", "PENDENTE").lt("due_on", today),
  ]);
  if (expenses.error) throw expenses.error;
  if (receivables.error) throw receivables.error;
  return { overdueExpenses: expenses.count ?? 0, overdueReceivables: receivables.count ?? 0 };
}
export async function getProfitAndLoss(fromDate: string, toDate: string): Promise<ProfitLoss> {
  const { data, error } = await requireSupabase().rpc("get_profit_and_loss", {
    p_from_date: fromDate, p_to_date: toDate,
  });
  return check(data, error) as ProfitLoss;
}
async function call<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await requireSupabase().rpc(name, args);
  return check(data, error) as T;
}
export function createExpense(input: { requestId: string; description: string; category: ExpenseCategory; supplierName: string; amount: string; dueOn: string; notes: string }) {
  return call<FinancialExpense>("create_financial_expense", {
    p_request_id: input.requestId, p_description: input.description.trim(), p_category: input.category,
    p_supplier_name: input.supplierName.trim(), p_amount: Number(input.amount), p_due_on: input.dueOn,
    p_notes: input.notes.trim(),
  });
}
export function settleExpense(id: string, paidOn: string, method: FinancePaymentMethod) {
  return call<FinancialExpense>("settle_financial_expense", { p_id: id, p_paid_on: paidOn, p_payment_method: method });
}
export function cancelExpense(id: string) {
  return call<FinancialExpense>("cancel_financial_expense", { p_id: id });
}
export function createReceivable(input: { requestId: string; description: string; payerName: string; amount: string; dueOn: string; notes: string }) {
  return call<FinancialReceivable>("create_financial_receivable", {
    p_request_id: input.requestId, p_description: input.description.trim(), p_payer_name: input.payerName.trim(),
    p_amount: Number(input.amount), p_due_on: input.dueOn, p_notes: input.notes.trim(),
  });
}
export function settleReceivable(id: string, receivedOn: string, method: FinancePaymentMethod) {
  return call<FinancialReceivable>("settle_financial_receivable", { p_id: id, p_received_on: receivedOn, p_payment_method: method });
}
export function cancelReceivable(id: string) {
  return call<FinancialReceivable>("cancel_financial_receivable", { p_id: id });
}
export function recordManualRevenue(input: { requestId: string; description: string; amount: string; receivedOn: string; method: FinancePaymentMethod; notes: string }) {
  return call<FinancialEntry>("record_manual_revenue", {
    p_request_id: input.requestId, p_description: input.description.trim(), p_amount: Number(input.amount),
    p_received_on: input.receivedOn, p_payment_method: input.method, p_notes: input.notes.trim(),
  });
}
export function reverseManualRevenue(id: string, reason: string) {
  return call<FinancialEntry>("reverse_manual_revenue", { p_entry_id: id, p_reason: reason.trim() });
}
export function financeError(error: unknown) {
  const message = error && typeof error === "object" && "message" in error ? String(error.message) : "";
  const known: Record<string, string> = {
    finance_permission_denied: "Você não tem permissão para alterar o financeiro.",
    finance_invalid_input: "Confira os campos informados.",
    finance_request_reused: "Esta tentativa já foi usada com outros dados.",
    finance_not_found: "Registro financeiro não encontrado.",
    finance_already_resolved: "Este registro já foi baixado ou cancelado.",
    finance_invalid_reversal: "Apenas receitas manuais diretas podem ser estornadas aqui.",
    finance_future_date: "A data da baixa ou da receita não pode ser futura.",
    profit_invalid_period: "Escolha um período válido de até 10 anos.",
  };
  return known[message] || "Não foi possível concluir a operação financeira.";
}
