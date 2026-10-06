-- Bloco 8: títulos financeiros e receitas manuais; vendas seguem no livro existente.
insert into private.role_permissions (role, permission) values
  ('ADMIN', 'finance.manage'), ('GERENTE', 'finance.manage');

create table public.financial_expenses (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  request_id uuid not null unique,
  description text not null check (char_length(btrim(description)) between 3 and 200),
  category text not null check (category in (
    'FORNECEDOR','ALUGUEL','ENERGIA','AGUA','INTERNET','FUNCIONARIOS','IMPOSTOS',
    'MERCADORIAS','MANUTENCAO','MARKETING','TAXAS','OUTROS')),
  supplier_name text not null default '' check (char_length(supplier_name) <= 160),
  amount numeric(14,2) not null check (amount > 0),
  due_on date not null,
  status text not null default 'PENDENTE' check (status in ('PENDENTE','PAGA','CANCELADA')),
  paid_on date,
  payment_method text check (payment_method in
    ('DINHEIRO','PIX','CARTAO_DEBITO','CARTAO_CREDITO','BOLETO','TRANSFERENCIA','OUTRO')),
  notes text not null default '' check (char_length(notes) <= 500),
  settled_by uuid references public.profiles(id) on delete restrict,
  cancelled_at timestamptz,
  cancelled_by uuid references public.profiles(id) on delete restrict,
  constraint financial_expense_state check (
    (status = 'PENDENTE' and paid_on is null and payment_method is null and settled_by is null and cancelled_at is null and cancelled_by is null)
    or (status = 'PAGA' and paid_on is not null and payment_method is not null and settled_by is not null and cancelled_at is null and cancelled_by is null)
    or (status = 'CANCELADA' and paid_on is null and payment_method is null and settled_by is null and cancelled_at is not null and cancelled_by is not null)
  )
);
create index financial_expenses_due_idx on public.financial_expenses(due_on, id) where status = 'PENDENTE';
create index financial_expenses_created_idx on public.financial_expenses(created_at desc);
create index financial_expenses_status_idx on public.financial_expenses(status, due_on);

create table public.financial_receivables (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  request_id uuid not null unique,
  description text not null check (char_length(btrim(description)) between 3 and 200),
  payer_name text not null default '' check (char_length(payer_name) <= 160),
  amount numeric(14,2) not null check (amount > 0),
  due_on date not null,
  status text not null default 'PENDENTE' check (status in ('PENDENTE','RECEBIDA','CANCELADA')),
  received_on date,
  payment_method text check (payment_method in
    ('DINHEIRO','PIX','CARTAO_DEBITO','CARTAO_CREDITO','BOLETO','TRANSFERENCIA','OUTRO')),
  notes text not null default '' check (char_length(notes) <= 500),
  settled_by uuid references public.profiles(id) on delete restrict,
  cancelled_at timestamptz,
  cancelled_by uuid references public.profiles(id) on delete restrict,
  constraint financial_receivable_state check (
    (status = 'PENDENTE' and received_on is null and payment_method is null and settled_by is null and cancelled_at is null and cancelled_by is null)
    or (status = 'RECEBIDA' and received_on is not null and payment_method is not null and settled_by is not null and cancelled_at is null and cancelled_by is null)
    or (status = 'CANCELADA' and received_on is null and payment_method is null and settled_by is null and cancelled_at is not null and cancelled_by is not null)
  )
);
create index financial_receivables_due_idx on public.financial_receivables(due_on, id) where status = 'PENDENTE';
create index financial_receivables_created_idx on public.financial_receivables(created_at desc);
create index financial_receivables_status_idx on public.financial_receivables(status, due_on);

alter table public.financial_entries
  alter column sale_id drop not null,
  add column receivable_id uuid references public.financial_receivables(id) on delete restrict,
  add column request_id uuid unique,
  add column description text not null default '' check (char_length(description) <= 200),
  add column payment_method text check (payment_method in
    ('DINHEIRO','PIX','CARTAO_DEBITO','CARTAO_CREDITO','BOLETO','TRANSFERENCIA','OUTRO')),
  add column received_on date not null default (now() at time zone 'America/Sao_Paulo')::date,
  add column notes text not null default '' check (char_length(notes) <= 500),
  drop constraint financial_entries_type_check,
  drop constraint financial_entries_amount_check,
  add constraint financial_entries_type_check check (type in ('RECEITA','ESTORNO','RECEITA_MANUAL')),
  add constraint financial_entries_amount_check check (
    (type = 'RECEITA' and amount > 0 and sale_id is not null and receivable_id is null and request_id is null)
    or (type = 'ESTORNO' and amount < 0 and sale_id is not null and receivable_id is null and request_id is null)
    or (type = 'RECEITA_MANUAL' and amount > 0 and sale_id is null and
      char_length(btrim(description)) between 3 and 200 and payment_method is not null and
      ((receivable_id is null and request_id is not null) or
       (receivable_id is not null and request_id is null)))
  );
create unique index financial_receivable_entry_unique on public.financial_entries(receivable_id)
  where receivable_id is not null;
create index financial_entries_received_idx on public.financial_entries(received_on desc, created_at desc);

alter table public.financial_expenses enable row level security;
alter table public.financial_receivables enable row level security;
revoke all on public.financial_expenses, public.financial_receivables from public, anon, authenticated;
grant select on public.financial_expenses, public.financial_receivables to authenticated;
create policy financial_expenses_read on public.financial_expenses for select to authenticated
  using ((select private.has_permission('finance.read')));
create policy financial_receivables_read on public.financial_receivables for select to authenticated
  using ((select private.has_permission('finance.read')));

create function public.create_financial_expense(
  p_request_id uuid, p_description text, p_category text, p_supplier_name text,
  p_amount numeric, p_due_on date, p_notes text default ''
) returns public.financial_expenses
language plpgsql security definer set search_path = '' as $$
declare v_row public.financial_expenses;
begin
  if not private.has_permission('finance.manage') or (select auth.uid()) is null then
    raise exception 'finance_permission_denied' using errcode = '42501';
  end if;
  if p_request_id is null or p_description is null or char_length(btrim(p_description)) not between 3 and 200 or
    p_category is null or p_category not in ('FORNECEDOR','ALUGUEL','ENERGIA','AGUA','INTERNET','FUNCIONARIOS','IMPOSTOS','MERCADORIAS','MANUTENCAO','MARKETING','TAXAS','OUTROS') or
    p_supplier_name is null or char_length(btrim(p_supplier_name)) > 160 or
    p_amount is null or p_amount <= 0 or p_amount > 999999999999.99 or p_amount <> trunc(p_amount, 2) or
    p_due_on is null or p_notes is null or char_length(p_notes) > 500 then
    raise exception 'finance_invalid_input' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text, 0));
  select * into v_row from public.financial_expenses where request_id = p_request_id;
  if found then
    if v_row.created_by <> (select auth.uid()) or v_row.description <> btrim(p_description) or
      v_row.category <> p_category or v_row.supplier_name <> btrim(p_supplier_name) or
      v_row.amount <> p_amount or v_row.due_on <> p_due_on or v_row.notes <> btrim(p_notes) then
      raise exception 'finance_request_reused' using errcode = '22023';
    end if;
    return v_row;
  end if;
  insert into public.financial_expenses (created_by, request_id, description, category, supplier_name, amount, due_on, notes)
    values ((select auth.uid()), p_request_id, btrim(p_description), p_category, btrim(p_supplier_name), p_amount, p_due_on, btrim(p_notes))
    returning * into v_row;
  insert into public.audit_logs (user_id, action, entity, entity_id, after_data)
    values ((select auth.uid()), 'FINANCE_EXPENSE_CREATED', 'financial_expenses', v_row.id,
      jsonb_build_object('amount', p_amount, 'due_on', p_due_on, 'category', p_category));
  return v_row;
end;
$$;

create function public.settle_financial_expense(p_id uuid, p_paid_on date, p_payment_method text)
returns public.financial_expenses language plpgsql security definer set search_path = '' as $$
declare v_row public.financial_expenses;
begin
  if not private.has_permission('finance.manage') or (select auth.uid()) is null then
    raise exception 'finance_permission_denied' using errcode = '42501';
  end if;
  if p_id is null or p_paid_on is null or p_payment_method is null or
    p_payment_method not in ('DINHEIRO','PIX','CARTAO_DEBITO','CARTAO_CREDITO','BOLETO','TRANSFERENCIA','OUTRO') then
    raise exception 'finance_invalid_input' using errcode = '22023';
  end if;
  select * into v_row from public.financial_expenses where id = p_id for update;
  if not found then raise exception 'finance_not_found' using errcode = '22023'; end if;
  if v_row.status = 'PAGA' and v_row.paid_on = p_paid_on and v_row.payment_method = p_payment_method then return v_row; end if;
  if v_row.status <> 'PENDENTE' then raise exception 'finance_already_resolved' using errcode = '22023'; end if;
  update public.financial_expenses set status = 'PAGA', paid_on = p_paid_on,
    payment_method = p_payment_method, settled_by = (select auth.uid())
    where id = p_id returning * into v_row;
  insert into public.audit_logs (user_id, action, entity, entity_id, after_data)
    values ((select auth.uid()), 'FINANCE_EXPENSE_PAID', 'financial_expenses', p_id,
      jsonb_build_object('paid_on', p_paid_on, 'payment_method', p_payment_method, 'amount', v_row.amount));
  return v_row;
end;
$$;

create function public.cancel_financial_expense(p_id uuid)
returns public.financial_expenses language plpgsql security definer set search_path = '' as $$
declare v_row public.financial_expenses;
begin
  if not private.has_permission('finance.manage') or (select auth.uid()) is null then
    raise exception 'finance_permission_denied' using errcode = '42501';
  end if;
  if p_id is null then raise exception 'finance_invalid_input' using errcode = '22023'; end if;
  select * into v_row from public.financial_expenses where id = p_id for update;
  if not found then raise exception 'finance_not_found' using errcode = '22023'; end if;
  if v_row.status = 'CANCELADA' then return v_row; end if;
  if v_row.status <> 'PENDENTE' then raise exception 'finance_already_resolved' using errcode = '22023'; end if;
  update public.financial_expenses set status = 'CANCELADA', cancelled_at = now(), cancelled_by = (select auth.uid())
    where id = p_id returning * into v_row;
  insert into public.audit_logs (user_id, action, entity, entity_id, after_data)
    values ((select auth.uid()), 'FINANCE_EXPENSE_CANCELLED', 'financial_expenses', p_id,
      jsonb_build_object('amount', v_row.amount));
  return v_row;
end;
$$;

create function public.create_financial_receivable(
  p_request_id uuid, p_description text, p_payer_name text,
  p_amount numeric, p_due_on date, p_notes text default ''
) returns public.financial_receivables
language plpgsql security definer set search_path = '' as $$
declare v_row public.financial_receivables;
begin
  if not private.has_permission('finance.manage') or (select auth.uid()) is null then
    raise exception 'finance_permission_denied' using errcode = '42501';
  end if;
  if p_request_id is null or p_description is null or char_length(btrim(p_description)) not between 3 and 200 or
    p_payer_name is null or char_length(btrim(p_payer_name)) > 160 or
    p_amount is null or p_amount <= 0 or p_amount > 999999999999.99 or p_amount <> trunc(p_amount, 2) or
    p_due_on is null or p_notes is null or char_length(p_notes) > 500 then
    raise exception 'finance_invalid_input' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text, 0));
  select * into v_row from public.financial_receivables where request_id = p_request_id;
  if found then
    if v_row.created_by <> (select auth.uid()) or v_row.description <> btrim(p_description) or
      v_row.payer_name <> btrim(p_payer_name) or v_row.amount <> p_amount or
      v_row.due_on <> p_due_on or v_row.notes <> btrim(p_notes) then
      raise exception 'finance_request_reused' using errcode = '22023';
    end if;
    return v_row;
  end if;
  insert into public.financial_receivables (created_by, request_id, description, payer_name, amount, due_on, notes)
    values ((select auth.uid()), p_request_id, btrim(p_description), btrim(p_payer_name), p_amount, p_due_on, btrim(p_notes))
    returning * into v_row;
  insert into public.audit_logs (user_id, action, entity, entity_id, after_data)
    values ((select auth.uid()), 'FINANCE_RECEIVABLE_CREATED', 'financial_receivables', v_row.id,
      jsonb_build_object('amount', p_amount, 'due_on', p_due_on));
  return v_row;
end;
$$;

create function public.settle_financial_receivable(p_id uuid, p_received_on date, p_payment_method text)
returns public.financial_receivables language plpgsql security definer set search_path = '' as $$
declare v_row public.financial_receivables;
begin
  if not private.has_permission('finance.manage') or (select auth.uid()) is null then
    raise exception 'finance_permission_denied' using errcode = '42501';
  end if;
  if p_id is null or p_received_on is null or p_payment_method is null or
    p_payment_method not in ('DINHEIRO','PIX','CARTAO_DEBITO','CARTAO_CREDITO','BOLETO','TRANSFERENCIA','OUTRO') then
    raise exception 'finance_invalid_input' using errcode = '22023';
  end if;
  select * into v_row from public.financial_receivables where id = p_id for update;
  if not found then raise exception 'finance_not_found' using errcode = '22023'; end if;
  if v_row.status = 'RECEBIDA' and v_row.received_on = p_received_on and v_row.payment_method = p_payment_method then return v_row; end if;
  if v_row.status <> 'PENDENTE' then raise exception 'finance_already_resolved' using errcode = '22023'; end if;
  insert into public.financial_entries (receivable_id, user_id, type, amount, description, payment_method, received_on, notes)
    values (p_id, (select auth.uid()), 'RECEITA_MANUAL', v_row.amount, v_row.description, p_payment_method, p_received_on, v_row.notes);
  update public.financial_receivables set status = 'RECEBIDA', received_on = p_received_on,
    payment_method = p_payment_method, settled_by = (select auth.uid())
    where id = p_id returning * into v_row;
  insert into public.audit_logs (user_id, action, entity, entity_id, after_data)
    values ((select auth.uid()), 'FINANCE_RECEIVABLE_RECEIVED', 'financial_receivables', p_id,
      jsonb_build_object('received_on', p_received_on, 'payment_method', p_payment_method, 'amount', v_row.amount));
  return v_row;
end;
$$;

create function public.cancel_financial_receivable(p_id uuid)
returns public.financial_receivables language plpgsql security definer set search_path = '' as $$
declare v_row public.financial_receivables;
begin
  if not private.has_permission('finance.manage') or (select auth.uid()) is null then
    raise exception 'finance_permission_denied' using errcode = '42501';
  end if;
  if p_id is null then raise exception 'finance_invalid_input' using errcode = '22023'; end if;
  select * into v_row from public.financial_receivables where id = p_id for update;
  if not found then raise exception 'finance_not_found' using errcode = '22023'; end if;
  if v_row.status = 'CANCELADA' then return v_row; end if;
  if v_row.status <> 'PENDENTE' then raise exception 'finance_already_resolved' using errcode = '22023'; end if;
  update public.financial_receivables set status = 'CANCELADA', cancelled_at = now(), cancelled_by = (select auth.uid())
    where id = p_id returning * into v_row;
  insert into public.audit_logs (user_id, action, entity, entity_id, after_data)
    values ((select auth.uid()), 'FINANCE_RECEIVABLE_CANCELLED', 'financial_receivables', p_id,
      jsonb_build_object('amount', v_row.amount));
  return v_row;
end;
$$;

create function public.record_manual_revenue(
  p_request_id uuid, p_description text, p_amount numeric,
  p_received_on date, p_payment_method text, p_notes text default ''
) returns public.financial_entries
language plpgsql security definer set search_path = '' as $$
declare v_row public.financial_entries;
begin
  if not private.has_permission('finance.manage') or (select auth.uid()) is null then
    raise exception 'finance_permission_denied' using errcode = '42501';
  end if;
  if p_request_id is null or p_description is null or char_length(btrim(p_description)) not between 3 and 200 or
    p_amount is null or p_amount <= 0 or p_amount > 999999999999.99 or p_amount <> trunc(p_amount, 2) or
    p_received_on is null or p_payment_method is null or
    p_payment_method not in ('DINHEIRO','PIX','CARTAO_DEBITO','CARTAO_CREDITO','BOLETO','TRANSFERENCIA','OUTRO') or
    p_notes is null or char_length(p_notes) > 500 then
    raise exception 'finance_invalid_input' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text, 0));
  select * into v_row from public.financial_entries where request_id = p_request_id;
  if found then
    if v_row.user_id <> (select auth.uid()) or v_row.description <> btrim(p_description) or
      v_row.amount <> p_amount or v_row.received_on <> p_received_on or
      v_row.payment_method <> p_payment_method or v_row.notes <> btrim(p_notes) then
      raise exception 'finance_request_reused' using errcode = '22023';
    end if;
    return v_row;
  end if;
  insert into public.financial_entries (user_id, type, amount, request_id, description, payment_method, received_on, notes)
    values ((select auth.uid()), 'RECEITA_MANUAL', p_amount, p_request_id, btrim(p_description), p_payment_method, p_received_on, btrim(p_notes))
    returning * into v_row;
  insert into public.audit_logs (user_id, action, entity, entity_id, after_data)
    values ((select auth.uid()), 'FINANCE_REVENUE_CREATED', 'financial_entries', v_row.id,
      jsonb_build_object('amount', p_amount, 'received_on', p_received_on, 'payment_method', p_payment_method));
  return v_row;
end;
$$;

revoke all on function public.create_financial_expense(uuid,text,text,text,numeric,date,text),
  public.settle_financial_expense(uuid,date,text), public.cancel_financial_expense(uuid),
  public.create_financial_receivable(uuid,text,text,numeric,date,text),
  public.settle_financial_receivable(uuid,date,text), public.cancel_financial_receivable(uuid),
  public.record_manual_revenue(uuid,text,numeric,date,text,text)
  from public, anon, authenticated;
grant execute on function public.create_financial_expense(uuid,text,text,text,numeric,date,text),
  public.settle_financial_expense(uuid,date,text), public.cancel_financial_expense(uuid),
  public.create_financial_receivable(uuid,text,text,numeric,date,text),
  public.settle_financial_receivable(uuid,date,text), public.cancel_financial_receivable(uuid),
  public.record_manual_revenue(uuid,text,numeric,date,text,text)
  to authenticated;
