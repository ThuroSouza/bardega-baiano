import { useRef, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { Button } from "../../components/ui/Button";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { FormField } from "../../components/ui/FormField";
import { Modal } from "../../components/ui/Modal";
import type { StockItem, Supplier } from "./api";
import { recordMovement, stockError } from "./api";
import { operationLabels } from "./labels";

type Operation = "ENTRADA" | "SAIDA" | "AJUSTE" | "PERDA" | "AVARIA" | "INVENTARIO";
const operations: Operation[] = ["ENTRADA", "SAIDA", "PERDA", "AVARIA", "INVENTARIO", "AJUSTE"];
const numberIsValid = (value: string, allowZero = false) => value.trim() !== "" &&
  Number.isFinite(Number(value)) && (allowZero ? Number(value) >= 0 : Number(value) > 0) &&
  /^-?\d+(\.\d{1,3})?$/.test(value);
const schema = z.object({
  productId: z.uuid(), type: z.enum(operations), quantity: z.string(),
  countedQuantity: z.string(), unitCost: z.string(), reason: z.string(),
  supplierId: z.string(), invoiceNumber: z.string().max(80),
  notes: z.string().max(1000), occurredOn: z.string(),
}).superRefine((value, context) => {
  if (value.type === "INVENTARIO") {
    if (!numberIsValid(value.countedQuantity, true)) context.addIssue({ code: "custom", path: ["countedQuantity"], message: "Informe a contagem com até três casas decimais." });
  } else if (value.type === "AJUSTE") {
    if (!numberIsValid(value.quantity.replace(/^-/, "")) || Number(value.quantity) === 0) context.addIssue({ code: "custom", path: ["quantity"], message: "Informe uma diferença positiva ou negativa." });
  } else if (!numberIsValid(value.quantity)) {
    context.addIssue({ code: "custom", path: ["quantity"], message: "Informe uma quantidade maior que zero." });
  }
  if (value.type === "ENTRADA") {
    if (!numberIsValid(value.unitCost, true) || !/^\d+(\.\d{1,2})?$/.test(value.unitCost)) context.addIssue({ code: "custom", path: ["unitCost"], message: "Informe o custo com até duas casas decimais." });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value.occurredOn)) context.addIssue({ code: "custom", path: ["occurredOn"], message: "Informe a data da entrada." });
  } else if (value.reason.trim().length < 3) {
    context.addIssue({ code: "custom", path: ["reason"], message: "Informe um motivo com pelo menos três caracteres." });
  }
});
type Values = z.infer<typeof schema>;
const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const quantity = (value: number, unit: string) => `${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 }).format(value)} ${unit}`;

export function StockMovementDialog({
  open, onOpenChange, items, suppliers, initialProductId = "", initialType = "ENTRADA",
}: {
  open: boolean; onOpenChange: (open: boolean) => void; items: StockItem[]; suppliers: Supplier[];
  initialProductId?: string; initialType?: Operation;
}) {
  const requestId = useRef(crypto.randomUUID());
  const queryClient = useQueryClient();
  const [initialDate] = useState(() => new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" }));
  const [pendingCount, setPendingCount] = useState<Values | null>(null);
  const [error, setError] = useState("");
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      productId: initialProductId, type: initialType, quantity: "", countedQuantity: "",
      unitCost: "", reason: initialType === "ENTRADA" ? "Entrada de mercadoria" : "",
      supplierId: "", invoiceNumber: "", notes: "",
      occurredOn: initialDate,
    },
  });
  const watched = useWatch({ control: form.control });
  const currentType = watched.type ?? initialType;
  const typeField = form.register("type");
  const selected = items.find((item) => item.id === watched.productId);
  const qty = Number(watched.quantity);
  const counted = Number(watched.countedQuantity);
  const cost = Number(watched.unitCost);
  const mutation = useMutation({
    mutationFn: (value: Values) => recordMovement({
      productId: value.productId, type: value.type, requestId: requestId.current,
      quantity: value.type === "INVENTARIO" ? null : Number(value.quantity),
      countedQuantity: value.type === "INVENTARIO" ? Number(value.countedQuantity) : null,
      expectedPrevious: value.type === "INVENTARIO" ? selected?.quantity ?? null : null,
      unitCost: value.type === "ENTRADA" ? Number(value.unitCost) : null,
      reason: value.reason, supplierId: value.type === "ENTRADA" ? value.supplierId || null : null,
      invoiceNumber: value.type === "ENTRADA" ? value.invoiceNumber : "",
      notes: value.notes, occurredOn: value.type === "ENTRADA" ? value.occurredOn : null,
    }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["stock"] });
      void queryClient.invalidateQueries({ queryKey: ["stock-movements"] });
      toast.success("Movimentação registrada com sucesso.");
      onOpenChange(false);
    },
    onError: (reason) => {
      setError(stockError(reason));
      if (String((reason as { message?: string })?.message) === "stock_balance_changed") void queryClient.invalidateQueries({ queryKey: ["stock"] });
    },
  });
  function submit(value: Values) {
    setError("");
    if (value.type === "INVENTARIO") setPendingCount(value);
    else mutation.mutate(value);
  }
  const difference = selected && Number.isFinite(counted) ? counted - selected.quantity : null;
  return <>
    <Modal open={open} onOpenChange={onOpenChange} title="Movimentar estoque" description="Toda alteração será registrada com o responsável e horário.">
      <form className="stock-form" onSubmit={form.handleSubmit(submit)}>
        <FormField label="Operação" htmlFor="stock-type" error={form.formState.errors.type?.message}>
          <select id="stock-type" {...typeField} onChange={(event) => {
            void typeField.onChange(event);
            form.setValue("reason", event.target.value === "ENTRADA" ? "Entrada de mercadoria" : "");
          }}>{operations.map((type) => <option key={type} value={type}>{operationLabels[type]}</option>)}</select>
        </FormField>
        <FormField label="Produto" htmlFor="stock-product" error={form.formState.errors.productId?.message}>
          <select id="stock-product" {...form.register("productId")}><option value="">Selecione o produto</option>{items.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.internal_code}</option>)}</select>
        </FormField>
        {selected && <div className="stock-current">Saldo atual: <strong>{quantity(selected.quantity, selected.unit)}</strong></div>}
        {currentType === "INVENTARIO" ? <>
          <FormField label="Contagem física" htmlFor="stock-count" error={form.formState.errors.countedQuantity?.message}>
            <input id="stock-count" type="number" min="0" step="0.001" inputMode="decimal" {...form.register("countedQuantity")} />
          </FormField>
          {difference !== null && watched.countedQuantity !== "" && <div className="stock-current">Diferença: <strong className={difference < 0 ? "stock-negative" : ""}>{difference > 0 ? "+" : ""}{quantity(difference, selected!.unit)}</strong></div>}
        </> : <FormField label={currentType === "AJUSTE" ? "Diferença (+ ou −)" : "Quantidade"} htmlFor="stock-quantity" error={form.formState.errors.quantity?.message}>
          <input id="stock-quantity" type="number" step="0.001" inputMode="decimal" {...form.register("quantity")} />
        </FormField>}
        {currentType === "ENTRADA" && <>
          <div className="stock-form-grid">
            <FormField label="Fornecedor" htmlFor="stock-supplier"><select id="stock-supplier" {...form.register("supplierId")}><option value="">Sem fornecedor informado</option>{suppliers.filter((supplier) => supplier.is_active).map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select></FormField>
            <FormField label="Custo unitário (R$)" htmlFor="stock-cost" error={form.formState.errors.unitCost?.message}><input id="stock-cost" type="number" min="0" step="0.01" inputMode="decimal" {...form.register("unitCost")} /></FormField>
            <FormField label="Data da entrada" htmlFor="stock-date" error={form.formState.errors.occurredOn?.message}><input id="stock-date" type="date" {...form.register("occurredOn")} /></FormField>
            <FormField label="Número da nota" htmlFor="stock-invoice" error={form.formState.errors.invoiceNumber?.message}><input id="stock-invoice" maxLength={80} {...form.register("invoiceNumber")} /></FormField>
          </div>
          {Number.isFinite(qty * cost) && qty > 0 && cost >= 0 && watched.unitCost !== "" && <div className="stock-current">Custo total: <strong>{money.format(qty * cost)}</strong></div>}
        </>}
        <FormField label={currentType === "ENTRADA" ? "Referência / motivo" : "Motivo obrigatório"} htmlFor="stock-reason" error={form.formState.errors.reason?.message}><input id="stock-reason" maxLength={500} {...form.register("reason")} /></FormField>
        <FormField label="Observação" htmlFor="stock-notes" error={form.formState.errors.notes?.message}><textarea id="stock-notes" maxLength={1000} {...form.register("notes")} /></FormField>
        {error && <p role="alert" className="catalog-error">{error}</p>}
        <div className="dialog-actions"><Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>Cancelar</Button><Button type="submit" disabled={mutation.isPending}>{mutation.isPending ? "Registrando..." : currentType === "INVENTARIO" ? "Conferir ajuste" : "Registrar movimentação"}</Button></div>
      </form>
    </Modal>
    <ConfirmDialog open={Boolean(pendingCount)} onOpenChange={(next) => { if (!next) setPendingCount(null); }}
      title="Confirmar inventário"
      description={`Saldo do sistema: ${selected ? quantity(selected.quantity, selected.unit) : "—"}. Contagem física: ${selected && pendingCount ? quantity(Number(pendingCount.countedQuantity), selected.unit) : "—"}. A diferença será registrada no histórico.`}
      confirmLabel="Confirmar contagem"
      onConfirm={() => { if (pendingCount) mutation.mutate(pendingCount); setPendingCount(null); }} />
  </>;
}
