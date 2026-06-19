-- ═══════════════════════════════════════════════════════════════════════════
-- 0007_historial_firma.sql
-- obtener_historial ahora también devuelve ruta_firma, para mostrar la firma
-- (no solo la foto) en el historial del empleado.
-- ═══════════════════════════════════════════════════════════════════════════

-- El tipo de retorno cambia (nueva columna) → hay que DROP antes de recrear.
drop function if exists obtener_historial(bigint, int);
create function obtener_historial(p_id_empleado bigint, p_limit int default 50)
returns table(
  id              bigint,
  tipo            text,
  hora            timestamptz,
  latitud         double precision,
  longitud        double precision,
  ruta_foto       text,
  ruta_firma      text,
  geocerca_valida boolean
)
language sql security definer set search_path = public, extensions
as $$
  select r.id, r.tipo, r.hora, r.latitud, r.longitud, r.ruta_foto, r.ruta_firma, r.geocerca_valida
  from   registros r
  where  r.id_empleado = p_id_empleado
  order by r.hora desc
  limit  least(p_limit, 200);
$$;
revoke all on function obtener_historial(bigint, int) from public;
grant  execute on function obtener_historial(bigint, int) to anon, service_role;
