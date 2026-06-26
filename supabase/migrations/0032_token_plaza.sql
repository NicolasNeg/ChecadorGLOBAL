-- Token de seguridad por plaza: paso previo al PIN. El admin de la plaza lo
-- genera (y lo comparte por QR o texto); el empleado lo ingresa UNA vez por
-- dispositivo y queda habilitado. Persiste en localStorage del cliente.
alter table plazas
  add column if not exists token_seguridad       text,
  add column if not exists token_actualizado_en  timestamptz;

-- Verifica un token de plaza. Comparación insensible a mayúsculas, espacios y
-- guiones (el código se muestra como "ABCD-EFGH" pero se guarda sin guion), así
-- el empleado puede teclearlo con o sin formato. Devuelve la plaza dueña o nada.
-- ponytail: el límite de 3 intentos vive en el cliente (localStorage); el
-- rate-limit real debe ir server-side, igual que en verificar_pin. Upgrade path:
-- contar intentos por IP/plaza en una tabla y bloquear en el RPC.
drop function if exists verificar_token_plaza(text);
create function verificar_token_plaza(p_token text)
returns table(plaza_id bigint, plaza_nombre text)
language sql security definer set search_path = public
as $$
  select id, nombre from plazas
  where activo = true
    and token_seguridad is not null
    and regexp_replace(upper(token_seguridad), '[^A-Z0-9]', '', 'g')
      = regexp_replace(upper(btrim(p_token)), '[^A-Z0-9]', '', 'g')
  limit 1;
$$;
revoke all on function verificar_token_plaza(text) from public, anon, authenticated;
grant  execute on function verificar_token_plaza(text) to anon, service_role;
