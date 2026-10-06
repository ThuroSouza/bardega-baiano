-- Bloco 3: catálogo. A autorização é verificada no banco em cada operação.
insert into private.role_permissions (role, permission) values
  ('ADMIN', 'products.manage'),
  ('GERENTE', 'products.manage'),
  ('ESTOQUE', 'products.manage');

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 2 and 80 and name = btrim(name)),
  description text not null default '' check (char_length(description) <= 500),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index categories_name_unique on public.categories (lower(name));

create table public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 2 and 160 and name = btrim(name)),
  description text not null default '' check (char_length(description) <= 2000),
  category_id uuid not null references public.categories(id) on delete restrict,
  internal_code text not null check (char_length(btrim(internal_code)) between 1 and 60 and internal_code = btrim(internal_code)),
  barcode text check (barcode is null or (barcode ~ '^[0-9]{3,32}$')),
  unit text not null default 'UN' check (unit in ('UN', 'KG', 'G', 'L', 'ML', 'CX', 'PCT')),
  cost_price numeric(12,2) not null default 0 check (cost_price >= 0),
  sale_price numeric(12,2) not null default 0 check (sale_price >= 0),
  margin_percent numeric generated always as (
    case when sale_price > 0
      then round(((sale_price - cost_price) / sale_price) * 100, 2)
      else null end
  ) stored,
  minimum_stock numeric(12,3) not null default 0 check (minimum_stock >= 0),
  is_active boolean not null default true,
  image_path text check (image_path is null or image_path ~ ('^products/' || id::text || '/[0-9a-f-]+[.](jpg|jpeg|png|webp)$')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index products_internal_code_unique on public.products (lower(internal_code));
create unique index products_barcode_unique on public.products (barcode) where barcode is not null;
create index products_category_idx on public.products (category_id);
create index products_active_name_idx on public.products (is_active, name);

create function private.touch_catalog_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
revoke all on function private.touch_catalog_updated_at() from public, anon, authenticated;
create trigger categories_updated_at before update on public.categories
for each row execute function private.touch_catalog_updated_at();
create trigger products_updated_at before update on public.products
for each row execute function private.touch_catalog_updated_at();

alter table public.categories enable row level security;
alter table public.products enable row level security;
revoke all on public.categories, public.products from public, anon, authenticated;
grant select, insert, update on public.categories, public.products to authenticated;

create policy categories_read on public.categories for select to authenticated
using ((select private.has_permission('products.read')));
create policy categories_insert on public.categories for insert to authenticated
with check ((select private.has_permission('products.manage')));
create policy categories_update on public.categories for update to authenticated
using ((select private.has_permission('products.manage')))
with check ((select private.has_permission('products.manage')));
create policy products_read on public.products for select to authenticated
using ((select private.has_permission('products.read')));
create policy products_insert on public.products for insert to authenticated
with check ((select private.has_permission('products.manage')));
create policy products_update on public.products for update to authenticated
using ((select private.has_permission('products.manage')))
with check ((select private.has_permission('products.manage')));

-- Exemplos iniciais são registros comuns: podem ser editados ou desativados.
insert into public.categories (name) values
  ('Cervejas'), ('Destilados'), ('Whiskies'), ('Vinhos'),
  ('Refrigerantes'), ('Águas'), ('Energéticos'), ('Sucos'),
  ('Petiscos'), ('Outros');

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-images', 'product-images', false, 3145728,
        array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy product_images_read on storage.objects for select to authenticated
using (bucket_id = 'product-images' and (select private.has_permission('products.read')));
create policy product_images_insert on storage.objects for insert to authenticated
with check (
  bucket_id = 'product-images'
  and (storage.foldername(name))[1] = 'products'
  and (select private.has_permission('products.manage'))
);
create policy product_images_delete on storage.objects for delete to authenticated
using (bucket_id = 'product-images' and (select private.has_permission('products.manage')));
