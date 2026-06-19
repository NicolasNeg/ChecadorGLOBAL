-- 0008_incidencias.sql — incidencias manuales (falta/permiso/justificacion/vacaciones)
-- Marcadas por un admin desde el historial del empleado. Idempotente.

create table if not exists incidencias (
  id          bigint generated always as identity primary key,
  id_empleado bigint not null references empleados(id) on delete cascade,
  fecha       date   not null,
  tipo        text   not null check (tipo in ('falta','permiso','justificacion','vacaciones')),
  nota        text,
  created_by  uuid   references perfiles_admin(id) default auth.uid(),
  created_at  timestamptz not null default now()
);

create index if not exists incidencias_empleado_fecha_idx on incidencias (id_empleado, fecha);

alter table incidencias enable row level security;

-- RH: acceso total
drop policy if exists "rh_all_incidencias" on incidencias;
create policy "rh_all_incidencias" on incidencias
  to authenticated
  using (mi_rol() = 'rh')
  with check (mi_rol() = 'rh');

-- Jefe: solo incidencias de empleados de su plaza
drop policy if exists "jefe_all_incidencias" on incidencias;
create policy "jefe_all_incidencias" on incidencias
  to authenticated
  using (
    mi_rol() = 'jefe' and
    id_empleado in (select id from empleados where plaza_id = mi_plaza_id())
  )
  with check (
    mi_rol() = 'jefe' and
    id_empleado in (select id from empleados where plaza_id = mi_plaza_id())
  );

-- Auditoría (reusa fn_audit_log de 0004)
drop trigger if exists audit_incidencias on incidencias;
create trigger audit_incidencias
  after insert or update or delete on incidencias
  for each row execute function fn_audit_log();
