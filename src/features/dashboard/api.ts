import { requireSupabase } from "../../lib/supabase";
import type { ProfitLoss } from "../finance/api";

export type DashboardMetrics = {
  as_of_date: string;
  today: ProfitLoss;
  month: ProfitLoss;
  open_cash_count: number;
  cash_balance: number;
  low_stock_count: number;
  low_stock: { id: string; name: string; quantity: number; minimum_stock: number; unit: string }[];
  top_products: { id: string; name: string; quantity: number; revenue: number; unit: string }[];
  top_categories: { id: string; name: string; quantity: number; revenue: number }[];
  daily_sales: { date: string; net_sales: number }[];
  payment_methods: { method: string; amount: number; sales_count: number }[];
};

export async function getDashboardMetrics(): Promise<DashboardMetrics> {
  const { data, error } = await requireSupabase().rpc("get_dashboard_metrics");
  if (error) throw error;
  return data as DashboardMetrics;
}

export function dashboardError(error: unknown): string {
  const message = error && typeof error === "object" && "message" in error ? String(error.message) : "";
  if (message.includes("dashboard_permission_denied")) return "Você não tem permissão para consultar o dashboard.";
  return "Não foi possível carregar os indicadores.";
}
