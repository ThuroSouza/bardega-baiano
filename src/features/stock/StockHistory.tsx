import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { EmptyState, ErrorState, LoadingState } from "../../components/ui/Feedback";
import { Select } from "../../components/ui/Select";
import type { StockItem, Supplier } from "./api";
import { listMovements } from "./api";
import { operationLabels } from "./labels";

const amount = (value: number) => new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 }).format(value);
const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const dateTime = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" });

export function StockHistory({ items, suppliers }: { items: StockItem[]; suppliers: Supplier[] }) {
  const [page, setPage] = useState(0);
  const [productId, setProductId] = useState("");
  const [type, setType] = useState("");
  const query = useQuery({ queryKey: ["stock-movements", page, productId, type], queryFn: () => listMovements(page, productId, type) });
  const products = new Map(items.map((item) => [item.id, item]));
  const supplierNames = new Map(suppliers.map((supplier) => [supplier.id, supplier.name]));
  return <div className="stock-section">
    <div className="stock-filters"><Select label="Produto" value={productId} onChange={(event) => { setProductId(event.target.value); setPage(0); }}><option value="">Todos</option>{items.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</Select>
      <Select label="Tipo" value={type} onChange={(event) => { setType(event.target.value); setPage(0); }}><option value="">Todos</option>{Object.entries(operationLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</Select></div>
    {query.isPending ? <LoadingState /> : query.isError ? <ErrorState onRetry={() => void query.refetch()} /> : query.data.rows.length === 0 ? <EmptyState title="Nenhuma movimentação" description="Os registros aparecerão após a primeira operação de estoque." /> :
      <div className="stock-history-list">{query.data.rows.map((movement) => {
        const product = products.get(movement.product_id);
        const signed = Number(movement.quantity);
        return <article className="stock-history-card" key={movement.id}>
          <div className="stock-history-heading"><div><strong>{product?.name ?? "Produto"}</strong><small>{dateTime.format(new Date(movement.created_at))} · {movement.operator_name}</small></div>
            <Badge tone={signed < 0 ? "danger" : signed > 0 ? "success" : "neutral"}>{operationLabels[movement.type]}</Badge></div>
          <div className="stock-history-figures"><strong className={signed < 0 ? "stock-negative" : ""}>{signed > 0 ? "+" : ""}{amount(signed)} {product?.unit ?? ""}</strong><span>{amount(Number(movement.previous_quantity))} → {amount(Number(movement.new_quantity))}</span></div>
          {(movement.reason || movement.notes || movement.supplier_id || movement.invoice_number) && <div className="stock-history-details">
            {movement.reason && <span><b>Motivo:</b> {movement.reason}</span>}
            {movement.supplier_id && <span><b>Fornecedor:</b> {supplierNames.get(movement.supplier_id) ?? "Fornecedor cadastrado"}</span>}
            {movement.invoice_number && <span><b>Nota:</b> {movement.invoice_number}</span>}
            {movement.unit_cost != null && <span><b>Custo:</b> {money.format(Number(movement.unit_cost))} / unidade · Total {money.format(Number(movement.total_cost))}</span>}
            {movement.notes && <span><b>Observação:</b> {movement.notes}</span>}
            <span><b>Data informada:</b> {movement.occurred_on.split("-").reverse().join("/")}</span>
          </div>}
        </article>;
      })}</div>}
    {query.data && query.data.count > 30 && <div className="stock-pagination"><Button variant="secondary" disabled={page === 0} onClick={() => setPage(page - 1)}>Anterior</Button><span>Página {page + 1} de {Math.ceil(query.data.count / 30)}</span><Button variant="secondary" disabled={(page + 1) * 30 >= query.data.count} onClick={() => setPage(page + 1)}>Próxima</Button></div>}
  </div>;
}
