import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, ClipboardList, PackagePlus, TriangleAlert } from "lucide-react";
import { Link } from "react-router";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { ErrorState, LoadingState } from "../../components/ui/Feedback";
import { can } from "../../config/permissions";
import { StockBalances } from "../../features/stock/StockBalances";
import { StockHistory } from "../../features/stock/StockHistory";
import { StockMovementDialog } from "../../features/stock/StockMovementDialog";
import { listStockItems, listSuppliers } from "../../features/stock/api";
import { useAuth } from "../../hooks/useAuth";

type Action = { type: "ENTRADA" | "SAIDA" | "AJUSTE" | "PERDA" | "AVARIA" | "INVENTARIO"; productId: string; key: string };
export default function EstoquePage() {
  const auth = useAuth();
  const mayManage = Boolean(auth.profile && can(auth.permissions, "stock.manage"));
  const stock = useQuery({ queryKey: ["stock"], queryFn: listStockItems });
  const suppliers = useQuery({ queryKey: ["suppliers"], queryFn: listSuppliers });
  const [tab, setTab] = useState<"balances" | "history">("balances");
  const [action, setAction] = useState<Action | null>(null);
  const items = stock.data ?? [];
  const active = items.filter((item) => item.is_active);
  const low = active.filter((item) => item.minimum_stock > 0 && item.quantity <= item.minimum_stock);
  const out = active.filter((item) => item.quantity === 0);
  function open(type: Action["type"], productId = "") {
    setAction({ type, productId, key: crypto.randomUUID() });
  }
  return <div className="page-stack">
    <div className="page-heading"><div><div className="eyebrow">OPERAÇÃO</div><h1>Estoque</h1><p>Saldos, entradas, perdas e inventário com histórico completo.</p></div>
      {mayManage && stock.data && (items.length ? <Button onClick={() => open("ENTRADA")}><span className="button-content"><PackagePlus size={17} /> Movimentar estoque</span></Button> : <Button asChild><Link to="/produtos/novo">Cadastrar primeiro produto</Link></Button>)}</div>
    {stock.isPending || suppliers.isPending ? <LoadingState /> : stock.isError || suppliers.isError ?
      <ErrorState onRetry={() => { void stock.refetch(); void suppliers.refetch(); }} /> : <>
        <div className="stock-summary-grid"><Card className="stock-summary-card"><span>Produtos ativos</span><strong>{active.length}</strong><small>Itens cadastrados</small></Card>
          <Card className="stock-summary-card"><span>Estoque baixo</span><strong className={low.length ? "stock-warning" : ""}>{low.length}</strong><small>Saldo no mínimo ou abaixo</small></Card>
          <Card className="stock-summary-card"><span>Esgotados</span><strong className={out.length ? "stock-negative" : ""}>{out.length}</strong><small>Saldo zerado</small></Card></div>
        {low.length > 0 && <Card className="stock-alert"><TriangleAlert size={19} /><div><strong>Produtos precisam de reposição</strong><p>{low.slice(0, 3).map((item) => `${item.name}: ${item.quantity}/${item.minimum_stock} ${item.unit}`).join(" · ")}{low.length > 3 ? ` e mais ${low.length - 3}` : ""}</p></div></Card>}
        <div className="stock-links"><Button variant="secondary" asChild><Link to="/fornecedores">Fornecedores <ArrowRight size={15} /></Link></Button><Button variant="secondary" asChild><Link to="/produtos">Produtos e mínimos <ArrowRight size={15} /></Link></Button></div>
        {mayManage && items.length > 0 && <div className="stock-quick-actions"><Button variant="secondary" onClick={() => open("PERDA")}>Registrar perda</Button><Button variant="secondary" onClick={() => open("AVARIA")}>Registrar avaria</Button><Button variant="secondary" onClick={() => open("SAIDA")}>Saída manual</Button><Button variant="secondary" onClick={() => open("INVENTARIO")}><span className="button-content"><ClipboardList size={15} /> Inventário</span></Button><Button variant="secondary" onClick={() => open("AJUSTE")}>Ajuste manual</Button></div>}
        <div className="stock-tabs" role="tablist" aria-label="Visualização do estoque"><button type="button" role="tab" aria-selected={tab === "balances"} className={tab === "balances" ? "active" : ""} onClick={() => setTab("balances")}>Saldos</button><button type="button" role="tab" aria-selected={tab === "history"} className={tab === "history" ? "active" : ""} onClick={() => setTab("history")}>Movimentações</button></div>
        {tab === "balances" ? <StockBalances items={items} canManage={mayManage} onAction={open} /> : <StockHistory items={items} suppliers={suppliers.data ?? []} />}
      </>}
    {action && stock.data && suppliers.data && <StockMovementDialog key={action.key} open onOpenChange={(next) => { if (!next) setAction(null); }} items={items} suppliers={suppliers.data} initialProductId={action.productId} initialType={action.type} />}
  </div>;
}
