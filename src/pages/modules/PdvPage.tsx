import { useDeferredValue, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Minus, Plus, RefreshCw, ShoppingCart, Trash2 } from "lucide-react";
import { Link } from "react-router";
import { toast } from "sonner";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { EmptyState, ErrorState, LoadingState } from "../../components/ui/Feedback";
import { Input } from "../../components/ui/Input";
import { Modal } from "../../components/ui/Modal";
import { Select } from "../../components/ui/Select";
import { can } from "../../config/permissions";
import { getMyOpenCashSession } from "../../features/cash/api";
import { checkoutSale, getPdvProductsByIds, paymentLabels, pdvError, searchPdvProducts } from "../../features/pdv/api";
import type { PaymentMethod, PdvProduct, Sale } from "../../features/pdv/api";
import { formatMoney, lineCents, moneyDecimal, parseMoneyCents, priceCents, quantityMilli } from "../../features/pdv/money";
import { useAuth } from "../../hooks/useAuth";

type CartItem = { product: PdvProduct; quantity: string };
const whole = (unit: string) => ["UN", "CX", "PCT"].includes(unit);
const stockLabel = (quantity: number, unit: string) => `${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 }).format(quantity)} ${unit}`;

export default function PdvPage() {
  const auth = useAuth();
  const mayDiscount = Boolean(auth.profile && can(auth.permissions, "sales.discount"));
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const products = useQuery({ queryKey: ["pdv-products", deferredSearch], queryFn: () => searchPdvProducts(deferredSearch), staleTime: 15_000 });
  const openCash = useQuery({ queryKey: ["cash-open", auth.profile?.id], queryFn: () => getMyOpenCashSession(auth.profile!.id), enabled: Boolean(auth.profile?.id) });
  const [cart, setCart] = useState<CartItem[]>([]);
  const [method, setMethod] = useState<PaymentMethod>("PIX");
  const [discount, setDiscount] = useState("0");
  const [discountReason, setDiscountReason] = useState("");
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [completed, setCompleted] = useState<Sale | null>(null);
  const [error, setError] = useState("");
  const [cartOpen, setCartOpen] = useState(false);

  function changeCart(next: CartItem[]) {
    setCart(next); setRequestId(crypto.randomUUID()); setError("");
  }
  function addProduct(product: PdvProduct) {
    if (product.stock_quantity <= 0 || product.sale_price <= 0) { toast.error("Produto indisponível para venda."); return; }
    const existing = cart.find((item) => item.product.product_id === product.product_id);
    const step = whole(product.unit) ? 1 : 0.001;
    const next = existing ? Number(existing.quantity) + step : step;
    if (next > product.stock_quantity) { toast.error("Quantidade acima do estoque disponível."); return; }
    changeCart(existing ? cart.map((item) => item === existing ? { ...item, quantity: String(Number(next.toFixed(3))) } : item) : [...cart, { product, quantity: String(step) }]);
    setSearch(""); toast.success(`${product.name} adicionado.`);
  }
  function updateQuantity(id: string, quantity: string) {
    changeCart(cart.map((item) => item.product.product_id === id ? { ...item, quantity } : item));
  }
  const lines = cart.map((item) => {
    const milli = quantityMilli(item.quantity, item.product.unit);
    return { ...item, milli, valid: milli !== null && Number(milli) / 1000 <= item.product.stock_quantity, subtotal: milli === null ? 0n : lineCents(item.product.sale_price, milli) };
  });
  const subtotal = lines.reduce((sum, item) => sum + item.subtotal, 0n);
  const discountCents = mayDiscount ? parseMoneyCents(discount) : 0n;
  const total = subtotal - (discountCents ?? 0n);
  const issue = !cart.length ? "Adicione um produto."
    : lines.some((item) => !item.valid) ? "Confira as quantidades e o estoque disponível."
    : discountCents === null ? "Informe o desconto com até duas casas decimais."
    : discountCents >= subtotal ? "O desconto precisa ser menor que o subtotal."
    : discountCents > 0n && discountReason.trim().length < 3 ? "Informe o motivo do desconto (mínimo de 3 caracteres)."
    : total <= 0n ? "O total precisa ser maior que zero."
    : subtotal > 99999999999999n ? "O valor da venda excede o limite permitido." : "";

  const checkout = useMutation({
    mutationFn: () => checkoutSale({ requestId,
      items: lines.map((item) => ({ product_id: item.product.product_id, quantity: Number(item.milli!) / 1000 })),
      paymentMethod: method, expectedTotal: moneyDecimal(total), discountAmount: moneyDecimal(discountCents ?? 0n),
      discountReason: discountCents && discountCents > 0n ? discountReason : "" }),
    onSuccess: (sale) => {
      setCompleted(sale); setConfirmOpen(false); setCartOpen(false); setError("");
      void queryClient.invalidateQueries({ queryKey: ["pdv-products"] });
      void queryClient.invalidateQueries({ queryKey: ["stock"] });
      void queryClient.invalidateQueries({ queryKey: ["cash-session"] });
      void queryClient.invalidateQueries({ queryKey: ["cash-history"] });
      toast.success(`Venda #${sale.sale_number} concluída.`);
    },
    onError: (reason) => { setConfirmOpen(false); setError(pdvError(reason)); },
  });
  const refresh = useMutation({
    mutationFn: () => getPdvProductsByIds(cart.map((item) => item.product.product_id)),
    onSuccess: (latest) => {
      const byId = new Map(latest.map((item) => [item.product_id, item]));
      changeCart(cart.map((item) => ({ ...item, product: byId.get(item.product.product_id) ?? { ...item.product, stock_quantity: 0 } })));
      void queryClient.invalidateQueries({ queryKey: ["pdv-products"] });
      toast.success("Preços e saldos atualizados.");
    }, onError: (reason) => setError(pdvError(reason)),
  });
  const barcodeLookup = useMutation({
    mutationFn: async (term: string) => {
      const matches = await searchPdvProducts(term);
      return matches.find((product) => product.barcode === term || product.internal_code.toLowerCase() === term.toLowerCase());
    },
    onSuccess: (product) => product ? addProduct(product) : toast.error("Código não encontrado."),
    onError: (reason) => toast.error(pdvError(reason)),
  });
  function newSale() {
    setCompleted(null); setCart([]); setMethod("PIX"); setDiscount("0"); setDiscountReason("");
    setRequestId(crypto.randomUUID()); setError(""); setSearch("");
  }
  function searchEnter(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter" || !search.trim()) return;
    event.preventDefault();
    if (!barcodeLookup.isPending) barcodeLookup.mutate(search.trim());
  }

  if (completed) return <div className="page-stack pdv-complete-page">
    <div className="page-heading"><div><div className="eyebrow">OPERAÇÃO · PDV</div><h1>Venda concluída</h1><p>Pagamento e baixa de estoque registrados.</p></div></div>
    <Card className="pdv-complete"><CheckCircle2 size={47} aria-hidden="true" /><span>VENDA #{completed.sale_number}</span><strong>{formatMoney(priceCents(completed.total))}</strong><p>{paymentLabels[method]} · {new Date(completed.created_at).toLocaleString("pt-BR")}</p><div className="pdv-complete-actions"><Button onClick={newSale}>Nova venda</Button><Button variant="secondary" asChild><Link to={`/vendas/${completed.id}`}>Visualizar venda</Link></Button></div></Card>
  </div>;

  return <div className="page-stack">
    <div className="page-heading"><div><div className="eyebrow">OPERAÇÃO · PDV</div><h1>Ponto de venda</h1><p>Busque produtos, monte o carrinho e registre o pagamento.</p></div></div>
    {openCash.isError ? <ErrorState message="Não foi possível consultar seu caixa." onRetry={() => void openCash.refetch()} /> : openCash.data ? <Card className="pdv-cash-banner"><span>Caixa #{openCash.data.session_number} aberto</span><Link to="/caixa">Ver caixa</Link></Card> : !openCash.isPending && <Card className="pdv-cash-banner pdv-cash-required"><span>Abra seu caixa para finalizar vendas.</span><Button asChild><Link to="/caixa">Abrir caixa</Link></Button></Card>}
    <div className="pdv-layout"><section className="pdv-catalog" aria-label="Busca de produtos">
      <div className="pdv-search"><input aria-label="Buscar produto por nome, código ou código de barras" autoComplete="off" maxLength={80} placeholder="Nome, código ou código de barras" value={search} onChange={(event) => setSearch(event.target.value)} onKeyDown={searchEnter} /></div>
      <p className="pdv-help">Digite ou leia o código de barras e pressione Enter para adicionar.</p>
      {products.isPending ? <LoadingState label="Buscando produtos..." /> : products.isError ? <ErrorState message={pdvError(products.error)} onRetry={() => void products.refetch()} /> : products.data?.length ? <div className="pdv-product-grid">{products.data.map((product) => <button type="button" key={product.product_id} className="pdv-product" disabled={product.stock_quantity <= 0 || product.sale_price <= 0} onClick={() => addProduct(product)}><span className="pdv-product-code">{product.internal_code}{product.barcode ? ` · ${product.barcode}` : ""}</span><strong>{product.name}</strong><span className="pdv-product-footer"><b>{formatMoney(priceCents(product.sale_price))}</b><small>{product.stock_quantity > 0 ? stockLabel(product.stock_quantity, product.unit) : "Sem estoque"}</small></span><span className="pdv-product-add"><Plus size={15} /> Adicionar</span></button>)}</div> : <EmptyState title="Nenhum produto encontrado" description={search ? "Tente outro nome ou código." : "Cadastre produtos ativos com preço e estoque para vender."} />}
    </section><aside className={`pdv-cart ${cartOpen ? "pdv-cart-open" : ""}`} aria-label="Carrinho e pagamento"><Card className="pdv-cart-card">
      <div className="pdv-cart-heading"><h2><ShoppingCart size={20} /> Carrinho <span>{cart.length}</span></h2><button type="button" className="pdv-cart-close" onClick={() => setCartOpen(false)}>Voltar aos produtos</button></div>
      {!cart.length ? <div className="pdv-cart-empty">Selecione um produto para começar.</div> : <div className="pdv-cart-items">{lines.map((item) => <div className="pdv-cart-item" key={item.product.product_id}><div className="pdv-cart-item-top"><div><strong>{item.product.name}</strong><small>{formatMoney(priceCents(item.product.sale_price))} / {item.product.unit} · Saldo {stockLabel(item.product.stock_quantity, item.product.unit)}</small></div><button className="icon-button" type="button" aria-label={`Remover ${item.product.name}`} onClick={() => changeCart(cart.filter((entry) => entry.product.product_id !== item.product.product_id))}><Trash2 size={17} /></button></div><div className="pdv-cart-item-bottom"><div className="pdv-quantity"><button type="button" aria-label={`Diminuir ${item.product.name}`} onClick={() => { const step = whole(item.product.unit) ? 1000n : 1n; const next = (item.milli ?? 0n) - step; if (next <= 0n) changeCart(cart.filter((entry) => entry.product.product_id !== item.product.product_id)); else updateQuantity(item.product.product_id, String(Number(next) / 1000)); }}><Minus size={15} /></button><input aria-label={`Quantidade de ${item.product.name} em ${item.product.unit}`} inputMode="decimal" type="number" min={whole(item.product.unit) ? "1" : "0.001"} step={whole(item.product.unit) ? "1" : "0.001"} value={item.quantity} onChange={(event) => updateQuantity(item.product.product_id, event.target.value)} /><button type="button" aria-label={`Aumentar ${item.product.name}`} onClick={() => addProduct(item.product)}><Plus size={15} /></button></div><strong>{formatMoney(item.subtotal)}</strong></div>{!item.valid && <small className="pdv-inline-error">Quantidade inválida ou acima do saldo.</small>}</div>)}</div>}
      <div className="pdv-cart-controls"><div className="pdv-totals"><div><span>Subtotal</span><strong>{formatMoney(subtotal)}</strong></div>{mayDiscount && <div><span>Desconto</span><strong>− {formatMoney(discountCents ?? 0n)}</strong></div>}<div className="pdv-total"><span>Total</span><strong>{formatMoney(total)}</strong></div></div>
        {mayDiscount && <div className="pdv-discount"><Input label="Desconto autorizado (R$)" inputMode="decimal" placeholder="0,00" value={discount} onChange={(event) => { setDiscount(event.target.value); setRequestId(crypto.randomUUID()); setError(""); }} /><Input label="Motivo do desconto" maxLength={500} placeholder="Informe o motivo" value={discountReason} onChange={(event) => { setDiscountReason(event.target.value); setRequestId(crypto.randomUUID()); setError(""); }} /></div>}
        <Select label="Forma de pagamento" value={method} onChange={(event) => { setMethod(event.target.value as PaymentMethod); setRequestId(crypto.randomUUID()); setError(""); }}>{Object.entries(paymentLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select>
        <small className="pdv-help">O valor integral é registrado em uma forma de pagamento.</small>
        {error && <div className="pdv-error" role="alert">{error}</div>}{issue && cart.length > 0 && <div className="pdv-error" role="status">{issue}</div>}
        <Button className="full-width" disabled={Boolean(issue) || checkout.isPending || !openCash.data} onClick={() => setConfirmOpen(true)}>{checkout.isPending ? "Finalizando..." : `Finalizar venda · ${formatMoney(total)}`}</Button>
        {cart.length > 0 && <Button className="full-width" variant="ghost" disabled={refresh.isPending || checkout.isPending} onClick={() => refresh.mutate()}><RefreshCw size={15} /> {refresh.isPending ? "Atualizando..." : "Atualizar preços e saldo"}</Button>}
      </div></Card></aside></div>
    <button type="button" className="pdv-mobile-cart-button" onClick={() => setCartOpen(true)}><ShoppingCart size={18} /> Ver carrinho ({cart.length}) <strong>{formatMoney(total)}</strong></button>
    <Modal title="Confirmar venda" description="Confira o valor e a forma de pagamento antes de concluir." open={confirmOpen} onOpenChange={setConfirmOpen}><div className="pdv-confirm"><div><span>Itens</span><strong>{cart.length}</strong></div><div><span>Pagamento</span><strong>{paymentLabels[method]}</strong></div><div><span>Total a cobrar</span><strong>{formatMoney(total)}</strong></div></div><div className="dialog-actions"><Button variant="secondary" onClick={() => setConfirmOpen(false)}>Voltar</Button><Button disabled={checkout.isPending || Boolean(issue) || !openCash.data} onClick={() => checkout.mutate()}>{checkout.isPending ? "Finalizando..." : "Confirmar venda"}</Button></div></Modal>
  </div>;
}
