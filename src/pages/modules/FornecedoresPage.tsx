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
import { listSuppliers, saveSupplier, stockError } from "../../features/stock/api";
import type { Supplier, SupplierInput } from "../../features/stock/api";

const blank: SupplierInput = { name: "", phone: "", email: "", notes: "", is_active: true };
export default function FornecedoresPage() {
  const auth = useAuth();
  const mayManage = Boolean(auth.profile && can(auth.permissions, "stock.manage"));
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ["suppliers"], queryFn: listSuppliers });
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<SupplierInput>(blank);
  const [error, setError] = useState("");
  const mutation = useMutation({
    mutationFn: () => saveSupplier({
      name: form.name.trim(), phone: form.phone.trim(), email: form.email.trim(),
      notes: form.notes.trim(), is_active: form.is_active,
    }, editing?.id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["suppliers"] });
      toast.success(editing ? "Fornecedor atualizado." : "Fornecedor cadastrado.");
      setOpen(false);
    },
    onError: (reason) => setError(stockError(reason)),
  });
  function start(item?: Supplier) {
    setEditing(item ?? null);
    setForm(item ? { name: item.name, phone: item.phone, email: item.email, notes: item.notes, is_active: item.is_active } : blank);
    setError(""); setOpen(true);
  }
  return <div className="page-stack">
    <Link to="/estoque" className="back-link"><ArrowLeft size={17} /> Voltar ao estoque</Link>
    <div className="page-heading"><div><div className="eyebrow">CADASTROS</div><h1>Fornecedores</h1><p>Organize os parceiros usados nas entradas de mercadoria.</p></div>
      {mayManage && <Button onClick={() => start()}><span className="button-content"><Plus size={16} /> Novo fornecedor</span></Button>}
    </div>
    {query.isPending ? <LoadingState /> : query.isError ? <ErrorState onRetry={() => void query.refetch()} /> : query.data.length === 0 ?
      <EmptyState title="Nenhum fornecedor" description="Cadastre um fornecedor para associá-lo às entradas." /> :
      <ResponsiveTable headings={["Fornecedor", "Contato", "Status", "Ação"]}>
        {query.data.map((item) => <tr key={item.id}><td><strong>{item.name}</strong></td><td>{item.phone || item.email || "—"}</td>
          <td><Badge tone={item.is_active ? "success" : "neutral"}>{item.is_active ? "Ativo" : "Inativo"}</Badge></td>
          <td>{mayManage && <Button variant="ghost" onClick={() => start(item)}><span className="button-content"><Pencil size={15} /> Editar</span></Button>}</td>
        </tr>)}
      </ResponsiveTable>}
    <Modal title={editing ? "Editar fornecedor" : "Novo fornecedor"} open={open} onOpenChange={setOpen}>
      <form className="catalog-form" onSubmit={(event) => { event.preventDefault(); setError(""); mutation.mutate(); }}>
        <Input label="Nome" required minLength={2} maxLength={160} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
        <div className="stock-form-grid"><Input label="Telefone" type="tel" maxLength={40} value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} />
          <Input label="E-mail" type="email" maxLength={254} value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></div>
        <div className="field"><label htmlFor="supplier-notes">Observações</label><textarea id="supplier-notes" maxLength={1000} value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></div>
        <label className="catalog-check"><input type="checkbox" checked={form.is_active} onChange={(event) => setForm({ ...form, is_active: event.target.checked })} /> Fornecedor ativo</label>
        {error && <p className="catalog-error" role="alert">{error}</p>}
        <div className="dialog-actions"><Button variant="secondary" type="button" onClick={() => setOpen(false)}>Cancelar</Button><Button type="submit" disabled={mutation.isPending}>{mutation.isPending ? "Salvando..." : "Salvar fornecedor"}</Button></div>
      </form>
    </Modal>
  </div>;
}
