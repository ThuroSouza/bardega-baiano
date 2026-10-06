-- Bloco 13: administração por ADMIN, sem exclusão de contas ou histórico.
-- A lista de permissões efetivas é consultada no banco, sem confiar no JWT
-- ou em metadados editáveis do usuário para autorização.
create function public.get_my_permissions()
returns text[] language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(rp.permission order by rp.permission), '{}'::text[])
  from public.profiles p
  join private.role_permissions rp on rp.role=p.role
  where p.id=(select auth.uid()) and p.is_active
    and (not p.mfa_required or (select auth.jwt()->>'aal')='aal2')
    and coalesce((select auth.jwt()->>'is_anonymous'),'false')<>'true';
$$;
revoke all on function public.get_my_permissions() from public, anon, authenticated;
grant execute on function public.get_my_permissions() to authenticated;

create function public.admin_check_access()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles p where p.id=(select auth.uid())
      and p.role='ADMIN' and p.is_active
      and (not p.mfa_required or (select auth.jwt()->>'aal')='aal2')
      and coalesce((select auth.jwt()->>'is_anonymous'),'false')<>'true'
  ) and private.has_permission('users.manage');
$$;
revoke all on function public.admin_check_access() from public, anon, authenticated;
grant execute on function public.admin_check_access() to authenticated;

create function public.admin_list_users(p_search text default '',p_page integer default 0,p_page_size integer default 25)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_search text := btrim(coalesce(p_search,''));
declare v_total bigint;
declare v_rows jsonb;
begin
  if not public.admin_check_access() then raise exception 'users_permission_denied' using errcode='42501'; end if;
  if char_length(v_search)>100 or p_page is null or p_page<0 or p_page>100000
    or p_page_size is null or p_page_size<1 or p_page_size>100 then
    raise exception 'users_invalid_filter' using errcode='22023';
  end if;
  select count(*) into v_total
  from auth.users u join public.profiles p on p.id=u.id
  where v_search='' or u.email ilike '%' || v_search || '%'
    or p.display_name ilike '%' || v_search || '%';
  select coalesce(jsonb_agg(to_jsonb(q) order by q.created_at desc,q.id),'[]'::jsonb) into v_rows
  from (
    select p.id, coalesce(u.email,'') as email, p.display_name,p.role,p.is_active,p.mfa_required,
      p.created_at,u.email_confirmed_at,u.last_sign_in_at,u.invited_at
    from auth.users u join public.profiles p on p.id=u.id
    where v_search='' or u.email ilike '%' || v_search || '%'
      or p.display_name ilike '%' || v_search || '%'
    order by p.created_at desc,p.id
    limit p_page_size offset p_page*p_page_size
  ) q;
  return jsonb_build_object('rows',v_rows,'total',v_total);
end;
$$;
revoke all on function public.admin_list_users(text,integer,integer) from public, anon, authenticated;
grant execute on function public.admin_list_users(text,integer,integer) to authenticated;

create function public.admin_update_user(p_user_id uuid,p_display_name text,p_role text,p_is_active boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_before public.profiles;
declare v_name text := btrim(coalesce(p_display_name,''));
begin
  if not public.admin_check_access() then raise exception 'users_permission_denied' using errcode='42501'; end if;
  if p_user_id is null or p_role not in ('ADMIN','GERENTE','CAIXA','ESTOQUE')
    or p_is_active is null or char_length(v_name)<2 or char_length(v_name)>120 then
    raise exception 'users_invalid_input' using errcode='22023';
  end if;
  select * into v_before from public.profiles where id=p_user_id for update;
  if not found then raise exception 'users_not_found' using errcode='22023'; end if;
  if p_user_id=(select auth.uid()) and (p_role<>'ADMIN' or not p_is_active) then
    raise exception 'users_cannot_remove_self' using errcode='22023';
  end if;
  update public.profiles set display_name=v_name,role=p_role,is_active=p_is_active
  where id=p_user_id;
  if (v_before.display_name,v_before.role,v_before.is_active)
      is distinct from (v_name,p_role,p_is_active) then
    insert into public.audit_logs(user_id,action,entity,entity_id,before_data,after_data)
    values ((select auth.uid()),'USER_ACCESS_UPDATED','profiles',p_user_id,
      jsonb_build_object('display_name',v_before.display_name,'role',v_before.role,'is_active',v_before.is_active),
      jsonb_build_object('display_name',v_name,'role',p_role,'is_active',p_is_active));
  end if;
  return jsonb_build_object('id',p_user_id,'display_name',v_name,'role',p_role,'is_active',p_is_active);
end;
$$;
revoke all on function public.admin_update_user(uuid,text,text,boolean) from public, anon, authenticated;
grant execute on function public.admin_update_user(uuid,text,text,boolean) to authenticated;

create function public.admin_role_permissions()
returns table(role text,permission text) language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.admin_check_access() then raise exception 'users_permission_denied' using errcode='42501'; end if;
  return query select rp.role,rp.permission from private.role_permissions rp order by rp.role,rp.permission;
end;
$$;
revoke all on function public.admin_role_permissions() from public, anon, authenticated;
grant execute on function public.admin_role_permissions() to authenticated;

create function public.admin_set_role_permissions(p_role text,p_permissions text[])
returns text[] language plpgsql security definer set search_path = '' as $$
declare v_allowed constant text[] := array[
  'dashboard.read','pdv.use','sales.discount','sales.cancel','sales.read',
  'cash.manage','cash.view_all','stock.read','stock.manage',
  'products.read','products.manage','finance.read','finance.manage','reports.read'];
declare v_sorted text[];
declare v_before text[];
begin
  if not public.admin_check_access() then raise exception 'users_permission_denied' using errcode='42501'; end if;
  if p_role is null or p_role not in ('GERENTE','CAIXA','ESTOQUE') or p_permissions is null
    or cardinality(p_permissions)=0
    or cardinality(p_permissions)>cardinality(v_allowed)
    or exists (select 1 from unnest(p_permissions) x where x is null or not x=any(v_allowed))
    or (select count(distinct x) from unnest(p_permissions) x)<>cardinality(p_permissions) then
    raise exception 'users_invalid_permissions' using errcode='22023';
  end if;
  if ('products.manage'=any(p_permissions) and not 'products.read'=any(p_permissions))
    or ('stock.manage'=any(p_permissions) and not 'stock.read'=any(p_permissions))
    or ('finance.manage'=any(p_permissions) and not 'finance.read'=any(p_permissions))
    or ('sales.cancel'=any(p_permissions) and not 'sales.read'=any(p_permissions))
    or ('sales.discount'=any(p_permissions) and not 'pdv.use'=any(p_permissions))
    or ('cash.view_all'=any(p_permissions) and not 'cash.manage'=any(p_permissions))
    or ('pdv.use'=any(p_permissions) and not 'cash.manage'=any(p_permissions))
    or ('dashboard.read'=any(p_permissions) and not 'finance.read'=any(p_permissions))
    or ('reports.read'=any(p_permissions) and not
      (array['sales.read','stock.read','finance.read','cash.view_all'] <@ p_permissions)) then
    raise exception 'users_permission_dependency' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(72219913);
  select coalesce(array_agg(permission order by permission),'{}'::text[]) into v_before
    from private.role_permissions where role=p_role;
  select coalesce(array_agg(x order by x),'{}'::text[]) into v_sorted
    from unnest(p_permissions) x;
  if v_before is distinct from v_sorted then
    delete from private.role_permissions where role=p_role;
    insert into private.role_permissions(role,permission) select p_role,x from unnest(v_sorted) x;
    insert into public.audit_logs(user_id,action,entity,entity_id,before_data,after_data)
    values ((select auth.uid()),'ROLE_PERMISSIONS_UPDATED','role_permissions',(select auth.uid()),
      jsonb_build_object('role',p_role,'permissions',v_before),
      jsonb_build_object('role',p_role,'permissions',v_sorted));
  end if;
  return v_sorted;
end;
$$;
revoke all on function public.admin_set_role_permissions(text,text[]) from public, anon, authenticated;
grant execute on function public.admin_set_role_permissions(text,text[]) to authenticated;
