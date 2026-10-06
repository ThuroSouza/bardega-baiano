-- Bloco 2: perfis e permissões. Nenhum usuário recebe acesso por padrão.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete restrict,
  display_name text not null default '' check (char_length(display_name) <= 120),
  role text not null default 'CAIXA' check (role in ('ADMIN', 'GERENTE', 'CAIXA', 'ESTOQUE')),
  is_active boolean not null default false,
  mfa_required boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index profiles_role_active_idx on public.profiles (role, is_active);

create table private.role_permissions (
  role text not null check (role in ('ADMIN', 'GERENTE', 'CAIXA', 'ESTOQUE')),
  permission text not null,
  primary key (role, permission)
);

insert into private.role_permissions (role, permission) values
  ('ADMIN', 'dashboard.read'), ('ADMIN', 'pdv.use'), ('ADMIN', 'sales.read'),
  ('ADMIN', 'cash.manage'), ('ADMIN', 'stock.read'), ('ADMIN', 'products.read'),
  ('ADMIN', 'finance.read'), ('ADMIN', 'reports.read'), ('ADMIN', 'users.read'),
  ('ADMIN', 'users.manage'), ('ADMIN', 'audit.read'),
  ('ADMIN', 'integrations.manage'), ('ADMIN', 'settings.manage'),
  ('GERENTE', 'dashboard.read'), ('GERENTE', 'pdv.use'),
  ('GERENTE', 'sales.read'), ('GERENTE', 'cash.manage'),
  ('GERENTE', 'stock.read'), ('GERENTE', 'products.read'),
  ('GERENTE', 'finance.read'), ('GERENTE', 'reports.read'),
  ('CAIXA', 'pdv.use'), ('CAIXA', 'sales.read'), ('CAIXA', 'cash.manage'),
  ('ESTOQUE', 'stock.read'), ('ESTOQUE', 'products.read');

-- Aciona somente em Auth, sem usar metadados editáveis para conceder acesso.
create function private.create_profile_for_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, left(coalesce(new.raw_user_meta_data ->> 'full_name', ''), 120));
  return new;
end;
$$;

revoke all on function private.create_profile_for_user() from public, anon, authenticated;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function private.create_profile_for_user();

-- Contas anteriores à migration também ficam sem acesso até ativação.
insert into public.profiles (id, display_name)
select id, left(coalesce(raw_user_meta_data ->> 'full_name', ''), 120)
from auth.users
on conflict (id) do nothing;

create function private.touch_profile_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke all on function private.touch_profile_updated_at() from public, anon, authenticated;
create trigger profiles_updated_at
before update on public.profiles
for each row execute function private.touch_profile_updated_at();

-- A função consulta o banco a cada autorização: desativação e troca de papel
-- não dependem de claims antigas no JWT. Acesso direto aos dados segue fechado.
create function private.has_permission(requested_permission text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and coalesce((select auth.jwt() ->> 'is_anonymous'), 'false') <> 'true'
    and exists (
      select 1
      from public.profiles p
      join private.role_permissions rp on rp.role = p.role
      where p.id = (select auth.uid())
        and p.is_active
        and (not p.mfa_required or (select auth.jwt() ->> 'aal') = 'aal2')
        and rp.permission = requested_permission
    );
$$;

revoke all on function private.has_permission(text) from public, anon;
grant execute on function private.has_permission(text) to authenticated;

-- RLS e grants são camadas separadas. Apenas leitura do próprio perfil ou
-- leitura de perfis por ADMIN está disponível via Data API neste bloco.
alter table public.profiles enable row level security;
alter table private.role_permissions enable row level security;
revoke all on table public.profiles from public, anon, authenticated;
revoke all on table private.role_permissions from public, anon, authenticated;
grant select on table public.profiles to authenticated;

create policy profiles_select_self_or_admin
on public.profiles
for select to authenticated
using (id = (select auth.uid()) or (select private.has_permission('users.read')));
