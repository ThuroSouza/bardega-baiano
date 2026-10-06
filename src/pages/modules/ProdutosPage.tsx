import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Plus } from "lucide-react";
import { Link } from "react-router";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { EmptyState, ErrorState, LoadingState } from "../../components/ui/Feedback";
import { Input } from "../../components/ui/Input";
import { ResponsiveTable } from "../../components/ui/ResponsiveTable";
import { Select } from "../../components/ui/Select";
import { can } from "../../config/permissions";
import { listCategories, listProducts } from "../../features/catalog/api";
import { useAuth } from "../../hooks/useAuth";

const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export default function ProdutosPage() {
  const auth = useAuth();
  const mayManage = Boolean(auth.profile && can(auth.permissions, "products.manage"));
  const products = useQuery({ queryKey: ["products"], queryFn: listProducts });
  const categories = useQuery({ queryKey: ["categories"], queryFn: listCategories });
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [status, setStatus] = useState("active");
  const filtered = useMemo(() => (products.data ?? []).filter((item) => {
    const term = search.trim().toLocaleLowerCase("pt-BR");
    return (!term || [item.name, item.internal_code, item.barcode ?? ""].some((value) => value.toLocaleLowerCase("pt-BR").includes(term)))
      && (!category || item.category_id === category)
      && (status === "all" || item.is_active === (status === "active"));
  }), [products.data, search, category, status]);
  const names = new Map(categories.data?.map((item) => [item.id, item.name]));
  return (
    <div className="page-stack">
      <div className="page-heading">
        <div><div className="eyebrow">CATÁLOGO</div><h1>Produtos</h1><p>Cadastre, encontre e mantenha os itens da Bardega.</p></div>
        {mayManage && <Button asChild><Link to="/produtos/novo"><Plus size={16} /> Novo produto</Link></Button>}
      </div>
      <div className="catalog-toolbar">
        <Input label="Buscar por nome, código ou código de barras" type="search" placeholder="Digite para buscar" value={search} onChange={(event) => setSearch(event.target.value)} />
        <Select label="Categoria" value={category} onChange={(event) => setCategory(event.target.value)}><option value="">Todas</option>{categories.data?.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</Select>
        <Select label="Status" value={status} onChange={(event) => setStatus(event.target.value)}><option value="active">Ativos</option><option value="inactive">Inativos</option><option value="all">Todos</option></Select>
        <Button variant="secondary" asChild><Link to="/categorias">Categorias <ArrowRight size={15} /></Link></Button>
      </div>
      {products.isPending || categories.isPending ? <LoadingState /> :
        products.isError || categories.isError ? <ErrorState onRetry={() => { void products.refetch(); void categories.refetch(); }} /> :
        filtered.length === 0 ? <EmptyState title="Nenhum produto encontrado" description={search || category || status !== "active" ? "Ajuste os filtros para consultar o catálogo." : "Cadastre o primeiro produto para começar."} /> :
        <ResponsiveTable headings={["Produto", "Categoria", "Código", "Preço", "Status", "Ação"]}>
          {filtered.map((item) => <tr key={item.id}>
            <td><strong>{item.name}</strong><small className="catalog-subline">{item.is_composite ? "Composto · " : ""}{item.barcode || "Sem código de barras"}</small></td>
            <td>{names.get(item.category_id) || "—"}</td><td>{item.internal_code}</td>
            <td>{money.format(item.sale_price)}</td>
            <td><Badge tone={item.is_active ? "success" : "neutral"}>{item.is_active ? "Ativo" : "Inativo"}</Badge></td>
            <td><Button variant="ghost" asChild><Link to={`/produtos/${item.id}`}>Detalhes <ArrowRight size={15} /></Link></Button></td>
          </tr>)}
        </ResponsiveTable>}
      <p className="catalog-count">{filtered.length} produto{filtered.length === 1 ? "" : "s"} exibido{filtered.length === 1 ? "" : "s"}.</p>
    </div>
  );
}
