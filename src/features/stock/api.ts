import { listProducts } from "../catalog/api";
import type { Product } from "../catalog/api";
import { requireSupabase } from "../../lib/supabase";

export type StockItem = Product & { quantity: number; balance_updated_at: string | null };
export type Supplier = {
  id: string; name: string; phone: string; email: string; notes: string;
  is_active: boolean; created_at: string; updated_at: string;
};
export type SupplierInput = Pick<Supplier, "name" | "phone" | "email" | "notes" | "is_active">;
export type StockMovementType = "ENTRADA" | "SAIDA" | "VENDA" | "CANCELAMENTO" | "AJUSTE" | "PERDA" | "AVARIA" | "INVENTARIO";
export type StockMovement = {
  id: string; product_id: string; type: StockMovementType; quantity: number;
  previous_quantity: number; new_quantity: number; unit_cost: number | null;
  total_cost: number | null; reason: string; supplier_id: string | null;
  invoice_number: string; notes: string; occurred_on: string; sale_id: string | null;
  user_id: string; operator_name: string; created_at: string;
};
export type MovementInput = {
  productId: string; type: Exclude<StockMovementType, "VENDA" | "CANCELAMENTO">;
  requestId: string; quantity?: number | null; countedQuantity?: number | null;
  expectedPrevious?: number | null; unitCost?: number | null; reason: string;
  supplierId?: string | null; invoiceNumber?: string; notes?: string; occurredOn?: string | null;
};

export async function listStockItems(): Promise<StockItem[]> {
  const products = await listProducts();
  const balances = new Map<string, { quantity: number; updated_at: string }>();
  const pageSize = 500;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await requireSupabase().from("stock_balances")
      .select("product_id,quantity,updated_at").order("product_id")
      .range(offset, offset + pageSize - 1);
    if (error) throw error;
    for (const row of data ?? []) balances.set(row.product_id, row);
    if (!data || data.length < pageSize) break;
  }
  return products.filter((product) => !product.is_composite).map((product) => ({
    ...product,
    quantity: Number(balances.get(product.id)?.quantity ?? 0),
    balance_updated_at: balances.get(product.id)?.updated_at ?? null,
  }));
}

export async function listSuppliers(): Promise<Supplier[]> {
  const all: Supplier[] = [];
  const pageSize = 500;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await requireSupabase().from("suppliers")
      .select("id,name,phone,email,notes,is_active,created_at,updated_at")
      .order("name").order("id").range(offset, offset + pageSize - 1);
    if (error) throw error;
    all.push(...(data ?? []));
    if (!data || data.length < pageSize) break;
  }
  return all;
}

export async function saveSupplier(input: SupplierInput, id?: string): Promise<Supplier> {
  const query = id
    ? requireSupabase().from("suppliers").update(input).eq("id", id)
    : requireSupabase().from("suppliers").insert(input);
  const { data, error } = await query.select().single();
  if (error) throw error;
  return data;
}

export async function listMovements(page: number, productId?: string, type?: string): Promise<{ rows: StockMovement[]; count: number }> {
  const pageSize = 30;
  let query = requireSupabase().from("stock_movements")
    .select("id,product_id,type,quantity,previous_quantity,new_quantity,unit_cost,total_cost,reason,supplier_id,invoice_number,notes,occurred_on,sale_id,user_id,operator_name,created_at", { count: "exact" })
    .order("created_at", { ascending: false }).order("id", { ascending: false })
    .range(page * pageSize, (page + 1) * pageSize - 1);
  if (productId) query = query.eq("product_id", productId);
  if (type) query = query.eq("type", type);
  const { data, error, count } = await query;
  if (error) throw error;
  return { rows: data ?? [], count: count ?? 0 };
}

export async function recordMovement(input: MovementInput): Promise<StockMovement> {
  const { data, error } = await requireSupabase().rpc("record_stock_movement", {
    p_product_id: input.productId,
    p_type: input.type,
    p_request_id: input.requestId,
    p_quantity: input.quantity ?? null,
    p_counted_quantity: input.countedQuantity ?? null,
    p_expected_previous: input.expectedPrevious ?? null,
    p_unit_cost: input.unitCost ?? null,
    p_reason: input.reason.trim(),
    p_supplier_id: input.supplierId || null,
    p_invoice_number: input.invoiceNumber?.trim() ?? "",
    p_notes: input.notes?.trim() ?? "",
    p_occurred_on: input.occurredOn ?? null,
  });
  if (error) throw error;
  return data as StockMovement;
}

export function stockError(error: unknown): string {
  const message = error && typeof error === "object" && "message" in error ? String(error.message) : "";
  const known: Record<string, string> = {
    stock_permission_denied: "Você não tem permissão para movimentar o estoque.",
    stock_insufficient: "Saldo insuficiente para esta saída.",
    stock_balance_changed: "O saldo mudou durante a conferência. Atualize os dados e confirme novamente.",
    stock_invalid_supplier: "Selecione um fornecedor ativo.",
    stock_product_not_found: "Produto não encontrado.",
    stock_request_reused: "Esta operação já foi utilizada para outro movimento.",
    stock_invalid_precision: "Use no máximo três casas decimais na quantidade.",
    stock_invalid_entry: "Confira quantidade e custo unitário da entrada.",
    stock_invalid_count: "Confira a contagem do inventário.",
    stock_reason_required: "Informe um motivo com pelo menos três caracteres.",
    recipe_virtual_stock: "Produtos compostos não têm saldo físico. Movimente seus ingredientes.",
  };
  if (known[message]) return known[message];
  if (error && typeof error === "object" && "code" in error) {
    if (error.code === "23505") return "Registro duplicado. Confira se esta operação já foi salva.";
    if (error.code === "42501") return "Você não tem permissão para esta operação.";
  }
  return "Não foi possível concluir a operação.";
}
