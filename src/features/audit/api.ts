import { requireSupabase } from "../../lib/supabase";

export type AuditEvent = {
  id: string; user_id: string; actor_name: string; actor_email: string;
  action: string; entity: string; entity_id: string;
  before_data: Record<string, unknown>; after_data: Record<string, unknown>;
  context: Record<string, unknown>; created_at: string;
};
export type AuditFilters = { start: string; end: string; action: string; search: string; page: number };

export async function listAuditEvents(filters: AuditFilters): Promise<{ rows: AuditEvent[]; total: number }> {
  const { data, error } = await requireSupabase().rpc("admin_list_audit_events", {
    p_start: filters.start || null, p_end: filters.end || null,
    p_action: filters.action, p_search: filters.search.trim(),
    p_page: filters.page, p_page_size: 25,
  });
  if (error) throw error;
  return data as { rows: AuditEvent[]; total: number };
}

export async function listAuditActions(): Promise<string[]> {
  const { data, error } = await requireSupabase().rpc("admin_audit_actions");
  if (error) throw error;
  return data ?? [];
}

export function auditError(error: unknown): string {
  const message = error && typeof error === "object" && "message" in error ? String(error.message) : "";
  if (message === "audit_permission_denied" || (error && typeof error === "object" && "code" in error && error.code === "42501"))
    return "Somente ADMIN pode consultar a auditoria.";
  if (message === "audit_invalid_filter") return "Confira o período e os filtros da busca.";
  return "Não foi possível carregar a auditoria.";
}
