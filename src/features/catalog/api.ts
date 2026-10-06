import { requireSupabase } from "../../lib/supabase";

export type Category = {
  id: string;
  name: string;
  description: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type Product = {
  id: string;
  name: string;
  description: string;
  category_id: string;
  internal_code: string;
  barcode: string | null;
  unit: string;
  cost_price: number;
  sale_price: number;
  margin_percent: number | null;
  minimum_stock: number;
  is_composite: boolean;
  is_active: boolean;
  image_path: string | null;
  created_at: string;
  updated_at: string;
};

export type CategoryInput = Pick<Category, "name" | "description" | "is_active">;
export type ProductInput = Pick<Product,
  "name" | "description" | "category_id" | "internal_code" | "barcode" |
  "unit" | "cost_price" | "sale_price" | "minimum_stock" | "is_active"
>;
export type RecipeItem = { product_id: string; ingredient_id: string; quantity: number };

export async function listCategories(): Promise<Category[]> {
  const all: Category[] = [];
  const pageSize = 500;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await requireSupabase().from("categories")
      .select("id,name,description,is_active,created_at,updated_at")
      .order("name").order("id").range(offset, offset + pageSize - 1);
    if (error) throw error;
    all.push(...(data ?? []));
    if (!data || data.length < pageSize) break;
  }
  return all;
}

export async function saveCategory(input: CategoryInput, id?: string): Promise<Category> {
  const query = id
    ? requireSupabase().from("categories").update(input).eq("id", id)
    : requireSupabase().from("categories").insert(input);
  const { data, error } = await query.select().single();
  if (error) throw error;
  return data;
}

export async function listProducts(): Promise<Product[]> {
  const all: Product[] = [];
  const pageSize = 500;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await requireSupabase().from("products")
      .select("id,name,description,category_id,internal_code,barcode,unit,cost_price,sale_price,margin_percent,minimum_stock,is_composite,is_active,image_path,created_at,updated_at")
      .order("name").order("id").range(offset, offset + pageSize - 1);
    if (error) throw error;
    all.push(...(data ?? []));
    if (!data || data.length < pageSize) break;
  }
  return all;
}

export async function getProduct(id: string): Promise<Product | null> {
  const { data, error } = await requireSupabase().from("products")
    .select("id,name,description,category_id,internal_code,barcode,unit,cost_price,sale_price,margin_percent,minimum_stock,is_composite,is_active,image_path,created_at,updated_at")
    .eq("id", id).maybeSingle();
  if (error) throw error;
  return data;
}

export async function saveProduct(input: ProductInput, id?: string): Promise<Product> {
  const query = id
    ? requireSupabase().from("products").update(input).eq("id", id)
    : requireSupabase().from("products").insert(input);
  const { data, error } = await query.select().single();
  if (error) throw error;
  return data;
}

export async function listRecipeItems(productId: string): Promise<RecipeItem[]> {
  const { data, error } = await requireSupabase().from("product_recipe_items")
    .select("product_id,ingredient_id,quantity").eq("product_id", productId).order("ingredient_id");
  if (error) throw error;
  return data ?? [];
}

export async function saveProductRecipe(productId: string, items: { ingredient_id: string; quantity: number }[]) {
  const { data, error } = await requireSupabase().rpc("set_product_recipe", {
    p_product_id: productId, p_items: items,
  });
  if (error) throw error;
  return data as { product_id: string; is_composite: boolean; ingredients_count: number };
}

export function recipeError(error: unknown): string {
  const message = error && typeof error === "object" && "message" in error ? String(error.message) : "";
  const known: Record<string, string> = {
    recipe_permission_denied: "Você não tem permissão para alterar fichas técnicas.",
    recipe_invalid_items: "Confira os ingredientes e as quantidades da ficha.",
    recipe_product_not_found: "Produto não encontrado.",
    recipe_parent_ineligible: "O produto composto precisa usar unidade inteira, estoque mínimo zero e não pode ter saldo físico nem ser ingrediente de outra ficha.",
    recipe_ingredient_unavailable: "Use apenas ingredientes ativos que não sejam compostos.",
    recipe_whole_unit_required: "Ingredientes em unidades, caixas ou pacotes exigem quantidade inteira.",
    recipe_virtual_stock: "Produtos compostos não recebem entradas ou ajustes físicos. Movimente os ingredientes.",
  };
  return known[message] || "Não foi possível salvar a ficha técnica.";
}

export async function getImageUrl(path: string): Promise<string> {
  const { data, error } = await requireSupabase().storage.from("product-images")
    .createSignedUrl(path, 60 * 60);
  if (error) throw error;
  return data.signedUrl;
}

export async function uploadProductImage(product: Product, file: File): Promise<void> {
  const mimeExtensions: Record<string, string> = {
    "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp",
  };
  const extension = mimeExtensions[file.type];
  if (!extension || file.size > 3 * 1024 * 1024 || file.size === 0) {
    throw new Error("Use uma imagem JPG, PNG ou WebP de até 3 MB.");
  }
  await changeProductImage(product.id, "upload", file);
}

export async function removeProductImage(product: Product): Promise<void> {
  if (!product.image_path) return;
  await changeProductImage(product.id, "remove");
}

async function changeProductImage(productId: string, action: "upload" | "remove", file?: File) {
  const body = new FormData();
  body.set("product_id", productId);
  body.set("action", action);
  if (file) body.set("file", file);
  const { data, error } = await requireSupabase().functions.invoke("product-image", { body });
  if (error) {
    const response = "context" in error ? error.context : null;
    if (response instanceof Response) {
      const result = await response.json().catch(() => null);
      if (result?.error) throw new Error(String(result.error));
    }
    throw error;
  }
  if (data?.error) throw new Error(String(data.error));
}

export function catalogError(error: unknown): string {
  const message = error && typeof error === "object" && "message" in error ? String(error.message) : "";
  const known: Record<string, string> = {
    image_invalid_file: "Use uma imagem JPG, PNG ou WebP válida de até 3 MB.",
    image_invalid_input: "Confira os dados da imagem e tente novamente.",
    image_product_not_found: "Produto não encontrado ou sem permissão de acesso.",
    image_product_changed: "A imagem do produto mudou. Atualize a página e tente novamente.",
    image_save_failed: "Não foi possível salvar a imagem. Tente novamente.",
    products_permission_denied: "Você não tem permissão para alterar imagens de produtos.",
  };
  if (known[message]) return known[message];
  if (error && typeof error === "object" && "code" in error) {
    if (error.code === "23505") return "Nome, código interno ou código de barras já cadastrado.";
    if (error.code === "23503") return "Esta categoria está vinculada a produtos.";
    if (error.code === "42501") return "Você não tem permissão para esta operação.";
  }
  return "Não foi possível concluir a operação.";
}
