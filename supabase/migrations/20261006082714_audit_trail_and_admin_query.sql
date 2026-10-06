-- Bloco 14: trilha de auditoria consultável, com contexto limitado.
alter table public.audit_logs
  add column actor_name text not null default '',
  add column context jsonb not null default '{}'::jsonb;
create index audit_logs_action_created_idx on public.audit_logs(action,created_at desc,id desc);
create unique index audit_login_session_unique on public.audit_logs ((context->>'session_id'))
  where action='LOGIN' and context ? 'session_id';

create function private.enrich_audit_event()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_headers jsonb := coalesce(nullif(current_setting('request.headers',true),'')::jsonb,'{}'::jsonb);
begin
  select coalesce(nullif(p.display_name,''),'Usuário') into new.actor_name
    from public.profiles p where p.id=new.user_id;
  new.actor_name := coalesce(new.actor_name,'Usuário');
  new.context := coalesce(new.context,'{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
    'user_agent',left(v_headers->>'user-agent',512),
    'request_id',left(v_headers->>'x-request-id',120)));
  return new;
end;
$$;
revoke all on function private.enrich_audit_event() from public,anon,authenticated;
create trigger audit_logs_enrich before insert on public.audit_logs
for each row execute function private.enrich_audit_event();

create function private.prevent_audit_changes()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'audit_immutable' using errcode='42501';
end;
$$;
revoke all on function private.prevent_audit_changes() from public,anon,authenticated;
create trigger audit_logs_immutable before update or delete or truncate on public.audit_logs
for each statement execute function private.prevent_audit_changes();

-- Chamado após signInWithPassword. Um evento por session_id validado no JWT.
create function public.record_login_event()
returns void language plpgsql security definer set search_path = '' as $$
declare v_user uuid := (select auth.uid());
declare v_session text := (select auth.jwt()->>'session_id');
begin
  if v_user is null or v_session is null or char_length(v_session)>100
    or coalesce((select auth.jwt()->>'is_anonymous'),'false')='true'
    or not exists (select 1 from public.profiles where id=v_user) then
    raise exception 'audit_login_invalid' using errcode='42501';
  end if;
  insert into public.audit_logs(user_id,action,entity,entity_id,after_data,context)
    values (v_user,'LOGIN','profiles',v_user,jsonb_build_object('source','web'),
      jsonb_build_object('session_id',v_session))
  on conflict do nothing;
end;
$$;
revoke all on function public.record_login_event() from public,anon,authenticated;
grant execute on function public.record_login_event() to authenticated;

create function private.audit_product_price_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is not null then
    insert into public.audit_logs(user_id,action,entity,entity_id,before_data,after_data)
      values ((select auth.uid()),'PRODUCT_PRICE_CHANGED','products',new.id,
        jsonb_build_object('cost_price',old.cost_price,'sale_price',old.sale_price),
        jsonb_build_object('cost_price',new.cost_price,'sale_price',new.sale_price));
  end if;
  return new;
end;
$$;
revoke all on function private.audit_product_price_change() from public,anon,authenticated;
create trigger product_price_audit after update of cost_price,sale_price on public.products
for each row when (old.cost_price is distinct from new.cost_price or old.sale_price is distinct from new.sale_price)
execute function private.audit_product_price_change();

-- Mudanças cadastrais da despesa, quando houver fluxo de edição, ficam registradas.
-- Baixa e cancelamento já têm eventos específicos nas funções financeiras.
create function private.audit_expense_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is not null then
    insert into public.audit_logs(user_id,action,entity,entity_id,before_data,after_data)
      values ((select auth.uid()),'FINANCE_EXPENSE_UPDATED','financial_expenses',new.id,
        jsonb_build_object('description',old.description,'category',old.category,
          'supplier_name',old.supplier_name,'amount',old.amount,'due_on',old.due_on,'notes',old.notes),
        jsonb_build_object('description',new.description,'category',new.category,
          'supplier_name',new.supplier_name,'amount',new.amount,'due_on',new.due_on,'notes',new.notes));
  end if;
  return new;
end;
$$;
revoke all on function private.audit_expense_change() from public,anon,authenticated;
create trigger expense_change_audit after update of description,category,supplier_name,amount,due_on,notes on public.financial_expenses
for each row when (
  (old.description,old.category,old.supplier_name,old.amount,old.due_on,old.notes)
    is distinct from
  (new.description,new.category,new.supplier_name,new.amount,new.due_on,new.notes))
execute function private.audit_expense_change();

create function public.admin_list_audit_events(
  p_start date default null,p_end date default null,p_action text default '',
  p_search text default '',p_page integer default 0,p_page_size integer default 25
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_action text := btrim(coalesce(p_action,''));
declare v_search text := btrim(coalesce(p_search,''));
declare v_total bigint;
declare v_rows jsonb;
begin
  if not public.admin_check_access() or not private.has_permission('audit.read') then
    raise exception 'audit_permission_denied' using errcode='42501';
  end if;
  if p_start is not null and p_end is not null and (p_end<p_start or p_end>p_start+3653)
    or char_length(v_action)>80 or char_length(v_search)>100
    or p_page is null or p_page<0 or p_page>100000
    or p_page_size is null or p_page_size<1 or p_page_size>100 then
    raise exception 'audit_invalid_filter' using errcode='22023';
  end if;
  select count(*) into v_total from public.audit_logs a
    left join public.profiles p on p.id=a.user_id
    left join auth.users u on u.id=a.user_id
  where (p_start is null or a.created_at >= (p_start::timestamp at time zone 'America/Sao_Paulo'))
    and (p_end is null or a.created_at < ((p_end+1)::timestamp at time zone 'America/Sao_Paulo'))
    and (v_action='' or a.action=v_action)
    and (v_search='' or a.actor_name ilike '%'||v_search||'%'
      or p.display_name ilike '%'||v_search||'%' or u.email ilike '%'||v_search||'%'
      or a.entity_id::text ilike '%'||v_search||'%');
  select coalesce(jsonb_agg(to_jsonb(q) order by q.created_at desc,q.id desc),'[]'::jsonb)
    into v_rows from (
    select a.id,a.user_id,a.action,a.entity,a.entity_id,a.before_data,a.after_data,
      a.context-'session_id' as context,a.created_at,
      coalesce(nullif(a.actor_name,''),nullif(p.display_name,''),u.email,'Usuário') as actor_name,
      coalesce(u.email,'') as actor_email
    from public.audit_logs a
      left join public.profiles p on p.id=a.user_id
      left join auth.users u on u.id=a.user_id
    where (p_start is null or a.created_at >= (p_start::timestamp at time zone 'America/Sao_Paulo'))
      and (p_end is null or a.created_at < ((p_end+1)::timestamp at time zone 'America/Sao_Paulo'))
      and (v_action='' or a.action=v_action)
      and (v_search='' or a.actor_name ilike '%'||v_search||'%'
        or p.display_name ilike '%'||v_search||'%' or u.email ilike '%'||v_search||'%'
        or a.entity_id::text ilike '%'||v_search||'%')
    order by a.created_at desc,a.id desc
    limit p_page_size offset p_page*p_page_size
  ) q;
  return jsonb_build_object('rows',v_rows,'total',v_total);
end;
$$;
revoke all on function public.admin_list_audit_events(date,date,text,text,integer,integer)
  from public,anon,authenticated;
grant execute on function public.admin_list_audit_events(date,date,text,text,integer,integer)
  to authenticated;

create function public.admin_audit_actions()
returns text[] language plpgsql stable security definer set search_path = '' as $$
declare v_actions text[];
begin
  if not public.admin_check_access() or not private.has_permission('audit.read') then
    raise exception 'audit_permission_denied' using errcode='42501';
  end if;
  select coalesce(array_agg(distinct action order by action),'{}'::text[])
    into v_actions from public.audit_logs;
  return v_actions;
end;
$$;
revoke all on function public.admin_audit_actions() from public,anon,authenticated;
grant execute on function public.admin_audit_actions() to authenticated;
