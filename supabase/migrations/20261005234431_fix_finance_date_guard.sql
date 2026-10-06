-- Cada ramificação usa apenas colunas que existem na tabela do gatilho.
create or replace function private.validate_financial_confirmed_date()
returns trigger language plpgsql set search_path = '' as $$
declare v_today date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  if tg_table_name = 'financial_expenses' then
    if new.status = 'PAGA' and new.paid_on > v_today then
      raise exception 'finance_future_date' using errcode = '22023';
    end if;
  elsif tg_table_name = 'financial_receivables' then
    if new.status = 'RECEBIDA' and new.received_on > v_today then
      raise exception 'finance_future_date' using errcode = '22023';
    end if;
  elsif tg_table_name = 'financial_entries' then
    if new.type = 'RECEITA_MANUAL' and new.received_on > v_today then
      raise exception 'finance_future_date' using errcode = '22023';
    end if;
  end if;
  return new;
end;
$$;
