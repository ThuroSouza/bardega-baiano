-- O CAIXA pode ler o comprovante, mas não o custo interno da mercadoria.
-- A política RLS controla as linhas; privilégios de coluna controlam o dado.
revoke select on public.sale_items from authenticated;
grant select (
  id, sale_id, product_id, product_name, unit, quantity, unit_price,
  gross_subtotal, discount_amount, net_subtotal, created_at
) on public.sale_items to authenticated;
