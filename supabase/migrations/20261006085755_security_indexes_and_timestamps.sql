-- A política de leitura de imagens consulta a referência no produto.
create unique index products_image_path_unique on public.products(image_path)
  where image_path is not null;

-- Títulos financeiros mudam de status; registrar a última alteração.
alter table public.financial_expenses
  add column updated_at timestamptz not null default now();
alter table public.financial_receivables
  add column updated_at timestamptz not null default now();
create trigger financial_expenses_updated_at before update on public.financial_expenses
  for each row execute function private.touch_catalog_updated_at();
create trigger financial_receivables_updated_at before update on public.financial_receivables
  for each row execute function private.touch_catalog_updated_at();
