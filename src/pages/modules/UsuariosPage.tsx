import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { EmptyState, ErrorState, LoadingState } from "../../components/ui/Feedback";
import { Input } from "../../components/ui/Input";
import { Modal } from "../../components/ui/Modal";
import { ResponsiveTable } from "../../components/ui/ResponsiveTable";
import { Select } from "../../components/ui/Select";
import type { Permission } from "../../config/permissions";
import { inviteUser, listManagedUsers, listRolePermissions, updateManagedUser, updateRolePermissions, usersError } from "../../features/users/api";
import type { ManagedUser } from "../../features/users/api";
import { useAuth } from "../../hooks/useAuth";
import type { AppRole } from "../../types/auth";

const roleNames: Record<AppRole, string> = { ADMIN: "Administrador", GERENTE: "Gerente", CAIXA: "Caixa", ESTOQUE: "Estoque" };
const editableRoles = ["GERENTE", "CAIXA", "ESTOQUE"] as const;
const groups: { title: string; items: { permission: Permission; label: string }[] }[] = [
  { title: "Visão geral", items: [{ permission: "dashboard.read", label: "Ver dashboard" }] },
  { title: "Vendas e caixa", items: [
    { permission: "pdv.use", label: "Usar PDV" }, { permission: "sales.read", label: "Consultar vendas" },
    { permission: "sales.discount", label: "Aplicar descontos" }, { permission: "sales.cancel", label: "Aprovar cancelamentos" },
    { permission: "cash.manage", label: "Operar caixa" }, { permission: "cash.view_all", label: "Ver todos os caixas" },
  ] },
  { title: "Estoque e catálogo", items: [
    { permission: "stock.read", label: "Consultar estoque" }, { permission: "stock.manage", label: "Movimentar estoque" },
    { permission: "products.read", label: "Consultar produtos" }, { permission: "products.manage", label: "Gerenciar produtos" },
  ] },
  { title: "Financeiro e relatórios", items: [
    { permission: "finance.read", label: "Consultar financeiro" }, { permission: "finance.manage", label: "Gerenciar financeiro" },
    { permission: "reports.read", label: "Consultar relatórios" },
  ] },
];
const dateTime = (value: string | null) => value ? new Date(value).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "—";

type InviteDraft = { email: string; display_name: string; role: AppRole };
const emptyInvite: InviteDraft = { email: "", display_name: "", role: "CAIXA" };

export default function UsuariosPage() {
  const auth = useAuth();
  const client = useQueryClient();
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [page, setPage] = useState(0);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteDraft, setInviteDraft] = useState<InviteDraft>(emptyInvite);
  const [editing, setEditing] = useState<ManagedUser | null>(null);
  const [editDraft, setEditDraft] = useState<Pick<ManagedUser, "id" | "display_name" | "role" | "is_active"> | null>(null);
  const [selectedRole, setSelectedRole] = useState<typeof editableRoles[number]>("GERENTE");
  const [permissionDraft, setPermissionDraft] = useState<Permission[] | null>(null);
  const [error, setError] = useState("");
  const users = useQuery({ queryKey: ["managed-users", appliedSearch, page], queryFn: () => listManagedUsers(appliedSearch, page), enabled: auth.profile?.role === "ADMIN" });
  const matrix = useQuery({ queryKey: ["role-permissions"], queryFn: listRolePermissions, enabled: auth.profile?.role === "ADMIN" });
  const currentPermissions = (matrix.data ?? []).filter((row) => row.role === selectedRole).map((row) => row.permission);
  const selectedPermissions = permissionDraft ?? currentPermissions;
  const inviteMutation = useMutation({
    mutationFn: () => inviteUser(inviteDraft),
    onSuccess: () => {
      setInviteOpen(false); setInviteDraft(emptyInvite); setError("");
      void client.invalidateQueries({ queryKey: ["managed-users"] });
      toast.success("Convite enviado. A conta permanece inativa até ser ativada por um ADMIN.");
    },
    onError: (reason) => setError(usersError(reason)),
  });
  const editMutation = useMutation({
    mutationFn: () => updateManagedUser(editDraft!),
    onSuccess: async () => {
      if (editDraft?.id === auth.user?.id) await auth.refresh();
      setEditing(null); setEditDraft(null); setError("");
      void client.invalidateQueries({ queryKey: ["managed-users"] });
      toast.success("Acesso do usuário atualizado.");
    },
    onError: (reason) => setError(usersError(reason)),
  });
  const permissionMutation = useMutation({
    mutationFn: () => updateRolePermissions(selectedRole, selectedPermissions),
    onSuccess: () => {
      setPermissionDraft(null); setError("");
      void client.invalidateQueries({ queryKey: ["role-permissions"] });
      toast.success(`Permissões de ${roleNames[selectedRole]} atualizadas.`);
    },
    onError: (reason) => setError(usersError(reason)),
  });
  if (auth.profile?.role !== "ADMIN") return <ErrorState message="Somente ADMIN pode acessar usuários e permissões." />;
  const openEdit = (user: ManagedUser) => {
    setEditing(user); setEditDraft({ id: user.id, display_name: user.display_name, role: user.role, is_active: user.is_active }); setError("");
  };
  return <div className="page-stack users-page">
    <div className="page-heading"><div><div className="eyebrow">SISTEMA · ACESSO</div><h1>Usuários e permissões</h1><p>Convide funcionários, controle o acesso e defina o que cada função pode fazer.</p></div><Button onClick={() => { setError(""); setInviteOpen(true); }}><Plus size={16} /> Convidar usuário</Button></div>
    <Card className="users-panel"><div className="users-section-heading"><div><h2>Equipe</h2><p>Contas são desativadas quando alguém deixa a equipe; o histórico permanece.</p></div></div>
      <form className="users-search" onSubmit={(event) => { event.preventDefault(); setPage(0); setAppliedSearch(search); }}><Input label="Buscar por nome ou e-mail" type="search" maxLength={100} value={search} onChange={(event) => setSearch(event.target.value)} /><Button type="submit" variant="secondary">Buscar</Button></form>
      {users.isPending ? <LoadingState /> : users.isError ? <ErrorState message={usersError(users.error)} onRetry={() => void users.refetch()} /> : users.data.rows.length === 0 ? <EmptyState title="Nenhum usuário encontrado" description="Altere a busca ou convide o primeiro funcionário." /> :
        <ResponsiveTable headings={["Usuário", "Função", "Acesso", "Convite", "Último acesso", "Ação"]}>{users.data.rows.map((user) => <tr key={user.id}>
          <td><strong>{user.display_name || "Sem nome"}</strong><small className="users-subline">{user.email}</small></td>
          <td>{roleNames[user.role]}</td><td><Badge tone={user.is_active ? "success" : "neutral"}>{user.is_active ? "Ativo" : "Inativo"}</Badge></td>
          <td>{user.email_confirmed_at ? "Confirmado" : "Pendente"}</td><td>{dateTime(user.last_sign_in_at)}</td>
          <td><Button variant="ghost" onClick={() => openEdit(user)}>Gerenciar</Button></td>
        </tr>)}</ResponsiveTable>}
      <div className="users-pagination"><span>{users.data?.total ?? 0} usuário(s)</span><div><Button variant="secondary" disabled={page === 0} onClick={() => setPage(page - 1)}>Anterior</Button><span>Página {page + 1}</span><Button variant="secondary" disabled={!users.data || (page + 1) * 25 >= users.data.total} onClick={() => setPage(page + 1)}>Próxima</Button></div></div>
    </Card>
    <Card className="users-panel"><div className="users-section-heading"><div><h2><ShieldCheck size={18} /> Permissões por função</h2><p>Alterações valem para todos os usuários da função. ADMIN mantém acesso integral e não é editável aqui.</p></div></div>
      <Select label="Função" value={selectedRole} onChange={(event) => { setSelectedRole(event.target.value as typeof selectedRole); setPermissionDraft(null); setError(""); }}>{editableRoles.map((role) => <option key={role} value={role}>{roleNames[role]}</option>)}</Select>
      {matrix.isPending ? <LoadingState /> : matrix.isError ? <ErrorState message={usersError(matrix.error)} onRetry={() => void matrix.refetch()} /> : <>
        <div className="users-permission-grid">{groups.map((group) => <fieldset key={group.title}><legend>{group.title}</legend>{group.items.map(({ permission, label }) => <label key={permission} className="users-permission"><input type="checkbox" checked={selectedPermissions.includes(permission)} disabled={permissionMutation.isPending} onChange={(event) => setPermissionDraft(event.target.checked ? [...selectedPermissions, permission] : selectedPermissions.filter((item) => item !== permission))} /><span>{label}</span></label>)}</fieldset>)}</div>
        <p className="users-help">Permissões de gestão exigem a consulta do módulo. Dashboard exige leitura financeira; relatórios exigem vendas, estoque, financeiro e todos os caixas. Acesso a usuários, auditoria e configurações permanece exclusivo de ADMIN.</p>
        {error && !inviteOpen && !editing && <p className="catalog-error" role="alert">{error}</p>}
        <div className="users-save"><Button disabled={permissionDraft === null || permissionMutation.isPending} onClick={() => { setError(""); permissionMutation.mutate(); }}>{permissionMutation.isPending ? "Salvando..." : "Salvar permissões"}</Button></div>
      </>}
    </Card>
    <Modal title="Convidar usuário" description="O funcionário receberá um link para criar a própria senha. A conta ficará inativa até você ativá-la." open={inviteOpen} onOpenChange={(open) => { if (!inviteMutation.isPending) { setInviteOpen(open); setError(""); } }}>
      <form className="users-modal-form" onSubmit={(event) => { event.preventDefault(); setError(""); inviteMutation.mutate(); }}>
        <Input label="Nome" required minLength={2} maxLength={120} value={inviteDraft.display_name} onChange={(event) => setInviteDraft({ ...inviteDraft, display_name: event.target.value })} />
        <Input label="E-mail" type="email" required maxLength={254} autoComplete="off" value={inviteDraft.email} onChange={(event) => setInviteDraft({ ...inviteDraft, email: event.target.value })} />
        <Select label="Função" value={inviteDraft.role} onChange={(event) => setInviteDraft({ ...inviteDraft, role: event.target.value as AppRole })}>{(Object.keys(roleNames) as AppRole[]).map((role) => <option key={role} value={role}>{roleNames[role]}</option>)}</Select>
        {error && <p className="catalog-error" role="alert">{error}</p>}
        <div className="dialog-actions"><Button type="button" variant="secondary" disabled={inviteMutation.isPending} onClick={() => setInviteOpen(false)}>Voltar</Button><Button type="submit" disabled={inviteMutation.isPending}>{inviteMutation.isPending ? "Enviando..." : "Enviar convite"}</Button></div>
      </form>
    </Modal>
    <Modal title="Gerenciar usuário" description={editing?.email} open={Boolean(editing)} onOpenChange={(open) => { if (!open && !editMutation.isPending) { setEditing(null); setEditDraft(null); setError(""); } }}>
      {editing && editDraft && <form className="users-modal-form" onSubmit={(event) => { event.preventDefault(); setError(""); editMutation.mutate(); }}>
        <Input label="Nome" required minLength={2} maxLength={120} value={editDraft.display_name} onChange={(event) => setEditDraft({ ...editDraft, display_name: event.target.value })} />
        <Select label="Função" disabled={editing.id === auth.user?.id} value={editDraft.role} onChange={(event) => setEditDraft({ ...editDraft, role: event.target.value as AppRole })}>{(Object.keys(roleNames) as AppRole[]).map((role) => <option key={role} value={role}>{roleNames[role]}</option>)}</Select>
        <label className="users-active"><input type="checkbox" checked={editDraft.is_active} disabled={editing.id === auth.user?.id} onChange={(event) => setEditDraft({ ...editDraft, is_active: event.target.checked })} /> Acesso ativo</label>
        {!editing.email_confirmed_at && <p className="users-help">O convite ainda não foi confirmado. O usuário poderá definir a senha pelo link recebido.</p>}
        {error && <p className="catalog-error" role="alert">{error}</p>}
        <div className="dialog-actions"><Button type="button" variant="secondary" disabled={editMutation.isPending} onClick={() => { setEditing(null); setEditDraft(null); }}>Voltar</Button><Button type="submit" disabled={editMutation.isPending}>{editMutation.isPending ? "Salvando..." : "Salvar usuário"}</Button></div>
      </form>}
    </Modal>
  </div>;
}
