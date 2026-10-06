begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(14);

-- Auth cria perfis inativos. A preparação de papéis abaixo simula a ativação
-- administrativa e é revertida no fim do teste.
insert into auth.users (id, email) values
  ('11111111-1111-4111-8111-111111111111', 'admin-rbac@test.invalid'),
  ('22222222-2222-4222-8222-222222222222', 'caixa-rbac@test.invalid'),
  ('33333333-3333-4333-8333-333333333333', 'gerente-rbac@test.invalid');

select is((select count(*) from public.profiles where not is_active and id in (
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333'
)), 3::bigint,
  'novas contas começam inativas');

update public.profiles set role = 'ADMIN', is_active = true
where id = '11111111-1111-4111-8111-111111111111';
update public.profiles set role = 'CAIXA', is_active = true
where id = '22222222-2222-4222-8222-222222222222';
update public.profiles set role = 'GERENTE', is_active = true
where id = '33333333-3333-4333-8333-333333333333';

select ok(not has_table_privilege('anon', 'public.profiles', 'SELECT'),
  'anon não lê perfis');
select ok(not has_table_privilege('authenticated', 'public.profiles', 'INSERT'),
  'authenticated não cria perfis');
select ok(not has_table_privilege('authenticated', 'public.profiles', 'UPDATE'),
  'authenticated não troca papéis');
select ok(not has_table_privilege('authenticated', 'public.profiles', 'DELETE'),
  'authenticated não apaga perfis');

set local role authenticated;
set local request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';
set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated","aal":"aal1","is_anonymous":false,"user_metadata":{"role":"ADMIN"}}';

select results_eq('select count(*) from public.profiles', array[1::bigint],
  'CAIXA vê somente o próprio perfil');
select is(private.has_permission('users.read'), false,
  'metadados editáveis não concedem ADMIN');
select is(private.has_permission('pdv.use'), true,
  'CAIXA pode acessar o PDV');
set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated","aal":"aal1","is_anonymous":true}';
select is(private.has_permission('pdv.use'), false,
  'sessão anônima não recebe permissões mesmo com perfil');

set local request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated","aal":"aal1","is_anonymous":false}';
select results_eq($$select count(*) from public.profiles where id in (
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333')$$, array[3::bigint],
  'ADMIN vê todos os perfis');

set local request.jwt.claim.sub = '33333333-3333-4333-8333-333333333333';
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated","aal":"aal1","is_anonymous":false}';
select is(private.has_permission('finance.read'), true,
  'GERENTE ativo pode acessar financeiro');

reset role;
update public.profiles set is_active = false
where id = '33333333-3333-4333-8333-333333333333';
set local role authenticated;
select is(private.has_permission('finance.read'), false,
  'desativação revoga acesso sem renovar JWT');

reset role;
update public.profiles set is_active = true, mfa_required = true
where id = '33333333-3333-4333-8333-333333333333';
set local role authenticated;
select is(private.has_permission('finance.read'), false,
  'MFA exigido bloqueia sessão aal1');
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated","aal":"aal2","is_anonymous":false}';
select is(private.has_permission('finance.read'), true,
  'MFA aal2 libera permissão novamente');

select * from finish();
rollback;
