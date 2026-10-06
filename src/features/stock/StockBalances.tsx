import { useMemo, useState } from "react";
import { ClipboardCheck, Plus } from "lucide-react";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { EmptyState } from "../../components/ui/Feedback";
import { Input } from "../../components/ui/Input";
import { Select } from "../../components/ui/Select";
import type { StockItem } from "./api";

const amount = (value: number) => new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 }).format(value);
function low(item: StockItem) { return item.is_active && item.minimum_stock > 0 && item.quantity <= item.minimum_stock; }

export function StockBalances({ items, canManage, onAction }: {
  items: StockItem[]; canManage: boolean; onAction: (type: "ENTRADA" | "INVENTARIO", productId: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("active");
  const filtered = useMemo(() => items.filter((item) => {
    const text = search.trim().toLocaleLowerCase("pt-BR");
    return (!text || [item.name, item.internal_code, item.barcode ?? ""].some((value) => value.toLocaleLowerCase("pt-BR").includes(text)))
      && (filter === "all" || (filter === "active" && item.is_active) || (filter === "low" && low(item)) || (filter === "out" && item.is_active && item.quantity === 0));
  }), [items, search, filter]);
  return <div className="stock-section">
    <div className="stock-filters"><Input label="Buscar produto ou código" type="search" placeholder="Nome, código interno ou barras" value={search} onChange={(event) => setSearch(event.target.value)} />
      <Select label="Mostrar" value={filter} onChange={(event) => setFilter(event.target.value)}><option value="active">Ativos</option><option value="low">Estoque baixo</option><option value="out">Esgotados</option><option value="all">Todos</option></Select></div>
    {filtered.length === 0 ? <EmptyState title="Nenhum produto encontrado" description="Ajuste os filtros ou cadastre um produto." /> :
      <div className="stock-balance-list">
        {filtered.map((item) => <article className="stock-balance-card" key={item.id}>
          <div className="stock-balance-main"><div><strong>{item.name}</strong><small>{item.internal_code} · {item.unit}</small></div>
            <Badge tone={item.quantity === 0 ? "danger" : low(item) ? "amber" : item.is_active ? "success" : "neutral"}>{item.quantity === 0 ? "Esgotado" : low(item) ? "Estoque baixo" : item.is_active ? "Normal" : "Inativo"}</Badge></div>
          <div className="stock-balance-bottom"><div className="stock-balance-number"><span>Saldo</span><strong>{amount(item.quantity)} <small>{item.unit}</small></strong></div><div className="stock-balance-number"><span>Mínimo</span><strong>{amount(item.minimum_stock)} <small>{item.unit}</small></strong></div>
            {canManage && <div className="stock-card-actions"><Button variant="secondary" onClick={() => onAction("ENTRADA", item.id)}><span className="button-content"><Plus size={15} /> Entrada</span></Button><Button variant="ghost" onClick={() => onAction("INVENTARIO", item.id)}><span className="button-content"><ClipboardCheck size={15} /> Contar</span></Button></div>}</div>
        </article>)}
      </div>}
    <p className="catalog-count">{filtered.length} produto{filtered.length === 1 ? "" : "s"} exibido{filtered.length === 1 ? "" : "s"}.</p>
  </div>;
}
