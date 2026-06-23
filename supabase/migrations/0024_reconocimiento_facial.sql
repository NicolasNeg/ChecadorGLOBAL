-- ═══════════════════════════════════════════════════════════════════════════
-- 0024: reconocimiento facial. Vector de embedding en empleados (NO la imagen),
-- resultado de verificación por registro, y verificar_pin devuelve el descriptor.
-- verificar_pin conserva la cascada de turno de 0023 y SOLO añade face_descriptor.
-- ═══════════════════════════════════════════════════════════════════════════

alter table empleados  add column if not exists face_descriptor jsonb;
alter table registros  add column if not exists rostro_verificado boolean not null default false;
alter table registros  add column if not exists viveza            numeric;
alter table registros  add column if not exists similitud         numeric;

-- ── verificar_pin: cascada de turno (0023) + face_descriptor ────────────────
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
  turno_salida    time,
  face_descriptor jsonb
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
            then null
          else coalesce(
            (select h.turno_id from horarios_semana h
              where h.id_empleado = emp.id
                and h.dia_semana = extract(isodow from current_date)::int),
            emp.turno_id
          )
        end
      ) as turno_efectivo_id
    from emp
  )
  select r.id, r.nombre, r.numero_empleado, r.puesto, r.email, r.telefono, r.rol,
         r.plaza_id, r.turno_efectivo_id,
         p.nombre, t.nombre, t.hora_entrada, t.hora_salida,
         r.face_descriptor
  from   resuelto r
  left join plazas p on p.id = r.plaza_id
  left join turnos t on t.id = r.turno_efectivo_id;
$$;
revoke all on function verificar_pin(text) from public, anon, authenticated;
grant  execute on function verificar_pin(text) to service_role, anon;

-- ── Registrar/actualizar el descriptor facial (auto-enroll, anon) ───────────
-- ponytail: confía en el id que pasa el cliente, igual que obtener_historial.
-- Upgrade: derivar el id de un token HMAC firmado (Edge Functions).
-- El UPDATE queda auditado por el trigger fn_audit_log de empleados → aparece
-- en "Historial de cambios".
create or replace function registrar_descriptor_facial(p_id_empleado bigint, p_descriptor jsonb)
returns void
language sql security definer set search_path = public as $$
  update empleados set face_descriptor = p_descriptor where id = p_id_empleado;
$$;
revoke all on function registrar_descriptor_facial(bigint, jsonb) from public;
grant  execute on function registrar_descriptor_facial(bigint, jsonb) to anon, service_role;
