-- Credencial / gafete: código opaco por empleado que codifica el QR del gafete.
-- NO es el id interno ni el PIN; es un uuid público que solo da acceso a datos
-- no sensibles vía verificar_credencial. Así la verificación pública queda
-- desligada del id_empleado (techo conocido del MVP en las RPC de historial).
alter table empleados
  add column if not exists credencial_codigo uuid not null default gen_random_uuid();
-- unique para buscar por él (el default ya rellena los registros existentes).
create unique index if not exists empleados_credencial_codigo_key on empleados(credencial_codigo);

-- Verifica una credencial por su código. Devuelve SOLO datos públicos seguros
-- (nada de PIN, email, teléfono ni id). La página pública /verificar la llama.
-- ponytail: sin rate-limit propio; superficie mínima (solo lectura no sensible).
-- Upgrade path: contar lecturas por código en una tabla si se detecta abuso.
drop function if exists verificar_credencial(uuid);
create function verificar_credencial(p_codigo uuid)
returns table(nombre text, numero_empleado text, puesto text, plaza_nombre text, foto_url text, activo boolean)
language sql security definer set search_path = public
as $$
  select e.nombre, e.numero_empleado, e.puesto, p.nombre, e.foto_url, e.activo
  from empleados e
  left join plazas p on p.id = e.plaza_id
  where e.credencial_codigo = p_codigo
  limit 1;
$$;
revoke all on function verificar_credencial(uuid) from public, anon, authenticated;
grant  execute on function verificar_credencial(uuid) to anon, service_role;
