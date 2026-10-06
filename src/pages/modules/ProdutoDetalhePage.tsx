import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Camera, ImageOff } from "lucide-react";
import { Link, useNavigate, useParams } from "react-router";
import { toast } from "sonner";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { ErrorState, LoadingState } from "../../components/ui/Feedback";
import { Input } from "../../components/ui/Input";
import { Select } from "../../components/ui/Select";
import { can } from "../../config/permissions";
import { catalogError, getImageUrl, getProduct, listCategories, removeProductImage, saveProduct, uploadProductImage } from "../../features/catalog/api";
import type { Product, ProductInput } from "../../features/catalog/api";
import { RecipeEditor } from "../../features/catalog/RecipeEditor";
import { useAuth } from "../../hooks/useAuth";

type FormState = Omit<ProductInput, "cost_price" | "sale_price" | "minimum_stock"> & {
  cost_price: string; sale_price: string; minimum_stock: string;
};
const blank: FormState = {
  name: "", description: "", category_id: "", internal_code: "", barcode: null,
  unit: "UN", cost_price: "0", sale_price: "0", minimum_stock: "0", is_active: true,
};
function fromProduct(product: Product): FormState {
  return { name: product.name, description: product.description, category_id: product.category_id,
    internal_code: product.internal_code, barcode: product.barcode, unit: product.unit,
    cost_price: String(product.cost_price), sale_price: String(product.sale_price),
    minimum_stock: String(product.minimum_stock), is_active: product.is_active };
}
const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export default function ProdutoDetalhePage() {
  const { id = "novo" } = useParams();
  const isNew = id === "novo";
  const navigate = useNavigate();
  const auth = useAuth();
  const mayManage = Boolean(auth.profile && can(auth.permissions, "products.manage"));
  const mayManageRecipe = Boolean(auth.profile && can(auth.permissions, "products.manage") && can(auth.permissions, "stock.manage"));
  const queryClient = useQueryClient();
  const categories = useQuery({ queryKey: ["categories"], queryFn: listCategories });
  const productQuery = useQuery({ queryKey: ["product", id], queryFn: () => getProduct(id), enabled: !isNew });
  const product = productQuery.data;
  const imageQuery = useQuery({ queryKey: ["product-image", product?.image_path], queryFn: () => getImageUrl(product!.image_path!), enabled: Boolean(product?.image_path), staleTime: 50 * 60 * 1000 });
  const [draft, setDraft] = useState<Partial<FormState>>({});
  const form: FormState = { ...(product ? fromProduct(product) : blank), ...draft };
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState("");
  const mutation = useMutation({
    mutationFn: async () => {
      const input: ProductInput = {
        name: form.name.trim(), description: form.description.trim(), category_id: form.category_id,
        internal_code: form.internal_code.trim(), barcode: form.barcode?.trim() || null,
        unit: product?.is_composite ? product.unit : form.unit,
        cost_price: product?.is_composite ? 0 : Number(form.cost_price), sale_price: Number(form.sale_price),
        minimum_stock: product?.is_composite ? 0 : Number(form.minimum_stock), is_active: form.is_active,
      };
      const saved = await saveProduct(input, isNew ? undefined : id);
      let imageError: string | null = null;
      if (file) {
        try { await uploadProductImage(saved, file); }
        catch (reason) { imageError = catalogError(reason); }
      }
      return { saved, imageError };
    },
    onSuccess: ({ saved, imageError }) => {
      void queryClient.invalidateQueries({ queryKey: ["products"] });
      void queryClient.invalidateQueries({ queryKey: ["product", saved.id] });
      void queryClient.invalidateQueries({ queryKey: ["product-image"] });
      setFile(null);
      setDraft({});
      toast.success(isNew ? "Produto cadastrado." : "Produto atualizado.");
      if (imageError) toast.error(`A imagem não foi salva: ${imageError}`);
      if (isNew) navigate(`/produtos/${saved.id}`, { replace: true });
    },
    onError: (reason) => setError(catalogError(reason)),
  });
  const removeImage = useMutation({
    mutationFn: () => removeProductImage(product!),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ["product", id] }); toast.success("Imagem removida."); },
    onError: (reason) => toast.error(catalogError(reason)),
  });
  if (!isNew && productQuery.isPending) return <LoadingState />;
  if (!isNew && productQuery.isError) return <ErrorState onRetry={() => void productQuery.refetch()} />;
  if (!isNew && !product) return <ErrorState message="Produto não encontrado ou sem acesso." />;
  if (categories.isPending) return <LoadingState />;
  if (categories.isError) return <ErrorState onRetry={() => void categories.refetch()} />;
  if (isNew && !mayManage) return <ErrorState message="Você não tem permissão para cadastrar produtos." />;
  const selectable = categories.data?.filter((category) => category.is_active || category.id === product?.category_id) ?? [];
  return (
    <div className="page-stack">
      <Link to="/produtos" className="back-link"><ArrowLeft size={17} /> Voltar aos produtos</Link>
      <div className="page-heading"><div><div className="eyebrow">CATÁLOGO</div><h1>{isNew ? "Novo produto" : product?.name}</h1><p>{isNew ? "Preencha os dados do novo item. Depois de salvar, você pode criar a ficha técnica." : "Dados cadastrais, imagem e ficha técnica do produto."}</p></div>
        {!isNew && <Badge tone={product?.is_active ? "success" : "neutral"}>{product?.is_active ? "Ativo" : "Inativo"}</Badge>}
      </div>
      <form onSubmit={(event) => { event.preventDefault(); setError(""); mutation.mutate(); }}>
        <Card className="catalog-panel">
          <h2>Informações básicas</h2>
          <div className="catalog-grid">
            <Input label="Nome do produto" required minLength={2} maxLength={160} disabled={!mayManage} value={form.name} onChange={(event) => setDraft({ ...form, name: event.target.value })} />
            <Select label="Categoria" required disabled={!mayManage} value={form.category_id} onChange={(event) => setDraft({ ...form, category_id: event.target.value })}><option value="">Selecione</option>{selectable.map((item) => <option key={item.id} value={item.id}>{item.name}{item.is_active ? "" : " (inativa)"}</option>)}</Select>
            <Input label="Código interno" required maxLength={60} disabled={!mayManage} value={form.internal_code} onChange={(event) => setDraft({ ...form, internal_code: event.target.value })} />
            <Input label="Código de barras" inputMode="numeric" pattern="[0-9]{3,32}" title="Use de 3 a 32 dígitos" maxLength={32} disabled={!mayManage} placeholder="Leitura por câmera em etapa futura" value={form.barcode ?? ""} onChange={(event) => setDraft({ ...form, barcode: event.target.value })} />
            <Select label="Unidade" disabled={!mayManage || product?.is_composite} value={form.unit} onChange={(event) => setDraft({ ...form, unit: event.target.value })}>{["UN", "KG", "G", "L", "ML", "CX", "PCT"].map((unit) => <option key={unit} value={unit}>{unit}</option>)}</Select>
            <label className="catalog-check catalog-check-bottom"><input type="checkbox" disabled={!mayManage} checked={form.is_active} onChange={(event) => setDraft({ ...form, is_active: event.target.checked })} /> Produto ativo</label>
          </div>
          <div className="field"><label htmlFor="product-description">Descrição</label><textarea id="product-description" maxLength={2000} disabled={!mayManage} value={form.description} onChange={(event) => setDraft({ ...form, description: event.target.value })} /></div>
        </Card>
        <Card className="catalog-panel"><h2>Preços e estoque mínimo</h2><div className="catalog-grid">
          <Input label="Preço de custo (R$)" type="number" min="0" max="9999999999.99" step="0.01" required disabled={!mayManage || product?.is_composite} value={product?.is_composite ? "0" : form.cost_price} onChange={(event) => setDraft({ ...form, cost_price: event.target.value })} />
          <Input label="Preço de venda (R$)" type="number" min="0" max="9999999999.99" step="0.01" required disabled={!mayManage} value={form.sale_price} onChange={(event) => setDraft({ ...form, sale_price: event.target.value })} />
          <Input label="Estoque mínimo" type="number" min="0" max="999999999.999" step="0.001" required disabled={!mayManage || product?.is_composite} value={product?.is_composite ? "0" : form.minimum_stock} onChange={(event) => setDraft({ ...form, minimum_stock: event.target.value })} />
          <div className="catalog-metric"><span>{product?.is_composite ? "Custo pela ficha técnica" : "Margem calculada"}</span><strong>{product?.is_composite ? "Variável" : product?.margin_percent == null ? "—" : `${product.margin_percent}%`}</strong><small>{product?.is_composite ? "Calculado com o custo atual dos ingredientes" : product ? `Venda atual: ${money.format(product.sale_price)}` : "Disponível após salvar"}</small></div>
        </div></Card>
        <Card className="catalog-panel"><h2>Imagem do produto</h2>
          {product?.image_path && imageQuery.data ? <img className="catalog-image" src={imageQuery.data} alt={product.name} /> : <div className="catalog-image-placeholder"><ImageOff size={28} /><span>Sem imagem</span></div>}
          {mayManage && <div className="catalog-image-actions"><Input label="Enviar imagem (JPG, PNG ou WebP, até 3 MB)" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
          {product?.image_path && <Button type="button" variant="secondary" disabled={removeImage.isPending} onClick={() => removeImage.mutate()}><Camera size={15} /> Remover imagem</Button>}</div>}
        </Card>
        {error && <p className="catalog-error" role="alert">{error}</p>}
        {mayManage && <div className="catalog-save"><Button type="submit" disabled={mutation.isPending}>{mutation.isPending ? "Salvando..." : isNew ? "Cadastrar produto" : "Salvar alterações"}</Button></div>}
      </form>
      {!isNew && product && <RecipeEditor key={product.id} product={product} mayManage={mayManageRecipe} />}
    </div>
  );
}
