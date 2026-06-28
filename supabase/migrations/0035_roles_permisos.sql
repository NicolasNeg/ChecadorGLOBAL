-- ═══════════════════════════════════════════════════════════════════════════
-- 0035_roles_permisos.sql — RBAC dirigido por datos.
-- 4 roles jerárquicos (super_admin > rh > jefe > supervisor) + permisos por rol
-- + overrides por usuario. Reemplaza el RBAC hardcoded mi_rol()='rh'/'jefe' y la
-- bandera es_admin_global. Idempotente. Ver docs/superpowers/specs/2026-06-26-…
-- ═══════════════════════════════════════════════════════════════════════════

-- ── §A.1 Catálogo de roles ──────────────────────────────────────────────────
create table if not exists roles (
  clave     text primary key,
  nombre    text not null,
  nivel     int  not null,
  es_global boolean not null default false
);
insert into roles (clave, nombre, nivel, es_global) values
  ('super_admin','Super Administrador',4,true),
  ('rh',         'Recursos Humanos',   3,true),
  ('jefe',       'Jefe de Plaza',      2,false),
  ('supervisor', 'Supervisor',         1,false)
on conflict (clave) do nothing;

-- ── §A.2 perfiles_admin: ampliar enum de rol + migrar es_admin_global ────────
-- El CHECK viejo solo permitía 'rh'/'jefe'. Migrar datos ANTES de re-aplicar el
-- check para no violarlo (super_admin viene de es_admin_global=true).
alter table perfiles_admin drop constraint if exists perfiles_admin_rol_check;
-- El CHECK 'jefe_necesita_plaza' de 0004 era `rol='rh' or plaza_id is not null`,
-- así que super_admin con plaza null lo violaría. Soltarlo ANTES del update y
-- re-aplicarlo con la jerarquía nueva: solo los roles de plaza (jefe/supervisor)
-- requieren plaza; los globales (super_admin/rh) no.
alter table perfiles_admin drop constraint if exists jefe_necesita_plaza;
update perfiles_admin set rol = 'super_admin' where es_admin_global = true;
alter table perfiles_admin add constraint perfiles_admin_rol_check
  check (rol in ('super_admin','rh','jefe','supervisor'));
alter table perfiles_admin add constraint jefe_necesita_plaza
  check (rol in ('super_admin','rh') or plaza_id is not null);

-- ── §A.3 Catálogo de permisos + defaults por rol + overrides por usuario ─────
create table if not exists permisos (
  clave       text primary key,
  zona        text not null,
  descripcion text not null
);

create table if not exists rol_permisos (
  rol     text not null,
  permiso text not null references permisos(clave) on delete cascade,
  primary key (rol, permiso)
);

create table if not exists perfil_permisos (
  perfil_id uuid    not null references perfiles_admin(id) on delete cascade,
  permiso   text    not null references permisos(clave) on delete cascade,
  concedido boolean not null,
  primary key (perfil_id, permiso)
);

insert into permisos (clave, zona, descripcion) values
  ('empleados.ver',    'empleados',  'Ver empleados'),
  ('empleados.editar', 'empleados',  'Crear/editar/dar de baja empleados'),
  ('asistencia.ver',   'asistencia', 'Ver asistencia e historial'),
  ('asistencia.editar','asistencia', 'Marcar incidencias / editar asistencia'),
  ('turnos.ver',       'turnos',     'Ver turnos y distribución'),
  ('turnos.editar',    'turnos',     'Crear/editar turnos y asignar días'),
  ('gafetes.ver',      'gafetes',    'Generar gafetes'),
  ('nominas.ver',      'nominas',    'Ver nóminas'),
  ('nominas.editar',   'nominas',    'Editar nóminas'),
  ('avisos.ver',       'avisos',     'Ver avisos'),
  ('avisos.editar',    'avisos',     'Crear/editar avisos'),
  ('plazas.ver',       'plazas',     'Ver plazas'),
  ('plazas.editar',    'plazas',     'Crear/editar plazas y geocercas'),
  ('puestos.editar',   'puestos',    'Administrar catálogo de puestos'),
  ('usuarios.ver',     'usuarios',   'Ver usuarios administradores'),
  ('usuarios.crear',   'usuarios',   'Crear usuarios administradores'),
  ('usuarios.editar',  'usuarios',   'Editar usuarios y sus permisos'),
  ('config.ver',       'config',     'Ver configuración de la empresa'),
  ('config.editar',    'config',     'Editar configuración de la empresa'),
  ('auditoria.ver',    'auditoria',  'Ver el log de auditoría')
on conflict (clave) do nothing;

-- Defaults por rol. Se re-siembran de forma idempotente.
-- super_admin = TODOS los permisos.
insert into rol_permisos (rol, permiso)
  select 'super_admin', clave from permisos
on conflict do nothing;

-- rh (global): RRHH completo, NO config.editar, NO plazas.editar.
insert into rol_permisos (rol, permiso) values
  ('rh','empleados.ver'),('rh','empleados.editar'),
  ('rh','asistencia.ver'),('rh','asistencia.editar'),
  ('rh','turnos.ver'),('rh','turnos.editar'),
  ('rh','gafetes.ver'),
  ('rh','nominas.ver'),('rh','nominas.editar'),
  ('rh','avisos.ver'),('rh','avisos.editar'),
  ('rh','plazas.ver'),
  ('rh','puestos.editar'),
  ('rh','usuarios.ver'),('rh','usuarios.crear'),('rh','usuarios.editar'),
  ('rh','config.ver'),
  ('rh','auditoria.ver')
on conflict do nothing;

-- jefe (su plaza): "RH de su plaza". nominas solo lectura. Sin config/auditoría.
insert into rol_permisos (rol, permiso) values
  ('jefe','empleados.ver'),('jefe','empleados.editar'),
  ('jefe','asistencia.ver'),('jefe','asistencia.editar'),
  ('jefe','turnos.ver'),('jefe','turnos.editar'),
  ('jefe','gafetes.ver'),
  ('jefe','nominas.ver'),
  ('jefe','avisos.ver'),('jefe','avisos.editar'),
  ('jefe','plazas.ver'),
  ('jefe','usuarios.ver'),('jefe','usuarios.crear'),('jefe','usuarios.editar')
on conflict do nothing;

-- supervisor (su plaza): solo lectura.
insert into rol_permisos (rol, permiso) values
  ('supervisor','empleados.ver'),
  ('supervisor','asistencia.ver'),
  ('supervisor','turnos.ver'),
  ('supervisor','gafetes.ver'),
  ('supervisor','avisos.ver'),
  ('supervisor','plazas.ver')
on conflict do nothing;

-- ── §A.4 Helpers RBAC (security definer, stable) ─────────────────────────────
create or replace function mi_nivel()
returns int language sql stable security definer set search_path = public as $$
  select coalesce(
    (select r.nivel from perfiles_admin p join roles r on r.clave = p.rol
     where p.id = auth.uid() and p.activo = true), 0);
$$;

create or replace function es_global()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    (select r.es_global from perfiles_admin p join roles r on r.clave = p.rol
     where p.id = auth.uid() and p.activo = true), false);
$$;

-- Repunta el helper de 0019 al nuevo modelo (mantiene válidas sus policies).
create or replace function es_admin_global()
returns boolean language sql stable security definer set search_path = public as $$
  select mi_rol() = 'super_admin';
$$;

-- EL gate de permisos: override del perfil gana sobre el default del rol.
create or replace function tiene_permiso(p_clave text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    (select pp.concedido from perfil_permisos pp
       where pp.perfil_id = auth.uid() and pp.permiso = p_clave),
    exists (select 1 from perfiles_admin p
              join rol_permisos rp on rp.rol = p.rol
            where p.id = auth.uid() and p.activo = true and rp.permiso = p_clave)
  );
$$;

-- Reglas de oro: ¿puedo gestionar al perfil objetivo?
create or replace function puede_gestionar(p_objetivo uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when p_objetivo = auth.uid() then false      -- nunca a sí mismo
    when mi_nivel() = 0 then false
    else exists (
      select 1 from perfiles_admin t join roles r on r.clave = t.rol
      where t.id = p_objetivo
        and r.nivel < mi_nivel()                  -- estrictamente inferior
        and (es_global() or t.plaza_id = mi_plaza_id())
    )
  end;
$$;

-- Llaves efectivas del usuario actual (para que el front pinte/oculte).
create or replace function mis_permisos()
returns text[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(p.clave), '{}')
  from permisos p
  where tiene_permiso(p.clave);
$$;

-- Catálogos legibles por cualquier admin (para pintar la matriz) + RPC.
grant select on roles, permisos, rol_permisos to authenticated;
grant execute on function mis_permisos() to authenticated;
grant execute on function mi_nivel(), es_global(), tiene_permiso(text), puede_gestionar(uuid) to authenticated;

-- ── §B Reglas de oro: RLS de gestión de usuarios ─────────────────────────────
-- Limpia las policies viejas de perfiles_admin (0004/0019) y reescribe.
drop policy if exists "rh_all_perfiles"          on perfiles_admin;
drop policy if exists "self_select_perfil"       on perfiles_admin;
drop policy if exists "admin_global_all_perfiles" on perfiles_admin;
-- Idempotencia: las propias policies de §B también se reescriben si ya existían.
drop policy if exists "perfiles_select" on perfiles_admin;
drop policy if exists "perfiles_insert" on perfiles_admin;
drop policy if exists "perfiles_delete" on perfiles_admin;
drop policy if exists "perfiles_update" on perfiles_admin;

-- Ver: la propia fila siempre; ajenas si tengo usuarios.ver y están en mi alcance.
create policy "perfiles_select" on perfiles_admin
  for select to authenticated
  using (
    id = auth.uid()
    or (tiene_permiso('usuarios.ver') and (es_global() or plaza_id = mi_plaza_id()))
  );

-- Crear: necesito usuarios.crear, el rol nuevo debe ser de nivel inferior al mío,
-- y dentro de mi alcance de plaza.
create policy "perfiles_insert" on perfiles_admin
  for insert to authenticated
  with check (
    tiene_permiso('usuarios.crear')
    and (select nivel from roles where clave = rol) < mi_nivel()
    and (es_global() or plaza_id = mi_plaza_id())
  );

-- Borrar: solo a quien puedo gestionar (nunca a mí mismo / pares / superiores).
create policy "perfiles_delete" on perfiles_admin
  for delete to authenticated
  using (puede_gestionar(id));

-- Editar: a quien puedo gestionar, o mi propia fila (el trigger acota columnas).
create policy "perfiles_update" on perfiles_admin
  for update to authenticated
  using (puede_gestionar(id) or id = auth.uid())
  with check (puede_gestionar(id) or id = auth.uid());

-- Trigger guard: cierra a nivel de columna lo que RLS no puede expresar.
create or replace function fn_guard_perfil()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if TG_OP = 'UPDATE' and NEW.id = auth.uid() then
    -- Nadie escala/cambia su propio rol, plaza o estado activo.
    if NEW.rol is distinct from OLD.rol
       or NEW.plaza_id is distinct from OLD.plaza_id
       or NEW.activo is distinct from OLD.activo then
      raise exception 'No puedes cambiar tu propio rol, plaza o estado.';
    end if;
  else
    -- Gestionando a otro (o insertando): el rol resultante debe ser inferior al mío.
    if (select nivel from roles where clave = NEW.rol) >= mi_nivel() then
      raise exception 'No puedes asignar un rol igual o superior al tuyo.';
    end if;
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_guard_perfil on perfiles_admin;
create trigger trg_guard_perfil
  before insert or update on perfiles_admin
  for each row execute function fn_guard_perfil();

-- ── §B.2 Overrides por usuario: solo delego permisos que yo poseo ────────────
alter table perfil_permisos enable row level security;

drop policy if exists "perfil_permisos_rw" on perfil_permisos;
create policy "perfil_permisos_rw" on perfil_permisos
  for all to authenticated
  using (puede_gestionar(perfil_id) and tiene_permiso(permiso))
  with check (puede_gestionar(perfil_id) and tiene_permiso(permiso));

-- Auditoría de cambios de perfiles/overrides (reusa fn_audit_log de 0004).
drop trigger if exists audit_perfiles on perfiles_admin;
create trigger audit_perfiles
  after insert or update or delete on perfiles_admin
  for each row execute function fn_audit_log();

-- ── §C RLS uniforme de tablas de datos ───────────────────────────────────────
-- Patrón: SELECT = tiene_permiso('<z>.ver') AND scope ; WRITE = '<z>.editar' AND scope.

-- empleados (scope: plaza_id). Conserva intactas las policies anon de 0002.
drop policy if exists "rh_all_empleados"     on empleados;
drop policy if exists "jefe_select_empleados" on empleados;
drop policy if exists "jefe_update_empleados" on empleados;
drop policy if exists "empleados_select" on empleados;
drop policy if exists "empleados_write" on empleados;
create policy "empleados_select" on empleados
  for select to authenticated
  using (tiene_permiso('empleados.ver') and (es_global() or plaza_id = mi_plaza_id()));
create policy "empleados_write" on empleados
  for all to authenticated
  using (tiene_permiso('empleados.editar') and (es_global() or plaza_id = mi_plaza_id()))
  with check (tiene_permiso('empleados.editar') and (es_global() or plaza_id = mi_plaza_id()));

-- registros (scope vía empleados.plaza_id). Conserva anon_insert_registros (0002).
drop policy if exists "rh_all_registros"     on registros;
drop policy if exists "jefe_select_registros" on registros;
drop policy if exists "registros_select" on registros;
drop policy if exists "registros_write" on registros;
create policy "registros_select" on registros
  for select to authenticated
  using (
    tiene_permiso('asistencia.ver') and (
      es_global() or id_empleado in (select id from empleados where plaza_id = mi_plaza_id())
    )
  );
create policy "registros_write" on registros
  for all to authenticated
  using (
    tiene_permiso('asistencia.editar') and (
      es_global() or id_empleado in (select id from empleados where plaza_id = mi_plaza_id())
    )
  )
  with check (
    tiene_permiso('asistencia.editar') and (
      es_global() or id_empleado in (select id from empleados where plaza_id = mi_plaza_id())
    )
  );

-- turnos (scope: plaza_id; global = plaza_id is null visible a todo el que ve turnos).
drop policy if exists "rh_all_turnos"     on turnos;
drop policy if exists "jefe_select_turnos" on turnos;
drop policy if exists "turnos_select" on turnos;
drop policy if exists "turnos_write" on turnos;
create policy "turnos_select" on turnos
  for select to authenticated
  using (tiene_permiso('turnos.ver') and (es_global() or plaza_id is null or plaza_id = mi_plaza_id()));
create policy "turnos_write" on turnos
  for all to authenticated
  using (tiene_permiso('turnos.editar') and (es_global() or plaza_id = mi_plaza_id()))
  with check (tiene_permiso('turnos.editar') and (es_global() or plaza_id = mi_plaza_id()));

-- horarios_semana (scope vía empleado).
drop policy if exists "rh_all_horarios" on horarios_semana;
drop policy if exists "jefe_horarios"   on horarios_semana;
drop policy if exists "horarios_select" on horarios_semana;
drop policy if exists "horarios_write" on horarios_semana;
create policy "horarios_select" on horarios_semana
  for select to authenticated
  using (tiene_permiso('turnos.ver') and (
    es_global() or id_empleado in (select id from empleados where plaza_id = mi_plaza_id())));
create policy "horarios_write" on horarios_semana
  for all to authenticated
  using (tiene_permiso('turnos.editar') and (
    es_global() or id_empleado in (select id from empleados where plaza_id = mi_plaza_id())))
  with check (tiene_permiso('turnos.editar') and (
    es_global() or id_empleado in (select id from empleados where plaza_id = mi_plaza_id())));

-- plazas (editar reservado a plazas.editar = solo super_admin por default).
drop policy if exists "rh_all_plazas"     on plazas;
drop policy if exists "jefe_select_plaza" on plazas;
drop policy if exists "plazas_select" on plazas;
drop policy if exists "plazas_write" on plazas;
create policy "plazas_select" on plazas
  for select to authenticated
  using (tiene_permiso('plazas.ver') and (es_global() or id = mi_plaza_id()));
create policy "plazas_write" on plazas
  for all to authenticated
  using (tiene_permiso('plazas.editar'))
  with check (tiene_permiso('plazas.editar'));

-- puestos (lectura libre autenticada; escritura por puestos.editar).
drop policy if exists "auth_read_puestos" on puestos;
drop policy if exists "rh_write_puestos"  on puestos;
drop policy if exists "puestos_select" on puestos;
drop policy if exists "puestos_write" on puestos;
create policy "puestos_select" on puestos
  for select to authenticated using (true);
create policy "puestos_write" on puestos
  for all to authenticated
  using (tiene_permiso('puestos.editar'))
  with check (tiene_permiso('puestos.editar'));

-- avisos (scope: plaza_id null = global). Reescribe las policies de 0034.
drop policy if exists "rh_all_avisos"     on avisos;
drop policy if exists "jefe_plaza_avisos" on avisos;
drop policy if exists "avisos_select" on avisos;
drop policy if exists "avisos_write" on avisos;
create policy "avisos_select" on avisos
  for select to authenticated
  using (tiene_permiso('avisos.ver') and (es_global() or plaza_id is null or plaza_id = mi_plaza_id()));
create policy "avisos_write" on avisos
  for all to authenticated
  using (tiene_permiso('avisos.editar') and (es_global() or plaza_id = mi_plaza_id()))
  with check (tiene_permiso('avisos.editar') and (es_global() or plaza_id = mi_plaza_id()));

-- incidencias (scope vía empleado).
drop policy if exists "rh_all_incidencias"   on incidencias;
drop policy if exists "jefe_all_incidencias" on incidencias;
drop policy if exists "incidencias_select" on incidencias;
drop policy if exists "incidencias_write" on incidencias;
create policy "incidencias_select" on incidencias
  for select to authenticated
  using (tiene_permiso('asistencia.ver') and (
    es_global() or id_empleado in (select id from empleados where plaza_id = mi_plaza_id())));
create policy "incidencias_write" on incidencias
  for all to authenticated
  using (tiene_permiso('asistencia.editar') and (
    es_global() or id_empleado in (select id from empleados where plaza_id = mi_plaza_id())))
  with check (tiene_permiso('asistencia.editar') and (
    es_global() or id_empleado in (select id from empleados where plaza_id = mi_plaza_id())));

-- config_global (ver/editar por permiso de config).
drop policy if exists "todos_leen_config"          on config_global;
drop policy if exists "admin_global_escribe_config" on config_global;
drop policy if exists "config_select" on config_global;
drop policy if exists "config_write" on config_global;
create policy "config_select" on config_global
  for select to authenticated using (tiene_permiso('config.ver'));
create policy "config_write" on config_global
  for all to authenticated
  using (tiene_permiso('config.editar'))
  with check (tiene_permiso('config.editar'));

-- audit_log (lectura por auditoria.ver).
drop policy if exists "rh_select_audit" on audit_log;
drop policy if exists "audit_select" on audit_log;
create policy "audit_select" on audit_log
  for select to authenticated using (tiene_permiso('auditoria.ver'));

-- ── §C.2 RPCs: checks por permiso en vez de mi_rol() ─────────────────────────
create or replace function crear_empleado(
  p_nombre   text,
  p_pin      text,
  p_plaza_id bigint,
  p_turno_id bigint default null
)
returns empleados language plpgsql security definer set search_path = public, extensions as $$
declare
  v_emp empleados;
begin
  if not (tiene_permiso('empleados.editar') and (es_global() or p_plaza_id = mi_plaza_id())) then
    raise exception 'No autorizado para crear empleados en esta plaza';
  end if;

  insert into empleados (nombre, pin_hash, plaza_id, turno_id, activo)
  values (p_nombre, crypt(p_pin, gen_salt('bf')), p_plaza_id, p_turno_id, true)
  returning * into v_emp;

  insert into audit_log (tabla, operacion, registro_id, datos_despues, admin_id)
  values ('empleados', 'INSERT', v_emp.id::text,
          jsonb_build_object('nombre', p_nombre, 'plaza_id', p_plaza_id), auth.uid());

  return v_emp;
end;
$$;
grant execute on function crear_empleado(text, text, bigint, bigint) to authenticated;

create or replace function actualizar_pin_empleado(
  p_empleado_id bigint,
  p_nuevo_pin   text
)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  if not tiene_permiso('empleados.editar') then
    raise exception 'No autorizado';
  end if;
  if not es_global() and not exists (
    select 1 from empleados where id = p_empleado_id and plaza_id = mi_plaza_id()
  ) then
    raise exception 'El empleado no pertenece a tu plaza';
  end if;

  update empleados
  set pin_hash = crypt(p_nuevo_pin, gen_salt('bf'))
  where id = p_empleado_id;

  insert into audit_log (tabla, operacion, registro_id, datos_despues, admin_id)
  values ('empleados', 'UPDATE_PIN', p_empleado_id::text,
          jsonb_build_object('pin_actualizado', true), auth.uid());
end;
$$;
grant execute on function actualizar_pin_empleado(bigint, text) to authenticated;
