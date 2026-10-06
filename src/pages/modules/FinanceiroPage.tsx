import { useQuery } from "@tanstack/react-query";
import { ArrowRight, BarChart3, CircleAlert, Receipt, TrendingDown, TrendingUp, WalletCards } from "lucide-react";
import { Link } from "react-router";
import { Card } from "../../components/ui/Card";
import { ErrorState, LoadingState } from "../../components/ui/Feedback";
import { financeError, getFinanceAlerts } from "../../features/finance/api";
import { FinanceNav } from "../../features/finance/FinanceNav";

const sections = [
  { label: "Resultado", description: "Lucro, prejuízo, CMV e margem por período", path: "/financeiro/resultado", icon: BarChart3 },
  { label: "Receitas", description: "Vendas e outras entradas confirmadas", path: "/financeiro/receitas", icon: TrendingUp },
  { label: "Despesas", description: "Lançamentos e pagamentos da operação", path: "/financeiro/despesas", icon: TrendingDown },
  { label: "Contas a pagar", description: "Vencimentos e baixas", path: "/financeiro/contas-pagar", icon: Receipt },
  { label: "Contas a receber", description: "Cobranças e entradas futuras", path: "/financeiro/contas-receber", icon: WalletCards },
];
export default function FinanceiroPage() {
  const alerts = useQuery({ queryKey: ["finance-alerts"], queryFn: getFinanceAlerts });
  return <div className="page-stack">
    <div className="page-heading"><div><div className="eyebrow">GESTÃO</div><h1>Financeiro</h1><p>Receitas, despesas e compromissos em um só lugar.</p></div></div>
    <FinanceNav />
    {alerts.isPending ? <LoadingState label="Consultando vencimentos..." /> : alerts.isError ? <ErrorState message={financeError(alerts.error)} onRetry={() => void alerts.refetch()} /> : <div className="finance-alert-grid"><Link to="/financeiro/contas-pagar" className="finance-alert-card"><CircleAlert size={20} /><span><strong>{alerts.data.overdueExpenses}</strong> conta{alerts.data.overdueExpenses === 1 ? "" : "s"} a pagar atrasada{alerts.data.overdueExpenses === 1 ? "" : "s"}</span><ArrowRight size={16} /></Link><Link to="/financeiro/contas-receber" className="finance-alert-card"><CircleAlert size={20} /><span><strong>{alerts.data.overdueReceivables}</strong> conta{alerts.data.overdueReceivables === 1 ? "" : "s"} a receber atrasada{alerts.data.overdueReceivables === 1 ? "" : "s"}</span><ArrowRight size={16} /></Link></div>}
    <div className="finance-section-grid">{sections.map(({ label, description, path, icon: Icon }) => <Link to={path} key={path}><Card className="finance-section-card"><Icon size={23} /><div><h2>{label}</h2><p>{description}</p></div><ArrowRight size={17} /></Card></Link>)}</div>
    <p className="finance-disclaimer">Os lançamentos desta área registram compromissos e recebimentos. Pagamentos em dinheiro retirados da gaveta também precisam de sangria no caixa.</p>
  </div>;
}
