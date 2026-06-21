-- ═══════════════════════════════════════════════════════════════════════════
-- 0013: RPC anon turnos_plaza — horario semanal de TODOS los compañeros de la
-- plaza del empleado. El checador muestra la misma cuadrícula que el admin para
-- que cada quien sepa con quién le toca trabajar.
-- ═══════════════════════════════════════════════════════════════════════════

-- ponytail: confía en el id que pasa el cliente, igual que mis_turnos/obtener_historial.
-- Upgrade: derivar el id de un token HMAC firmado (Edge Functions) en vez del cliente.
create or replace function turnos_plaza(p_id_empleado bigint)
returns table(
  empleado_id   bigint,
  empleado      text,
  dia_semana    int,
  turno_nombre  text,
  hora_entrada  time,
  hora_salida   time
)
language sql security definer set search_path = public, extensions as $$
  select e.id, e.nombre, h.dia_semana, t.nombre, t.hora_entrada, t.hora_salida
  from   empleados e
  join   horarios_semana h on h.id_empleado = e.id
  join   turnos t          on t.id = h.turno_id
  where  e.activo
    and  e.plaza_id = (select plaza_id from empleados where id = p_id_empleado)
  order  by e.nombre, h.dia_semana;
$$;

revoke all on function turnos_plaza(bigint) from public;
grant  execute on function turnos_plaza(bigint) to anon, service_role;
