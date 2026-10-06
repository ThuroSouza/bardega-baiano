import { requireSupabase } from "../../lib/supabase";

export const reportNames = {
  sales: "Vendas", products: "Produtos", stock: "Estoque",
  movements: "Movimentações", entries: "Entradas", losses: "Perdas",
  finance: "Financeiro", expenses: "Despesas", revenues: "Receitas",
  profit: "Lucro", cash: "Caixas", payments: "Formas de pagamento",
  operators: "Operadores",
} as const;
export type ReportKey = keyof typeof reportNames;
export type OperationalReport = {
  report: ReportKey; from_date: string; to_date: string;
  page: number; page_size: number; total: number;
  summary: Record<string, unknown>; rows: Record<string, unknown>[];
};

export async function getOperationalReport(
  report: ReportKey, fromDate: string, toDate: string, page: number,
): Promise<OperationalReport> {
  const { data, error } = await requireSupabase().rpc("get_operational_report", {
    p_report: report, p_from_date: fromDate, p_to_date: toDate,
    p_page: page, p_page_size: 25,
  });
  if (error) throw error;
  return data as OperationalReport;
}

export function reportsError(error: unknown) {
  const message = error && typeof error === "object" && "message" in error ? String(error.message) : "";
  if (message.includes("reports_permission_denied")) return "Você não tem permissão para consultar relatórios.";
  if (message.includes("reports_invalid_filter")) return "Confira o período e os filtros escolhidos.";
  return "Não foi possível carregar o relatório.";
}
