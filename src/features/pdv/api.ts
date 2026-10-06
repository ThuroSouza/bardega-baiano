import { requireSupabase } from "../../lib/supabase";

export type PdvProduct = {
  product_id: string; name: string; internal_code: string; barcode: string | null;
  unit: string; sale_price: number; stock_quantity: number;
};
export type PaymentMethod = "DINHEIRO" | "PIX" | "CARTAO_DEBITO" | "CARTAO_CREDITO";
export const paymentLabels: Record<PaymentMethod, string> = {
  DINHEIRO: "Dinheiro", PIX: "PIX", CARTAO_DEBITO: "Cartão de débito", CARTAO_CREDITO: "Cartão de crédito",
};
export type Sale = {
  id: string; sale_number: number; status: string; operator_id: string;
  subtotal: number; discount_amount: number; discount_reason: string;
  total: number; request_id: string; created_at: string; updated_at: string;
};
export type SaleItem = {
  id: string; sale_id: string; product_id: string; product_name: string; unit: string;
  quantity: number; unit_price: number; gross_subtotal: number;
  discount_amount: number; net_subtotal: number;
};
export type SalePayment = { id: string; sale_id: string; method: PaymentMethod; amount: number; created_at: string };
export type SaleComponent = { sale_item_id: string; ingredient_id: string; ingredient_name: string; unit: string; quantity: number };

export async function searchPdvProducts(search: string): Promise<PdvProduct[]> {
  const { data, error } = await requireSupabase().rpc("search_pdv_products", {
    p_search: search.trim(), p_product_ids: null, p_limit: 40,
  });
  if (error) throw error;
  return data ?? [];
}

export async function getPdvProductsByIds(ids: string[]): Promise<PdvProduct[]> {
  if (!ids.length) return [];
  const { data, error } = await requireSupabase().rpc("search_pdv_products", {
    p_search: "", p_product_ids: ids, p_limit: 100,
  });
  if (error) throw error;
  return data ?? [];
}

export async function checkoutSale(input: {
  requestId: string; items: { product_id: string; quantity: number }[];
  paymentMethod: PaymentMethod; expectedTotal: string;
  discountAmount: string; discountReason: string;
}): Promise<Sale> {
  const { data, error } = await requireSupabase().rpc("checkout_sale", {
    p_request_id: input.requestId,
    p_items: input.items,
    p_payment_method: input.paymentMethod,
    p_expected_total: Number(input.expectedTotal),
    p_discount_amount: Number(input.discountAmount),
    p_discount_reason: input.discountReason.trim(),
  });
  if (error) throw error;
  return data as Sale;
}

export async function getSaleDetail(id: string): Promise<{ sale: Sale; items: SaleItem[]; payments: SalePayment[]; components: SaleComponent[] }> {
  const client = requireSupabase();
  const [saleResult, itemsResult, paymentsResult] = await Promise.all([
    client.from("sales").select("id,sale_number,status,operator_id,subtotal,discount_amount,discount_reason,total,request_id,created_at,updated_at").eq("id", id).maybeSingle(),
    client.from("sale_items").select("id,sale_id,product_id,product_name,unit,quantity,unit_price,gross_subtotal,discount_amount,net_subtotal").eq("sale_id", id).order("created_at"),
    client.from("sale_payments").select("id,sale_id,method,amount,created_at").eq("sale_id", id).order("created_at"),
  ]);
  if (saleResult.error) throw saleResult.error;
  if (itemsResult.error) throw itemsResult.error;
  if (paymentsResult.error) throw paymentsResult.error;
  if (!saleResult.data) throw new Error("Venda não encontrada ou sem acesso.");
  const itemIds = (itemsResult.data ?? []).map((item) => item.id);
  let components: SaleComponent[] = [];
  if (itemIds.length) {
    const { data, error } = await client.from("sale_item_components")
      .select("sale_item_id,ingredient_id,ingredient_name,unit,quantity").in("sale_item_id", itemIds);
    if (error) throw error;
    components = data ?? [];
  }
  return { sale: saleResult.data, items: itemsResult.data ?? [], payments: paymentsResult.data ?? [], components };
}

export function pdvError(error: unknown): string {
  const message = error && typeof error === "object" && "message" in error ? String(error.message) : "";
  const known: Record<string, string> = {
    pdv_permission_denied: "Você não tem permissão para usar o PDV.",
    sale_invalid_items: "Adicione pelo menos um produto válido.",
    sale_invalid_amount: "Confira os valores da venda.",
    pdv_invalid_search: "A busca é muito longa. Use até 80 caracteres.",
    sale_invalid_item: "Há um item inválido no carrinho.",
    sale_invalid_quantity: "Confira as quantidades do carrinho.",
    sale_whole_unit_required: "Este produto deve ser vendido em unidades inteiras.",
    sale_product_unavailable: "Um produto foi desativado ou está sem preço. Atualize o carrinho.",
    sale_insufficient_stock: "Estoque insuficiente. Atualize o carrinho.",
    recipe_empty: "Um produto composto está sem ingredientes. Atualize o carrinho.",
    recipe_ingredient_unavailable: "Um ingrediente foi desativado. Atualize o carrinho.",
    recipe_cost_too_high: "O custo da composição ultrapassa o limite permitido. Revise a ficha técnica.",
    sale_price_changed: "Preço alterado. Atualize os valores do carrinho antes de finalizar.",
    sale_discount_denied: "Seu perfil não tem permissão para aplicar desconto.",
    sale_discount_reason_required: "Informe o motivo do desconto.",
    sale_discount_too_high: "O desconto precisa ser menor que o subtotal.",
    sale_invalid_payment: "Escolha uma forma de pagamento.",
    sale_request_reused: "Esta tentativa de venda já foi utilizada com outros dados.",
    cash_open_session_required: "Abra um caixa antes de finalizar a venda.",
  };
  if (known[message]) return known[message];
  if (error && typeof error === "object" && "code" in error && error.code === "42501") return "Operação não autorizada.";
  return "Não foi possível finalizar a venda.";
}
