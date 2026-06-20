-- ═══════════════════════════════════════════════════════════════════════════
-- 0011: pausa en turnos, foto de perfil en empleados, y asignación semanal
-- de turnos por día (estilo cuadrícula). + RPC anon mis_turnos para el checador.
-- ═══════════════════════════════════════════════════════════════════════════

-- Pausa (comida/descanso) por turno, en minutos.
alter table turnos
  add column if not exists pausa_min int not null default 0 check (pausa_min >= 0);

-- Foto de perfil del empleado (URL pública del bucket 'fotos').
alter table empleados
  add column if not exists foto_url text;

-- ── Asignación semanal: qué turno trabaja cada empleado por día ────────────
-- dia_semana: 1=lun … 7=dom. Un turno por (empleado, día).
create table if not exists horarios_semana (
  id          bigserial primary key,
  id_empleado bigint not null references empleados(id) on delete cascade,
  dia_semana  int not null check (dia_semana between 1 and 7),
  turno_id    bigint not null references turnos(id) on delete cascade,
  created_at  timestamptz not null default now(),
  unique (id_empleado, dia_semana)
);

create index if not exists idx_horarios_empleado on horarios_semana(id_empleado);

-- ── Audit log automático (mismo patrón que plazas/turnos/empleados) ────────
drop trigger if exists audit_horarios on horarios_semana;
create trigger audit_horarios
  after insert or update or delete on horarios_semana
  for each row execute function fn_audit_log();

-- ── RLS ────────────────────────────────────────────────────────────────────
alter table horarios_semana enable row level security;

drop policy if exists "rh_all_horarios" on horarios_semana;
create policy "rh_all_horarios" on horarios_semana
  for all to authenticated
  using (mi_rol() = 'rh')
  with check (mi_rol() = 'rh');

drop policy if exists "jefe_horarios" on horarios_semana;
create policy "jefe_horarios" on horarios_semana
  for all to authenticated
  using (mi_rol() = 'jefe' and id_empleado in (
    select id from empleados where plaza_id = mi_plaza_id()
  ))
  with check (mi_rol() = 'jefe' and id_empleado in (
    select id from empleados where plaza_id = mi_plaza_id()
  ));

-- ── RPC: horario semanal del empleado (checador, anon) ─────────────────────
-- ponytail: confía en el id que pasa el cliente, igual que obtener_historial.
create or replace function mis_turnos(p_id_empleado bigint)
returns table(
  dia_semana    int,
  turno_nombre  text,
  hora_entrada  time,
  hora_salida   time,
  pausa_min     int
)
language sql security definer set search_path = public, extensions as $$
  select h.dia_semana, t.nombre, t.hora_entrada, t.hora_salida, t.pausa_min
  from   horarios_semana h
  join   turnos t on t.id = h.turno_id
  where  h.id_empleado = p_id_empleado
  order  by h.dia_semana;
$$;

revoke all on function mis_turnos(bigint) from public;
grant  execute on function mis_turnos(bigint) to anon, service_role;
