-- Regressão transacional: nada persiste após o teste.
begin;

do $$
begin
  if has_column_privilege('authenticated','public.products','image_path','UPDATE')
    or has_column_privilege('authenticated','public.products','image_path','INSERT') then
    raise exception 'product_image_column_exposed';
  end if;
  if has_function_privilege('authenticated',
      'public.set_product_image_path(uuid,text,text,uuid)','EXECUTE')
    or has_function_privilege('anon',
      'public.set_product_image_path(uuid,text,text,uuid)','EXECUTE')
    or not has_function_privilege('service_role',
      'public.set_product_image_path(uuid,text,text,uuid)','EXECUTE') then
    raise exception 'product_image_rpc_privilege_incorrect';
  end if;
end;
$$;

insert into auth.users(id,email) values
  ('f1111111-1111-4111-8111-111111111111','stock-security@test.invalid'),
  ('f2222222-2222-4222-8222-222222222222','admin-security@test.invalid');
update public.profiles set role='ESTOQUE',is_active=true
  where id='f1111111-1111-4111-8111-111111111111';
update public.profiles set role='ADMIN',is_active=true
  where id='f2222222-2222-4222-8222-222222222222';
insert into public.products(id,name,category_id,internal_code)
  values ('f3333333-3333-4333-8333-333333333333','Produto de teste de segurança',
    (select id from public.categories limit 1),'SECURITY-TEST-16');

set local role authenticated;
set local request.jwt.claim.sub = 'f1111111-1111-4111-8111-111111111111';
set local request.jwt.claims = '{"sub":"f1111111-1111-4111-8111-111111111111","role":"authenticated","aal":"aal1","is_anonymous":false}';

do $$
begin
  perform public.record_stock_movement(
    p_product_id := 'f3333333-3333-4333-8333-333333333333',
    p_type := 'ENTRADA', p_request_id := 'f4444444-4444-4444-8444-444444444444',
    p_quantity := 1, p_unit_cost := 1);
  perform public.record_stock_movement(
    p_product_id := 'f3333333-3333-4333-8333-333333333333',
    p_type := 'ENTRADA', p_request_id := 'f4444444-4444-4444-8444-444444444444',
    p_quantity := 1, p_unit_cost := 1);
  if (select count(*) from public.stock_movements
      where idempotency_key='f4444444-4444-4444-8444-444444444444') <> 1 then
    raise exception 'stock_retry_duplicated';
  end if;
  begin
    perform public.record_stock_movement(
      p_product_id := 'f3333333-3333-4333-8333-333333333333',
      p_type := 'ENTRADA', p_request_id := 'f4444444-4444-4444-8444-444444444444',
      p_quantity := 2, p_unit_cost := 1);
    raise exception 'stock_replay_not_rejected';
  exception when others then
    if sqlerrm <> 'stock_request_reused' then raise; end if;
  end;
end;
$$;

do $$
begin
  begin
    perform public.admin_claim_invite_slot();
    raise exception 'non_admin_invite_slot_allowed';
  exception when others then
    if sqlerrm <> 'users_permission_denied' then raise; end if;
  end;
  if exists (select 1 from pg_policies where schemaname='storage'
      and tablename='objects' and policyname like 'product_images_%'
      and cmd <> 'SELECT') then
    raise exception 'direct_image_write_policy_remains';
  end if;
end;
$$;

set local request.jwt.claim.sub = 'f2222222-2222-4222-8222-222222222222';
set local request.jwt.claims = '{"sub":"f2222222-2222-4222-8222-222222222222","role":"authenticated","aal":"aal1","is_anonymous":false}';
do $$
begin
  if public.admin_claim_invite_slot() is not true then
    raise exception 'first_invite_slot_denied';
  end if;
  if public.admin_claim_invite_slot() is not false then
    raise exception 'invite_rate_limit_not_enforced';
  end if;
end;
$$;

rollback;
