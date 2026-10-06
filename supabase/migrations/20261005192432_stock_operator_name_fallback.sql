-- Quando o perfil ainda não tiver nome, mostra o identificador do e-mail
-- sem expor o endereço completo no histórico de estoque.
create or replace function private.set_stock_operator_name()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  select coalesce(
    nullif(btrim(p.display_name), ''),
    nullif(left(split_part(u.email, '@', 1), 120), ''),
    'Usuário ' || left(new.user_id::text, 8)
  ) into new.operator_name
  from public.profiles p join auth.users u on u.id = p.id
  where p.id = new.user_id;
  if new.operator_name is null then
    raise exception 'stock_operator_not_found' using errcode = '23503';
  end if;
  return new;
end;
$$;
