-- ═══════════════════════════════════════════════════════════════════════════
-- 0020: distribución de turnos POR FECHA (historial semanal tipo Excel).
-- horarios_semana (0011) sigue siendo la plantilla recurrente que usa el
-- cálculo de retardos; esta tabla guarda la asignación real día por día, con
-- historial: cada semana queda registrada y las semanas pasadas son inmutables.
-- ═══════════════════════════════════════════════════════════════════════════

-- Una fila = ese empleado trabaja ese turno esa fecha. Sin fila = descanso/Off.
create table if not exists turnos_dia (
  id          bigserial primary key,
  id_empleado bigint not null references empleados(id) on delete cascade,
  fecha       date   not null,
  turno_id    bigint not null references turnos(id) on delete cascade,
  created_at  timestamptz not null default now(),
  unique (id_empleado, fecha)
);

create index if not exists idx_turnos_dia_fecha on turnos_dia(fecha);

drop trigger if exists audit_turnos_dia on turnos_dia;
create trigger audit_turnos_dia
  after insert or update or delete on turnos_dia
  for each row execute function fn_audit_log();

-- ── RLS ──────────────────────────────────────────────────────────────────────
alter table turnos_dia enable row level security;

-- Alcance por rol: rh ve todo; jefe solo empleados de su plaza.
-- Guarda de inmutabilidad: solo se puede escribir de la semana actual en adelante
-- (date_trunc('week') devuelve el lunes ISO). Las semanas pasadas quedan
-- bloqueadas a nivel DB, no solo en la UI.
-- ponytail: si rh necesita corregir una semana pasada, quita el guard de fecha
-- en sus políticas de write (o hazlo vía service_role); hoy nadie puede editarlas.

drop policy if exists "td_select"  on turnos_dia;
drop policy if exists "td_insert"  on turnos_dia;
drop policy if exists "td_update"  on turnos_dia;
drop policy if exists "td_delete"  on turnos_dia;

create policy "td_select" on turnos_dia
  for select to authenticated
  using (
    mi_rol() = 'rh'
    or (mi_rol() = 'jefe' and id_empleado in (select id from empleados where plaza_id = mi_plaza_id()))
  );

create policy "td_insert" on turnos_dia
  for insert to authenticated
  with check (
    fecha >= date_trunc('week', current_date)::date
    and (
      mi_rol() = 'rh'
      or (mi_rol() = 'jefe' and id_empleado in (select id from empleados where plaza_id = mi_plaza_id()))
    )
  );

create policy "td_update" on turnos_dia
  for update to authenticated
  using (
    fecha >= date_trunc('week', current_date)::date
    and (mi_rol() = 'rh' or (mi_rol() = 'jefe' and id_empleado in (select id from empleados where plaza_id = mi_plaza_id())))
  )
  with check (
    fecha >= date_trunc('week', current_date)::date
    and (mi_rol() = 'rh' or (mi_rol() = 'jefe' and id_empleado in (select id from empleados where plaza_id = mi_plaza_id())))
  );

create policy "td_delete" on turnos_dia
  for delete to authenticated
  using (
    fecha >= date_trunc('week', current_date)::date
    and (mi_rol() = 'rh' or (mi_rol() = 'jefe' and id_empleado in (select id from empleados where plaza_id = mi_plaza_id())))
  );

-- ── RPC: distribución de la plaza por rango de fechas (checador, anon) ────────
-- Mismo patrón que turnos_plaza, pero por fecha real en vez de día recurrente.
-- ponytail: confía en el id que pasa el cliente, igual que turnos_plaza.
-- Upgrade: derivar el id de un token HMAC firmado (Edge Functions).
create or replace function turnos_plaza_rango(p_id_empleado bigint, p_desde date, p_hasta date)
returns table(
  empleado_id   bigint,
  empleado      text,
  fecha         date,
  turno_nombre  text,
  hora_entrada  time,
  hora_salida   time,
  pausa_min     int
)
language sql security definer set search_path = public, extensions as $$
  select e.id, e.nombre, d.fecha, t.nombre, t.hora_entrada, t.hora_salida, t.pausa_min
  from   empleados e
  join   turnos_dia d on d.id_empleado = e.id and d.fecha between p_desde and p_hasta
  join   turnos t     on t.id = d.turno_id
  where  e.activo
    and  e.plaza_id = (select plaza_id from empleados where id = p_id_empleado)
  order  by e.nombre, d.fecha;
$$;

revoke all on function turnos_plaza_rango(bigint, date, date) from public;
grant  execute on function turnos_plaza_rango(bigint, date, date) to anon, service_role;
