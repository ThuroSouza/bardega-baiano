import { requireSupabase } from "../../lib/supabase";
import type { Permission } from "../../config/permissions";
import type { AppRole } from "../../types/auth";

export type ManagedUser = {
  id: string; email: string; display_name: string; role: AppRole;
  is_active: boolean; mfa_required: boolean; created_at: string;
  email_confirmed_at: string | null; last_sign_in_at: string | null; invited_at: string | null;
};

export async function listManagedUsers(search: string, page: number): Promise<{ rows: ManagedUser[]; total: number }> {
  const { data, error } = await requireSupabase().rpc("admin_list_users", {
    p_search: search.trim(), p_page: page, p_page_size: 25,
  });
  if (error) throw error;
  return data as { rows: ManagedUser[]; total: number };
}

export async function updateManagedUser(input: Pick<ManagedUser, "id" | "display_name" | "role" | "is_active">) {
  const { data, error } = await requireSupabase().rpc("admin_update_user", {
    p_user_id: input.id, p_display_name: input.display_name.trim(),
    p_role: input.role, p_is_active: input.is_active,
  });
  if (error) throw error;
  return data;
}

export async function inviteUser(input: { email: string; display_name: string; role: AppRole }) {
  const { data, error } = await requireSupabase().functions.invoke("invite-user", { body: input });
  if (error) {
    const response = "context" in error ? error.context : null;
    if (response instanceof Response) {
      const body = await response.json().catch(() => null);
      if (body?.error) throw new Error(String(body.error));
    }
    throw error;
  }
  if (data?.error) throw new Error(String(data.error));
  return data as { id: string };
}

export async function listRolePermissions(): Promise<{ role: AppRole; permission: Permission }[]> {
  const { data, error } = await requireSupabase().rpc("admin_role_permissions");
  if (error) throw error;
  return data ?? [];
}

export async function updateRolePermissions(role: Exclude<AppRole, "ADMIN">, granted: Permission[]) {
  const { data, error } = await requireSupabase().rpc("admin_set_role_permissions", {
    p_role: role, p_permissions: granted,
  });
  if (error) throw error;
  return data as Permission[];
}

export function usersError(error: unknown): string {
  const message = error && typeof error === "object" && "message" in error ? String(error.message) : "";
  const known: Record<string, string> = {
    users_permission_denied: "Somente ADMIN pode gerenciar usuários e permissões.",
    users_invalid_input: "Confira nome, e-mail e função.",
    users_invalid_filter: "Busca inválida. Use até 100 caracteres.",
    users_invalid_permissions: "Selecione permissões operacionais válidas para a função.",
    users_permission_dependency: "Algumas permissões exigem acesso ao módulo relacionado. Confira a seleção.",
    users_not_found: "Usuário não encontrado.",
    users_cannot_remove_self: "Você não pode desativar sua própria conta nem retirar sua função ADMIN.",
    origin_denied: "Este endereço do sistema não está autorizado para enviar convites.",
    function_not_configured: "O serviço de convites não está configurado.",
    invite_failed: "Não foi possível enviar o convite. Confira se o e-mail já está cadastrado e se o envio de e-mails está configurado.",
    invite_created_profile_update_failed: "O convite foi criado, mas a função não foi configurada. A conta permanece inativa; atualize a lista e corrija o perfil.",
    invite_rate_limited: "Espere um minuto antes de enviar outro convite. O limite é de cinco convites por hora.",
    invite_unavailable: "O serviço de convites está indisponível. Tente novamente mais tarde.",
  };
  if (known[message]) return known[message];
  if (error && typeof error === "object" && "code" in error && error.code === "42501") return known.users_permission_denied;
  return "Não foi possível concluir a operação.";
}
