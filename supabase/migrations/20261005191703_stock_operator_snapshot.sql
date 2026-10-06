-- Preserva no histórico o nome do responsável mesmo se o perfil mudar depois.
alter table public.stock_movements
add column operator_name text not null default '' check (char_length(operator_name) <= 120);

create function private.set_stock_operator_name()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  select coalesce(nullif(btrim(display_name), ''), 'Usuário ' || left(new.user_id::text, 8))
  into new.operator_name
  from public.profiles where id = new.user_id;
  if new.operator_name is null then
    raise exception 'stock_operator_not_found' using errcode = '23503';
  end if;
  return new;
end;
$$;
revoke all on function private.set_stock_operator_name() from public, anon, authenticated;
create trigger stock_operator_snapshot before insert on public.stock_movements
for each row execute function private.set_stock_operator_name();
