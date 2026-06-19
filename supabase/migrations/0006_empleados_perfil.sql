-- ═══════════════════════════════════════════════════════════════════════════
-- 0006_empleados_perfil.sql
-- Perfil profesional del empleado + separación REAL del historial por usuario.
--
-- Antes: el historial se leía con `anon_select_registros using(true)`, así que
-- cualquier cliente anon podía leer TODOS los registros (la separación por
-- empleado era solo un filtro del lado del cliente → cosmética).
--
-- Ahora: el historial se lee por RPC SECURITY DEFINER que filtra por id_empleado,
-- y se elimina el SELECT abierto de anon sobre `registros`.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Campos de perfil profesional ──────────────────────────────────────────
alter table empleados
  add column if not exists numero_empleado text,
  add column if not exists puesto          text,
  add column if not exists email           text,
  add column if not exists telefono        text,
  add column if not exists fecha_ingreso   date,
  add column if not exists rol             text not null default 'empleado'
    check (rol in ('empleado','supervisor','gerente'));

create unique index if not exists idx_empleados_numero
  on empleados(numero_empleado) where numero_empleado is not null;

-- ── verificar_pin: ahora devuelve el perfil completo + plaza + turno ───────
drop function if exists verificar_pin(text);
create function verificar_pin(p_pin text)
returns table(
  id              bigint,
  nombre          text,
  numero_empleado text,
  puesto          text,
  email           text,
  telefono        text,
  rol             text,
  plaza_id        bigint,
  turno_id        bigint,
  plaza_nombre    text,
  turno_nombre    text,
  turno_entrada   time,
  turno_salida    time
)
language sql security definer set search_path = public
as $$
  select e.id, e.nombre, e.numero_empleado, e.puesto, e.email, e.telefono, e.rol,
         e.plaza_id, e.turno_id,
         p.nombre, t.nombre, t.hora_entrada, t.hora_salida
  from   empleados e
  left join plazas p on p.id = e.plaza_id
  left join turnos t on t.id = e.turno_id
  where  e.activo = true
    and  e.pin_hash = crypt(p_pin, e.pin_hash)
  limit 1;
$$;
revoke all on function verificar_pin(text) from public, anon, authenticated;
grant  execute on function verificar_pin(text) to service_role, anon;

-- ── Historial por empleado (SECURITY DEFINER) ──────────────────────────────
-- ponytail: confía en el id que envía el cliente (mismo nivel de confianza que
-- el flujo de PIN actual). Upgrade path = token HMAC de Edge Functions (CLAUDE.md).
create or replace function obtener_historial(p_id_empleado bigint, p_limit int default 50)
returns table(
  id              bigint,
  tipo            text,
  hora            timestamptz,
  latitud         double precision,
  longitud        double precision,
  ruta_foto       text,
  geocerca_valida boolean
)
language sql security definer set search_path = public
as $$
  select r.id, r.tipo, r.hora, r.latitud, r.longitud, r.ruta_foto, r.geocerca_valida
  from   registros r
  where  r.id_empleado = p_id_empleado
  order by r.hora desc
  limit  least(p_limit, 200);
$$;
revoke all on function obtener_historial(bigint, int) from public;
grant  execute on function obtener_historial(bigint, int) to anon, service_role;

-- ── Última entrada del empleado (para calcular duración del turno) ─────────
create or replace function ultima_entrada(p_id_empleado bigint)
returns timestamptz
language sql security definer set search_path = public
as $$
  select r.hora
  from   registros r
  where  r.id_empleado = p_id_empleado and r.tipo = 'entrada'
  order by r.hora desc
  limit 1;
$$;
revoke all on function ultima_entrada(bigint) from public;
grant  execute on function ultima_entrada(bigint) to anon, service_role;

-- ── Cerrar el SELECT abierto: el historial ahora va solo por RPC ───────────
drop policy if exists "anon_select_registros" on registros;
