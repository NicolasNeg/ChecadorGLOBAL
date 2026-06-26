-- verificar_pin devuelve también foto_url para que la foto de perfil (que el
-- admin ya sube en empleados.foto_url) persista en la sesión del empleado y se
-- muestre en su menú. Sólo añade foto_url; conserva la cascada de turno (0023)
-- y el face_descriptor (0024).
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
  face_descriptor jsonb,
  foto_url        text
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
         r.face_descriptor, r.foto_url
  from   resuelto r
  left join plazas p on p.id = r.plaza_id
  left join turnos t on t.id = r.turno_efectivo_id;
$$;
revoke all on function verificar_pin(text) from public, anon, authenticated;
grant  execute on function verificar_pin(text) to service_role, anon;
