import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Pencil, Plus } from "lucide-react";
import { Link } from "react-router";
import { toast } from "sonner";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { EmptyState, ErrorState, LoadingState } from "../../components/ui/Feedback";
import { Input } from "../../components/ui/Input";
import { Modal } from "../../components/ui/Modal";
import { ResponsiveTable } from "../../components/ui/ResponsiveTable";
import { can } from "../../config/permissions";
import { useAuth } from "../../hooks/useAuth";
import { catalogError, listCategories, saveCategory } from "../../features/catalog/api";
import type { Category, CategoryInput } from "../../features/catalog/api";

const blank: CategoryInput = { name: "", description: "", is_active: true };

export default function CategoriasPage() {
  const auth = useAuth();
  const mayManage = Boolean(auth.profile && can(auth.permissions, "products.manage"));
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ["categories"], queryFn: listCategories });
  const [editing, setEditing] = useState<Category | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<CategoryInput>(blank);
  const [error, setError] = useState("");
  const mutation = useMutation({
    mutationFn: () => saveCategory({
      name: form.name.trim(), description: form.description.trim(), is_active: form.is_active,
    }, editing?.id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["categories"] });
      toast.success(editing ? "Categoria atualizada." : "Categoria cadastrada.");
      setOpen(false);
    },
    onError: (reason) => setError(catalogError(reason)),
  });
  function start(item?: Category) {
    setEditing(item ?? null);
    setForm(item ? { name: item.name, description: item.description, is_active: item.is_active } : blank);
    setError("");
    setOpen(true);
  }
  return (
    <div className="page-stack">
      <Link to="/produtos" className="back-link"><ArrowLeft size={17} /> Voltar aos produtos</Link>
      <div className="page-heading">
        <div><div className="eyebrow">CATÁLOGO</div><h1>Categorias</h1><p>Organize o catálogo com categorias que você pode editar e desativar.</p></div>
        {mayManage && <Button onClick={() => start()}><Plus size={16} /> Nova categoria</Button>}
      </div>
      {query.isPending ? <LoadingState /> : query.isError ? <ErrorState onRetry={() => void query.refetch()} /> :
        query.data.length === 0 ? <EmptyState title="Nenhuma categoria" description="Crie a primeira categoria para organizar seus produtos." /> :
        <ResponsiveTable headings={["Categoria", "Descrição", "Status", "Ação"]}>
          {query.data.map((item) => <tr key={item.id}>
            <td><strong>{item.name}</strong></td><td>{item.description || "—"}</td>
            <td><Badge tone={item.is_active ? "success" : "neutral"}>{item.is_active ? "Ativa" : "Inativa"}</Badge></td>
            <td>{mayManage && <Button variant="ghost" onClick={() => start(item)}><Pencil size={15} /> Editar</Button>}</td>
          </tr>)}
        </ResponsiveTable>}
      <Modal title={editing ? "Editar categoria" : "Nova categoria"} open={open} onOpenChange={setOpen}>
        <form className="catalog-form" onSubmit={(event) => { event.preventDefault(); setError(""); mutation.mutate(); }}>
          <Input label="Nome" required minLength={2} maxLength={80} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
          <div className="field"><label htmlFor="category-description">Descrição</label><textarea id="category-description" maxLength={500} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></div>
          <label className="catalog-check"><input type="checkbox" checked={form.is_active} onChange={(event) => setForm({ ...form, is_active: event.target.checked })} /> Categoria ativa</label>
          {error && <p className="catalog-error" role="alert">{error}</p>}
          <div className="dialog-actions"><Button variant="secondary" type="button" onClick={() => setOpen(false)}>Cancelar</Button><Button type="submit" disabled={mutation.isPending}>{mutation.isPending ? "Salvando..." : "Salvar categoria"}</Button></div>
        </form>
      </Modal>
    </div>
  );
}
