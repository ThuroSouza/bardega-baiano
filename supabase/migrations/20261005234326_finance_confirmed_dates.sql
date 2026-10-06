-- Uma baixa ou receita confirmada não pode ter data futura.
create function private.validate_financial_confirmed_date()
returns trigger language plpgsql set search_path = '' as $$
declare v_today date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  if tg_table_name = 'financial_expenses' and new.status = 'PAGA' and new.paid_on > v_today then
    raise exception 'finance_future_date' using errcode = '22023';
  end if;
  if tg_table_name = 'financial_receivables' and new.status = 'RECEBIDA' and new.received_on > v_today then
    raise exception 'finance_future_date' using errcode = '22023';
  end if;
  if tg_table_name = 'financial_entries' and new.type = 'RECEITA_MANUAL' and new.received_on > v_today then
    raise exception 'finance_future_date' using errcode = '22023';
  end if;
  return new;
end;
$$;
revoke all on function private.validate_financial_confirmed_date() from public, anon, authenticated;
create trigger financial_expenses_date_guard before insert or update on public.financial_expenses
for each row execute function private.validate_financial_confirmed_date();
create trigger financial_receivables_date_guard before insert or update on public.financial_receivables
for each row execute function private.validate_financial_confirmed_date();
create trigger financial_entries_date_guard before insert or update on public.financial_entries
for each row execute function private.validate_financial_confirmed_date();
