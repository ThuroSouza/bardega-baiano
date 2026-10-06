-- Imagens passam exclusivamente pela Edge Function com validação do conteúdo.
revoke insert (image_path), update (image_path)
  on public.products from authenticated;

-- O backend atualiza a imagem e grava a auditoria na mesma transação.
create function public.set_product_image_path(
  p_product_id uuid, p_expected_path text, p_new_path text, p_actor_id uuid
) returns void language plpgsql security definer set search_path = '' as $$
declare v_old_path text;
begin
  if p_product_id is null or p_actor_id is null or not exists (
    select 1 from public.profiles p
      join private.role_permissions rp on rp.role = p.role
      where p.id = p_actor_id and p.is_active and rp.permission = 'products.manage'
  ) then
    raise exception 'products_permission_denied' using errcode = '42501';
  end if;
  if p_new_path is not null and (
    p_new_path !~ ('^products/' || p_product_id::text || '/[0-9a-f-]+[.](jpg|jpeg|png|webp)$')
    or not exists (select 1 from storage.objects o
      where o.bucket_id = 'product-images' and o.name = p_new_path)
  ) then
    raise exception 'image_invalid_path' using errcode = '22023';
  end if;
  select image_path into v_old_path from public.products
    where id = p_product_id for update;
  if not found then raise exception 'image_product_not_found' using errcode = '22023'; end if;
  if v_old_path is distinct from p_expected_path then
    raise exception 'image_product_changed' using errcode = '22023';
  end if;
  if v_old_path is not distinct from p_new_path then return; end if;
  update public.products set image_path = p_new_path where id = p_product_id;
  insert into public.audit_logs(user_id,action,entity,entity_id,before_data,after_data)
    values (p_actor_id,'PRODUCT_IMAGE_UPDATED','products',p_product_id,
      jsonb_build_object('image_path',v_old_path),
      jsonb_build_object('image_path',p_new_path));
end;
$$;
revoke all on function public.set_product_image_path(uuid,text,text,uuid)
  from public, anon, authenticated;
grant execute on function public.set_product_image_path(uuid,text,text,uuid)
  to service_role;
