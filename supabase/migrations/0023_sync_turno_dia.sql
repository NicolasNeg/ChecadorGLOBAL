-- ═══════════════════════════════════════════════════════════════════════════
-- 0023: verificar_pin resuelve el TURNO DE HOY, no el turno fijo del empleado.
-- Cascada (híbrido inteligente):
--   1. turnos_dia[empleado, current_date]            → asignación real por fecha
--   2. si tiene otras filas en turnos_dia pero no hoy → descanso (turno nulo)
--   3. horarios_semana[empleado, isodow(hoy)]         → plantilla recurrente
--   4. empleados.turno_id                             → turno fijo (legacy)
-- Misma firma de retorno que 0006 (no cambian columnas para no romper api.js).
-- ═══════════════════════════════════════════════════════════════════════════

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
language sql security definer set search_path = public, extensions
as $$
  with emp as (
    select e.* from empleados e
    where e.activo = true and e.pin_hash = crypt(p_pin, e.pin_hash)
    limit 1
  ),
  resuelto as (
    select emp.*,
      coalesce(
        (select d.turno_id from turnos_dia d
          where d.id_empleado = emp.id and d.fecha = current_date),
        case
          when exists (select 1 from turnos_dia d where d.id_empleado = emp.id)
            then null  -- usa el sistema por fecha y hoy no tiene turno → descanso
          else coalesce(
            (select h.turno_id from horarios_semana h
              where h.id_empleado = emp.id
                and h.dia_semana = extract(isodow from current_date)::int),
            emp.turno_id  -- turno fijo legacy
          )
        end
      ) as turno_efectivo_id
    from emp
  )
  select r.id, r.nombre, r.numero_empleado, r.puesto, r.email, r.telefono, r.rol,
         r.plaza_id, r.turno_efectivo_id,
         p.nombre, t.nombre, t.hora_entrada, t.hora_salida
  from   resuelto r
  left join plazas p on p.id = r.plaza_id
  left join turnos t on t.id = r.turno_efectivo_id;
$$;

revoke all on function verificar_pin(text) from public, anon, authenticated;
grant  execute on function verificar_pin(text) to service_role, anon;
