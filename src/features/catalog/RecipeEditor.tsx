import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { ErrorState, LoadingState } from "../../components/ui/Feedback";
import { Input } from "../../components/ui/Input";
import { Select } from "../../components/ui/Select";
import { listStockItems } from "../stock/api";
import { listRecipeItems, recipeError, saveProductRecipe } from "./api";
import type { Product } from "./api";

type Row = { key: string; ingredient_id: string; quantity: string };
const wholeUnits = new Set(["UN", "CX", "PCT"]);
const number = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 });
const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export function RecipeEditor({ product, mayManage }: { product: Product; mayManage: boolean }) {
  const client = useQueryClient();
  const recipe = useQuery({ queryKey: ["recipe", product.id], queryFn: () => listRecipeItems(product.id) });
  const stock = useQuery({ queryKey: ["stock"], queryFn: listStockItems });
  const [draft, setDraft] = useState<Row[] | null>(null);
  const [error, setError] = useState("");
  const rows = draft ?? (recipe.data ?? []).map((item) => ({ key: item.ingredient_id, ingredient_id: item.ingredient_id, quantity: String(item.quantity) }));
  const ingredients = (stock.data ?? []).filter((item) => item.id !== product.id && item.is_active);
  const ingredientById = new Map(ingredients.map((item) => [item.id, item]));
  const potential = rows.map((row) => {
    const ingredient = ingredientById.get(row.ingredient_id);
    const quantity = Number(row.quantity);
    return { ingredient, quantity };
  });
  const cost = potential.reduce((sum, row) => sum + (row.ingredient ? row.ingredient.cost_price * row.quantity : 0), 0);
  const available = potential.length && potential.every((row) => row.ingredient && row.quantity > 0)
    ? Math.max(0, Math.min(...potential.map((row) => Math.floor((row.ingredient?.quantity ?? 0) / row.quantity)))) : 0;
  const eligible = wholeUnits.has(product.unit) && product.minimum_stock === 0;
  const mutation = useMutation({
    mutationFn: async () => {
      if (rows.length > 30) throw new Error("Use no máximo 30 ingredientes.");
      const seen = new Set<string>();
      const items = rows.map((row) => {
        const ingredient = ingredientById.get(row.ingredient_id);
        const quantity = Number(row.quantity);
        if (!ingredient || !row.quantity || !Number.isFinite(quantity) || quantity <= 0 || Math.abs(quantity * 1000 - Math.round(quantity * 1000)) > 0.000001 ||
          (wholeUnits.has(ingredient.unit) && !Number.isInteger(quantity)) || seen.has(row.ingredient_id)) {
          throw new Error("Selecione ingredientes diferentes e informe quantidades válidas para cada unidade.");
        }
        seen.add(row.ingredient_id);
        return { ingredient_id: row.ingredient_id, quantity };
      });
      return saveProductRecipe(product.id, items);
    },
    onSuccess: (result) => {
      setDraft(null); setError("");
      void client.invalidateQueries({ queryKey: ["recipe", product.id] });
      void client.invalidateQueries({ queryKey: ["product", product.id] });
      void client.invalidateQueries({ queryKey: ["products"] });
      void client.invalidateQueries({ queryKey: ["stock"] });
      toast.success(result.is_composite ? "Ficha técnica salva." : "Ficha técnica removida. Produto padrão restaurado.");
    },
    onError: (reason) => setError(recipeError(reason)),
  });
  if (recipe.isPending || stock.isPending) return <Card className="catalog-panel"><h2>Ficha técnica</h2><LoadingState /></Card>;
  if (recipe.isError || stock.isError) return <Card className="catalog-panel"><h2>Ficha técnica</h2><ErrorState onRetry={() => { void recipe.refetch(); void stock.refetch(); }} /></Card>;
  return <Card className="catalog-panel recipe-panel">
    <div className="recipe-heading"><div><h2>Ficha técnica · composição</h2><p>Opcional. Cada venda dá baixa nos ingredientes da receita, sem movimentar o produto composto.</p></div>{product.is_composite && <span className="recipe-status">Produto composto</span>}</div>
    {!eligible && <p className="recipe-guidance">Para compor, defina a unidade do produto como UN, CX ou PCT e o estoque mínimo como zero. O saldo físico do produto também precisa ser zero.</p>}
    {rows.length === 0 ? <p className="recipe-empty">Este produto não tem ficha técnica. Ele usa o estoque normal.</p> :
      <div className="recipe-rows">{rows.map((row, index) => {
        const selected = ingredientById.get(row.ingredient_id);
        return <div className="recipe-row" key={row.key}>
          <Select label={`Ingrediente ${index + 1}`} disabled={!mayManage || mutation.isPending} value={row.ingredient_id} onChange={(event) => setDraft(rows.map((item) => item.key === row.key ? { ...item, ingredient_id: event.target.value, quantity: "" } : item))}>
            <option value="">Selecione</option>{ingredients.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.unit}</option>)}
          </Select>
          <Input label={`Quantidade (${selected?.unit ?? "unidade"})`} type="number" min="0.001" max="999999999.999" step={selected && wholeUnits.has(selected.unit) ? "1" : "0.001"} disabled={!mayManage || mutation.isPending} value={row.quantity} onChange={(event) => setDraft(rows.map((item) => item.key === row.key ? { ...item, quantity: event.target.value } : item))} />
          {mayManage && <Button type="button" variant="ghost" aria-label={`Remover ingrediente ${index + 1}`} disabled={mutation.isPending} onClick={() => setDraft(rows.filter((item) => item.key !== row.key))}><Trash2 size={16} /></Button>}
        </div>;
      })}</div>}
    {rows.length > 0 && <div className="recipe-summary"><span>Disponível para venda: <strong>{number.format(available)} {product.unit}</strong></span><span>Custo estimado por {product.unit}: <strong>{money.format(cost)}</strong></span></div>}
    <p className="recipe-guidance">Informe a quantidade na unidade cadastrada do ingrediente. Exemplo: para 50 ml de uma garrafa em L, use 0,05 L. O custo acima usa os preços atuais; a venda guarda o custo daquele momento.</p>
    {error && <p className="catalog-error" role="alert">{error}</p>}
    {mayManage && <div className="recipe-actions"><Button type="button" variant="secondary" disabled={rows.length >= 30 || mutation.isPending} onClick={() => setDraft([...rows, { key: crypto.randomUUID(), ingredient_id: "", quantity: "" }])}><Plus size={16} /> Adicionar ingrediente</Button><Button type="button" disabled={mutation.isPending || draft === null || (rows.length > 0 && !eligible)} onClick={() => { setError(""); mutation.mutate(); }}>{mutation.isPending ? "Salvando..." : rows.length ? "Salvar ficha técnica" : "Remover ficha técnica"}</Button></div>}
  </Card>;
}
