import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { EmptyState, ErrorState, LoadingState } from "../../components/ui/Feedback";
import { Input } from "../../components/ui/Input";
import { ResponsiveTable } from "../../components/ui/ResponsiveTable";
import { Select } from "../../components/ui/Select";
import { auditError, listAuditActions, listAuditEvents } from "../../features/audit/api";
import type { AuditFilters } from "../../features/audit/api";
import { useAuth } from "../../hooks/useAuth";

const actionLabels: Record<string, string> = {
  LOGIN: "Login", PRODUCT_PRICE_CHANGED: "Preço alterado", PRODUCT_RECIPE_UPDATED: "Ficha técnica alterada",
  SALE_COMPLETED: "Venda finalizada", SALE_CANCELLED: "Venda cancelada",
  SALE_CANCELLATION_REQUESTED: "Cancelamento solicitado", SALE_CANCELLATION_REJECTED: "Cancelamento recusado",
  CASH_OPENED: "Caixa aberto", CASH_CLOSED: "Caixa fechado", CASH_SUPPLY: "Suprimento", CASH_WITHDRAWAL: "Sangria",
  STOCK_ENTRADA: "Entrada de estoque", STOCK_SAIDA: "Saída de estoque", STOCK_AJUSTE: "Ajuste de estoque",
  STOCK_PERDA: "Perda de estoque", STOCK_AVARIA: "Avaria", STOCK_INVENTARIO: "Inventário",
  FINANCE_EXPENSE_CREATED: "Despesa criada", FINANCE_EXPENSE_UPDATED: "Despesa alterada",
  FINANCE_EXPENSE_PAID: "Despesa paga", FINANCE_EXPENSE_CANCELLED: "Despesa cancelada",
  FINANCE_RECEIVABLE_CREATED: "Conta a receber criada", FINANCE_RECEIVABLE_RECEIVED: "Conta recebida",
  FINANCE_RECEIVABLE_CANCELLED: "Conta cancelada", FINANCE_REVENUE_CREATED: "Receita criada",
  FINANCE_REVENUE_REVERSED: "Receita estornada", USER_ACCESS_UPDATED: "Acesso de usuário alterado",
  ROLE_PERMISSIONS_UPDATED: "Permissões alteradas",
};
const entityLabels: Record<string, string> = {
  profiles: "Usuário", products: "Produto", sales: "Venda", stock_movements: "Estoque",
  cash_sessions: "Caixa", cash_movements: "Movimento de caixa", financial_expenses: "Despesa",
  financial_receivables: "Conta a receber", financial_entries: "Receita", role_permissions: "Função",
};
const dateTime = (value: string) => new Date(value).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
const initial: AuditFilters = { start: "", end: "", action: "", search: "", page: 0 };
const hasData = (value: Record<string, unknown>) => Object.keys(value).length > 0;

export default function AuditoriaPage() {
  const auth = useAuth();
  const [draft, setDraft] = useState<AuditFilters>(initial);
  const [filters, setFilters] = useState<AuditFilters>(initial);
  const events = useQuery({ queryKey: ["audit-events", filters], queryFn: () => listAuditEvents(filters), enabled: auth.profile?.role === "ADMIN" });
  const actions = useQuery({ queryKey: ["audit-actions"], queryFn: listAuditActions, enabled: auth.profile?.role === "ADMIN" });
  if (auth.profile?.role !== "ADMIN") return <ErrorState message="Somente ADMIN pode consultar a auditoria." />;
  const dateInvalid = Boolean(draft.start && draft.end && draft.end < draft.start);
  return <div className="page-stack audit-page">
    <div className="page-heading"><div><div className="eyebrow">SISTEMA · HISTÓRICO</div><h1>Auditoria</h1><p>Consulte quem fez cada operação sensível e os dados registrados no momento da mudança.</p></div></div>
    <Card className="audit-panel"><h2>Filtrar eventos</h2><form className="audit-filters" onSubmit={(event) => { event.preventDefault(); if (!dateInvalid) setFilters({ ...draft, page: 0 }); }}>
      <Input label="De" type="date" value={draft.start} onChange={(event) => setDraft({ ...draft, start: event.target.value })} />
      <Input label="Até" type="date" value={draft.end} onChange={(event) => setDraft({ ...draft, end: event.target.value })} />
      <Select label="Ação" value={draft.action} onChange={(event) => setDraft({ ...draft, action: event.target.value })}><option value="">Todas as ações</option>{(actions.data ?? []).map((action) => <option key={action} value={action}>{actionLabels[action] ?? action}</option>)}</Select>
      <Input label="Usuário ou ID da entidade" type="search" maxLength={100} value={draft.search} onChange={(event) => setDraft({ ...draft, search: event.target.value })} />
      <Button type="submit">Aplicar filtros</Button><Button type="button" variant="secondary" onClick={() => { setDraft(initial); setFilters(initial); }}>Limpar</Button>
    </form>{dateInvalid && <p className="catalog-error" role="alert">A data final deve ser igual ou posterior à inicial.</p>}</Card>
    <Card className="audit-panel"><div className="audit-results-head"><h2>Eventos registrados</h2><span>{events.data?.total ?? 0} evento(s)</span></div>
      {events.isPending || actions.isPending ? <LoadingState /> : events.isError || actions.isError ? <ErrorState message={auditError(events.error ?? actions.error)} onRetry={() => { void events.refetch(); void actions.refetch(); }} /> : events.data.rows.length === 0 ? <EmptyState title="Nenhum evento encontrado" description="Altere os filtros ou aguarde a próxima operação registrada." /> :
        <ResponsiveTable headings={["Data e hora", "Ação", "Usuário", "Entidade", "Detalhes"]}>{events.data.rows.map((item) => <tr key={item.id}>
          <td>{dateTime(item.created_at)}</td><td><Badge tone={item.action.includes("CANCEL") || item.action.includes("PERDA") ? "amber" : "neutral"}>{actionLabels[item.action] ?? item.action}</Badge></td>
          <td><strong>{item.actor_name}</strong><small className="audit-subline">{item.actor_email}</small></td>
          <td>{entityLabels[item.entity] ?? item.entity}<small className="audit-subline audit-id">{item.entity_id}</small></td>
          <td><details className="audit-details"><summary>Ver registro</summary><div><span>ID do evento</span><code>{item.id}</code></div>{hasData(item.before_data) && <div><span>Antes</span><pre>{JSON.stringify(item.before_data, null, 2)}</pre></div>}{hasData(item.after_data) && <div><span>Depois</span><pre>{JSON.stringify(item.after_data, null, 2)}</pre></div>}{hasData(item.context) && <div><span>Contexto disponível</span><pre>{JSON.stringify(item.context, null, 2)}</pre></div>}</details></td>
        </tr>)}</ResponsiveTable>}
      <div className="users-pagination"><span>Mostrando até 25 por página</span><div><Button variant="secondary" disabled={filters.page === 0} onClick={() => setFilters({ ...filters, page: filters.page - 1 })}>Anterior</Button><span>Página {filters.page + 1}</span><Button variant="secondary" disabled={!events.data || (filters.page + 1) * 25 >= events.data.total} onClick={() => setFilters({ ...filters, page: filters.page + 1 })}>Próxima</Button></div></div>
    </Card>
    <p className="audit-note">O contexto HTTP disponível pode variar. Eventos de integração bancária aparecerão quando uma conexão for implementada. Tentativas de login recusadas são consultadas nos logs de Auth do Supabase.</p>
  </div>;
}
