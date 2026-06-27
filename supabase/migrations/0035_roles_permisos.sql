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
update perfiles_admin set rol = 'super_admin' where es_admin_global = true;
alter table perfiles_admin add constraint perfiles_admin_rol_check
  check (rol in ('super_admin','rh','jefe','supervisor'));

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
