# Roles, permisos y RBAC del panel admin — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reemplazar el RBAC hardcoded (`rol ∈ {rh,jefe}` + `es_admin_global`) por 4 roles jerárquicos + permisos por rol + overrides por usuario, forzados desde Postgres vía RLS; más un paquete de mejoras de UI (logo en gafete, color/global de turnos, móvil).

**Architecture:** Dos migraciones idempotentes nuevas (`0035_roles_permisos.sql`, `0036_turnos_color_global.sql`). El backend es la fuente de verdad: helpers `security definer` + RLS por `tiene_permiso(clave)`. El frontend solo pinta/oculta: al login se cachea `mis_permisos()` en la sesión y un módulo `permisos.js` expone `puede(clave)`.

**Tech Stack:** Supabase Postgres (SQL/plpgsql, pgcrypto), vanilla ES Modules (sin build), jsPDF (CDN), tests `.mjs` puros con `node:assert`.

## Global Constraints

- **No build, multi-page, vanilla ESM.** Nada de frameworks ni dependencias nuevas npm.
- **`assets/js/config.js` solo lleva la anon key** — nunca `service_role` ni `TOKEN_SECRET`.
- **Migraciones nuevas numeradas e idempotentes** (`create ... if not exists`, `on conflict do nothing`, `create or replace`, `drop policy if exists` antes de `create policy`). **Nunca editar una migración ya aplicada** (0001–0034 son intocables).
- **El usuario corre `supabase db push`** — el agente no aplica migraciones ni tiene Postgres local; las verificaciones SQL son bloques `assert` que el usuario corre con `supabase db query --linked --file ...`.
- **Paths absolutos en JS rotos en GitHub Pages** — usar rutas relativas / `BASE`.
- **Tests JS** son archivos `*.test.mjs` con top-level `node:assert`, se corren con `node <archivo>`.
- **Ponytail full**: diff mínimo, marcar simplificaciones con `// ponytail:`. No simplificar validación en fronteras de confianza, seguridad ni accesibilidad.
- **Cada cambio termina en git add / commit / push.** Mensajes de commit terminan con:
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`
- **Roster de roles (verbatim):** nivel 4 `super_admin` (global), 3 `rh` (global), 2 `jefe` (su plaza), 1 `supervisor` (su plaza, lectura).
- **Reglas de oro:** nadie se gestiona a sí mismo; nadie gestiona a un par o superior; solo se delega un permiso que uno mismo posee.
- **Orden de despliegue:** aplicar 0035/0036 ANTES de subir el front que llama `mis_permisos()` (si el RPC falta, el front degrada a "sin permisos" → falla cerrado).

## File Structure

**Backend (nuevo):**
- `supabase/migrations/0035_roles_permisos.sql` — catálogos, helpers, RLS, trigger, RPC updates, migración de datos.
- `supabase/migrations/0036_turnos_color_global.sql` — `turnos.color`, `turnos.plaza_id` nullable.
- `supabase/tests/0035_rbac_smoke.sql` — bloque `do $$ ... assert ... $$` de humo (lo corre el usuario).

**Frontend (nuevo):**
- `assets/js/admin/permisos.js` — `puede(clave)` lee la sesión.
- `assets/js/admin/permisos-matriz.mjs` — lógica pura tri-estado de la matriz (testeable).
- `assets/js/admin/permisos-matriz.test.mjs` — test.
- `assets/js/admin/turno-color.mjs` — `colorDeTurno`, `contraste` (testeable).
- `assets/js/admin/turno-color.test.mjs` — test.

**Frontend (modificado):**
- `assets/js/admin/auth.js` — cachea `permisos` y `nivel` en la sesión al login.
- `assets/js/admin/api.js` — `misPermisos()`, catálogo de permisos, CRUD de `perfil_permisos`.
- `assets/js/admin/dashboard.js` — gating por `data-perm`, badge de 4 roles, guarda de panel.
- `admin/dashboard/index.html` — `data-rh-only`/`data-admin-global` → `data-perm`.
- `assets/js/admin/usuarios.js` — selector de rol por nivel, plaza obligatoria, matriz de permisos.
- `assets/js/admin/gafetes.js` — logo de empresa desde `config_global`.
- `assets/js/admin/turnos.js` — color picker, turno global, color en grid/PDF.
- `assets/css/estilos-admin.css` — gafetes redesign, turnos móvil, iconos siempre visibles, estilos de matriz.

---

## Task 1: Migración 0035 §A — catálogos, helpers, migración de `perfiles_admin`

**Files:**
- Create: `supabase/migrations/0035_roles_permisos.sql`
- Create: `supabase/tests/0035_rbac_smoke.sql`

**Interfaces:**
- Produces (funciones SQL para tareas siguientes y el front):
  - `mi_nivel() returns int`
  - `es_global() returns boolean`
  - `tiene_permiso(p_clave text) returns boolean`
  - `puede_gestionar(p_objetivo uuid) returns boolean`
  - `mis_permisos() returns text[]` (grant a `authenticated`)
  - `es_admin_global()` repuntado a `mi_rol() = 'super_admin'`
  - Tablas `roles`, `permisos`, `rol_permisos`, `perfil_permisos`.
- Consumes de migraciones previas: `mi_rol()`, `mi_plaza_id()` (0004), `perfiles_admin` (0004/0019).

- [ ] **Step 1: Crear el archivo de migración con catálogos, seeds, helpers y migración de datos**

Crear `supabase/migrations/0035_roles_permisos.sql` con este contenido (esta tarea escribe la **primera sección**; las Tareas 2 y 3 **anexan** al mismo archivo):

```sql
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
```

- [ ] **Step 2: Escribir el smoke test SQL de helpers**

Crear `supabase/tests/0035_rbac_smoke.sql`. Inserta perfiles ficticios, fija `auth.uid()` vía `set local request.jwt.claims`, y verifica `tiene_permiso`/override. Se corre en una transacción que hace `rollback` al final (no ensucia datos):

```sql
-- Smoke de RBAC 0035. Correr con:
--   supabase db query --linked --file supabase/tests/0035_rbac_smoke.sql
-- Hace rollback al final: no persiste nada. Requiere los 4 roles ya sembrados.
begin;

-- Plazas y perfiles ficticios (ids uuid fijos para el test).
insert into plazas (id, nombre, ciudad, latitud, longitud)
  values (90001,'P-A','X',0,0),(90002,'P-B','X',0,0) on conflict do nothing;

insert into perfiles_admin (id, nombre, email, rol, plaza_id, activo) values
  ('00000000-0000-0000-0000-0000000000a4','SA','sa@t','super_admin',null,true),
  ('00000000-0000-0000-0000-0000000000a3','RH','rh@t','rh',null,true),
  ('00000000-0000-0000-0000-0000000000a2','JA','ja@t','jefe',90001,true),
  ('00000000-0000-0000-0000-0000000000b2','JB','jb@t','jefe',90002,true),
  ('00000000-0000-0000-0000-0000000000a1','SV','sv@t','supervisor',90001,true)
on conflict (id) do nothing;

-- Simula sesión del jefe A.
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a2"}';

do $$
begin
  -- jefe tiene empleados.editar por default, NO config.editar.
  assert tiene_permiso('empleados.editar'), 'jefe deberia tener empleados.editar';
  assert not tiene_permiso('config.editar'), 'jefe NO deberia tener config.editar';
  -- golden rules:
  assert not puede_gestionar('00000000-0000-0000-0000-0000000000a2'), 'no a si mismo';
  assert not puede_gestionar('00000000-0000-0000-0000-0000000000a3'), 'no a superior (rh)';
  assert puede_gestionar('00000000-0000-0000-0000-0000000000a1'), 'si a supervisor de su plaza';
  assert not puede_gestionar('00000000-0000-0000-0000-0000000000b2'), 'no a par (otro jefe)';
end $$;

-- Override: revoca empleados.editar al jefe A → tiene_permiso debe respetarlo.
set local role postgres;
insert into perfil_permisos (perfil_id, permiso, concedido)
  values ('00000000-0000-0000-0000-0000000000a2','empleados.editar',false)
  on conflict (perfil_id,permiso) do update set concedido = excluded.concedido;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a2"}';
do $$
begin
  assert not tiene_permiso('empleados.editar'), 'override revoke debe ganar al default';
end $$;

rollback;
```

- [ ] **Step 3: Verificar (usuario) que la migración aplica y el smoke pasa**

Run (el usuario):
```bash
supabase db push
supabase db query --linked --file supabase/tests/0035_rbac_smoke.sql
```
Expected: `db push` aplica 0035 sin error; el smoke termina sin `assertion` fallida (cualquier `assert` roto aborta con `ERROR: ...`). Como el agente no tiene Postgres, su verificación es estática: re-leer el SQL y confirmar que no hay `mi_rol()` colgante ni referencias a columnas inexistentes.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0035_roles_permisos.sql supabase/tests/0035_rbac_smoke.sql
git commit -m "feat(rbac): catalogos de roles/permisos + helpers RLS (0035 §A)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git push
```

---

## Task 2: Migración 0035 §B — reglas de oro (RLS de `perfiles_admin` + `perfil_permisos` + trigger)

**Files:**
- Modify: `supabase/migrations/0035_roles_permisos.sql` (anexar §B al final)

**Interfaces:**
- Consumes: helpers de Task 1 (`tiene_permiso`, `puede_gestionar`, `mi_nivel`, `es_global`, `mi_plaza_id`).
- Produces: RLS y trigger que gobiernan la gestión de usuarios; ninguna firma nueva para JS.

- [ ] **Step 1: Anexar la sección §B de RLS + trigger al archivo de migración**

Añadir al final de `supabase/migrations/0035_roles_permisos.sql`:

```sql
-- ── §B Reglas de oro: RLS de gestión de usuarios ─────────────────────────────
-- Limpia las policies viejas de perfiles_admin (0004/0019) y reescribe.
drop policy if exists "rh_all_perfiles"          on perfiles_admin;
drop policy if exists "self_select_perfil"       on perfiles_admin;
drop policy if exists "admin_global_all_perfiles" on perfiles_admin;

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
```

- [ ] **Step 2: Anexar al smoke test la verificación de "solo delegas lo que posees"**

Añadir a `supabase/tests/0035_rbac_smoke.sql`, **antes** del `rollback;` final:

```sql
-- Un jefe NO puede conceder un permiso que él no tiene (config.editar).
-- Como authenticated (jefe A), el insert debe violar la policy with check.
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a2"}';
do $$
begin
  begin
    insert into perfil_permisos (perfil_id, permiso, concedido)
      values ('00000000-0000-0000-0000-0000000000a1','config.editar',true);
    assert false, 'jefe no deberia poder conceder config.editar (no lo posee)';
  exception when others then
    null; -- esperado: RLS / insufficient privilege
  end;
end $$;
```

- [ ] **Step 3: Verificar (usuario)**

Run:
```bash
supabase db push
supabase db query --linked --file supabase/tests/0035_rbac_smoke.sql
```
Expected: aplica sin error; smoke sin assert roto. Verificación estática del agente: confirmar que cada `drop policy if exists` antecede a su `create policy` y que el trigger usa `mi_nivel()`/`roles.nivel`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0035_roles_permisos.sql supabase/tests/0035_rbac_smoke.sql
git commit -m "feat(rbac): reglas de oro RLS + trigger guard en perfiles_admin (0035 §B)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git push
```

---

## Task 3: Migración 0035 §C — RLS de tablas de datos + RPCs

**Files:**
- Modify: `supabase/migrations/0035_roles_permisos.sql` (anexar §C al final)

**Interfaces:**
- Consumes: helpers de Task 1.
- Produces: RLS uniforme (`tiene_permiso('<zona>.ver|editar')` + scope de plaza) en empleados, registros, turnos, plazas, puestos, avisos, config_global, audit_log, incidencias, horarios_semana; `crear_empleado`/`actualizar_pin_empleado` con checks por permiso.

- [ ] **Step 1: Anexar §C — reescritura de RLS de tablas de datos**

Añadir al final de `supabase/migrations/0035_roles_permisos.sql`. Cada tabla: `drop` de las policies viejas (`mi_rol()='rh'`/`'jefe'`) y `create` del par ver/editar. **Las policies anon de la app empleados (0002/0005) NO se tocan.**

```sql
-- ── §C RLS uniforme de tablas de datos ───────────────────────────────────────
-- Patrón: SELECT = tiene_permiso('<z>.ver') AND scope ; WRITE = '<z>.editar' AND scope.

-- empleados (scope: plaza_id). Conserva intactas las policies anon de 0002.
drop policy if exists "rh_all_empleados"     on empleados;
drop policy if exists "jefe_select_empleados" on empleados;
drop policy if exists "jefe_update_empleados" on empleados;
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
create policy "puestos_select" on puestos
  for select to authenticated using (true);
create policy "puestos_write" on puestos
  for all to authenticated
  using (tiene_permiso('puestos.editar'))
  with check (tiene_permiso('puestos.editar'));

-- avisos (scope: plaza_id null = global). Reescribe las policies de 0034.
drop policy if exists "rh_all_avisos"     on avisos;
drop policy if exists "jefe_plaza_avisos" on avisos;
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
create policy "config_select" on config_global
  for select to authenticated using (tiene_permiso('config.ver'));
create policy "config_write" on config_global
  for all to authenticated
  using (tiene_permiso('config.editar'))
  with check (tiene_permiso('config.editar'));

-- audit_log (lectura por auditoria.ver).
drop policy if exists "rh_select_audit" on audit_log;
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
```

- [ ] **Step 2: Verificar (usuario) que push aplica y el panel sigue leyendo datos**

Run:
```bash
supabase db push
```
Expected: aplica sin error. Verificación funcional (usuario): entrar al panel como super_admin y confirmar que empleados/turnos/asistencia siguen cargando. Verificación estática del agente: confirmar que toda policy creada usa `tiene_permiso(...)` y que no quedó ninguna policy con `mi_rol()` en este archivo (`grep -n "mi_rol()" supabase/migrations/0035_roles_permisos.sql` debe salir vacío salvo dentro de `es_admin_global`).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0035_roles_permisos.sql
git commit -m "feat(rbac): RLS por permiso en tablas de datos + RPCs (0035 §C)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git push
```

---

## Task 4: Frontend — `permisos.js`, sesión con permisos, RPC `misPermisos`

**Files:**
- Create: `assets/js/admin/permisos.js`
- Modify: `assets/js/admin/auth.js:51-57` (bloque `setAdminSession` del login)
- Modify: `assets/js/admin/api.js` (añadir RPC `misPermisos` y catálogos)

**Interfaces:**
- Consumes: `mis_permisos()` RPC (Task 1), `getAdminSession()` (auth.js).
- Produces (para Tasks 5 y 6):
  - `permisos.js`: `export const puede = (clave) => boolean` (lee `getAdminSession().permisos`).
  - `api.js`: `export async function misPermisos()` → `string[]`; `export const getRolesYPermisos = () => Promise<{roles, permisos, rol_permisos}>`; `export const getPerfilPermisos = (perfilId) => Promise<rows>`; `export const setPerfilPermiso = (perfilId, permiso, concedido) => Promise`; `export const deletePerfilPermiso = (perfilId, permiso) => Promise`.

- [ ] **Step 1: Crear `permisos.js`**

```javascript
// Gating de UI por permiso. La VERDAD vive en Postgres (RLS); esto solo decide
// qué pinta el panel. La sesión guarda el arreglo `permisos` (ver auth.js).
// ponytail: si la sesión no trae permisos (RPC viejo/caído) → puede() = false,
// el panel oculta de más (falla cerrado). Upgrade: revalidar al cambiar de ruta.
import { getAdminSession } from './auth.js';

export function puede(clave) {
  const s = getAdminSession();
  return Array.isArray(s?.permisos) && s.permisos.includes(clave);
}

export const miNivel = () => getAdminSession()?.nivel ?? 0;
export const soyGlobal = () => getAdminSession()?.es_global === true;
```

- [ ] **Step 2: Añadir el RPC y catálogos a `api.js`**

Insertar tras el bloque "Usuarios admin" (después de `createPerfilAdmin`, línea ~225):

```javascript
// ── RBAC: permisos efectivos + catálogos + overrides por usuario ────────────
export const misPermisos      = () => rpc('mis_permisos');
export const getRoles         = () => apiFetch('roles?select=clave,nombre,nivel,es_global&order=nivel.desc');
export const getPermisosCat   = () => apiFetch('permisos?select=clave,zona,descripcion&order=zona.asc');
export const getRolPermisos   = () => apiFetch('rol_permisos?select=rol,permiso');
export const getPerfilPermisos = (perfilId) =>
  apiFetch(`perfil_permisos?perfil_id=eq.${perfilId}&select=permiso,concedido`);
export const setPerfilPermiso = (perfilId, permiso, concedido) =>
  apiFetch('perfil_permisos?on_conflict=perfil_id,permiso', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ perfil_id: perfilId, permiso, concedido }),
  });
export const deletePerfilPermiso = (perfilId, permiso) =>
  apiFetch(`perfil_permisos?perfil_id=eq.${perfilId}&permiso=eq.${permiso}`,
    { method: 'DELETE', headers: { Prefer: '' } });
```

- [ ] **Step 3: Cachear permisos + nivel + es_global en la sesión al login**

En `assets/js/admin/auth.js`, el bloque actual (líneas 51-57):

```javascript
  setAdminSession({
    ...perfil,
    ubicacion,
    access_token:  auth.access_token,
    refresh_token: auth.refresh_token,
    expires_at:    Date.now() + auth.expires_in * 1000
  });

  return { ok: true };
```

reemplazar por (la sesión debe existir antes de llamar al RPC, porque `api.js`/`rpc` leen el token de la sesión):

```javascript
  setAdminSession({
    ...perfil,
    ubicacion,
    access_token:  auth.access_token,
    refresh_token: auth.refresh_token,
    expires_at:    Date.now() + auth.expires_in * 1000
  });

  // Permisos efectivos (RBAC 0035). Si el RPC no existe aún (migración sin
  // aplicar) degradamos a [] → el panel oculta de más. Falla cerrado.
  try {
    const { misPermisos } = await import('./api.js');
    const permisos = await misPermisos();
    const s = getAdminSession();
    setAdminSession({ ...s, permisos: Array.isArray(permisos) ? permisos : [],
                      nivel: NIVEL_ROL[perfil.rol] ?? 0,
                      es_global: GLOBAL_ROL[perfil.rol] === true });
  } catch {
    const s = getAdminSession();
    setAdminSession({ ...s, permisos: [], nivel: 0, es_global: false });
  }

  return { ok: true };
```

y añadir cerca del tope de `auth.js` (tras `const KEY = ...`):

```javascript
// Espejo del catálogo `roles` (0035). El nivel/es_global vienen del rol; mantener
// sincronizado con la migración. ponytail: 4 valores fijos; si crecen los roles,
// leerlos de la tabla `roles` al login.
const NIVEL_ROL  = { super_admin: 4, rh: 3, jefe: 2, supervisor: 1 };
const GLOBAL_ROL = { super_admin: true, rh: true, jefe: false, supervisor: false };
```

- [ ] **Step 4: `node --check` de los módulos tocados**

Run:
```bash
node --check assets/js/admin/permisos.js && node --check assets/js/admin/auth.js && node --check assets/js/admin/api.js
```
Expected: sin salida (exit 0). Falla si hay error de sintaxis.

- [ ] **Step 5: Commit**

```bash
git add assets/js/admin/permisos.js assets/js/admin/auth.js assets/js/admin/api.js
git commit -m "feat(rbac): sesion cachea permisos efectivos + helper puede()

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git push
```

---

## Task 5: Frontend — gating del dashboard por `data-perm`

**Files:**
- Modify: `admin/dashboard/index.html` (atributos de nav)
- Modify: `assets/js/admin/dashboard.js:11-24` (gating + badge), y la guarda en `showPanel`

**Interfaces:**
- Consumes: `puede(clave)` (Task 4).
- Produces: nada para tareas siguientes (cambio terminal de UI de navegación).

- [ ] **Step 1: Cambiar los atributos de gating en el HTML del sidebar**

En `admin/dashboard/index.html`, aplicar estos reemplazos (cada link/grupo lleva `data-perm="<clave>"`; se elimina `data-rh-only`/`data-admin-global`):

| Línea aprox. | Antes | Después |
|---|---|---|
| 45 | `<a href="#asistencia" class="sidebar__link" data-panel="asistencia">` | `... data-panel="asistencia" data-perm="asistencia.ver">` |
| 53 | `<details class="sidebar__group" data-rh-only open>` | `<details class="sidebar__group" data-perm-group open>` |
| 57 | `<a href="#plazas" ... data-panel="plazas">` | `... data-panel="plazas" data-perm="plazas.ver">` |
| 63 | `<a href="#puestos" ... data-panel="puestos">` | `... data-panel="puestos" data-perm="puestos.editar">` |
| 75 | `<a href="#turnos" ... data-panel="turnos">` | `... data-panel="turnos" data-perm="turnos.ver">` |
| 81 | `<a href="#empleados" ... data-panel="empleados">` | `... data-panel="empleados" data-perm="empleados.ver">` |
| 87 | `<a href="#gafetes" ... data-panel="gafetes">` | `... data-panel="gafetes" data-perm="gafetes.ver">` |
| 93 | `<a href="#avisos" ... data-panel="avisos">` | `... data-panel="avisos" data-perm="avisos.ver">` |
| 99 | `<a href="#historial" ... data-panel="historial">` | `... data-panel="historial" data-perm="asistencia.ver">` |
| 105 | `<a href="#cambios" ... data-panel="cambios" data-rh-only>` | `... data-panel="cambios" data-perm="auditoria.ver">` |
| 111 | `<a href="#auditoria" ... data-panel="auditoria" data-admin-global>` | `... data-panel="auditoria" data-perm="auditoria.ver">` |
| 119 | `<details class="sidebar__group" data-admin-global open>` | `<details class="sidebar__group" data-perm-group open>` |
| 123 | `<a href="#usuarios" ... data-panel="usuarios">` | `... data-panel="usuarios" data-perm="usuarios.ver">` |
| 129 | `<a href="#administracion" ... data-panel="administracion">` | `... data-panel="administracion" data-perm="config.ver">` |

`#overview` y `#ajustes` quedan sin `data-perm` (visibles para cualquier perfil válido). `data-perm-group` es un marcador: el grupo se oculta si se queda sin links visibles (lógica en JS).

- [ ] **Step 2: Reescribir el bloque de role-based UI en `dashboard.js`**

En `assets/js/admin/dashboard.js`, el bloque actual (líneas 11-24):

```javascript
// auth.js guarda el perfil aplanado en la sesión: rol/nombre están en la raíz.
const esRH   = sesion?.rol === 'rh';
const esAdminGlobal = sesion?.es_admin_global === true; // 3er concepto: super-admin

// ── Role-based UI ─────────────────────────────────────────────────────────────
if (!esRH) {
  document.querySelectorAll('[data-rh-only]').forEach(el => el.remove());
}
if (!esAdminGlobal) {
  document.querySelectorAll('[data-admin-global]').forEach(el => el.remove());
}
const _adminNombre = sesion?.nombre ?? 'Admin';
document.getElementById('admin-nombre-foot').textContent = _adminNombre;
document.getElementById('admin-rol-badge').textContent = t(esRH ? 'Recursos Humanos' : 'Jefe de Plaza');
document.querySelectorAll('.sidebar__avatar').forEach(a => { a.firstChild.textContent = _adminNombre.trim().charAt(0).toUpperCase() || 'A'; });
```

reemplazar por:

```javascript
// RBAC dirigido por datos (0035): la sesión trae `permisos` efectivos.
const ROL_NOMBRE = {
  super_admin: 'Super Administrador', rh: 'Recursos Humanos',
  jefe: 'Jefe de Plaza', supervisor: 'Supervisor',
};
// RH global aún usa el selector de plaza "Todas"; jefe/supervisor están atados a
// su plaza. Mantengo `esRH` como "rol global" para el selector de plaza.
const esRH = sesion?.es_global === true;

// ── Gating por permiso ──────────────────────────────────────────────────────
document.querySelectorAll('[data-perm]').forEach(el => {
  if (!puede(el.dataset.perm)) el.remove();
});
// Grupos del sidebar sin links visibles → se ocultan.
document.querySelectorAll('.sidebar__group[data-perm-group]').forEach(g => {
  if (!g.querySelector('.sidebar__link')) g.remove();
});
const _adminNombre = sesion?.nombre ?? 'Admin';
document.getElementById('admin-nombre-foot').textContent = _adminNombre;
document.getElementById('admin-rol-badge').textContent = t(ROL_NOMBRE[sesion?.rol] ?? 'Administrador');
document.querySelectorAll('.sidebar__avatar').forEach(a => { a.firstChild.textContent = _adminNombre.trim().charAt(0).toUpperCase() || 'A'; });
```

Añadir el import al inicio de `dashboard.js` (junto a los otros imports, tras la línea 7):

```javascript
import { puede } from './permisos.js';
```

- [ ] **Step 3: Añadir la guarda de panel en `showPanel`**

En `dashboard.js`, dentro de `async function showPanel(id)`, justo después de `const panel = document.getElementById(`panel-${id}`); if (!panel) return;` (líneas 52-53), añadir:

```javascript
  // Si el link de este panel fue removido por gating, no lo cargues: vuelve a overview.
  const navOK = id === 'overview' || id === 'ajustes' ||
    document.querySelector(`.sidebar__link[data-panel="${id}"]`);
  if (!navOK) { showPanel('overview'); return; }
```

- [ ] **Step 4: Ajustes muestra el rol correcto (4 roles)**

En `loadAjustes` (línea ~277), reemplazar:

```javascript
  const rolTxt = t(esRH ? 'Recursos Humanos' : 'Jefe de Plaza');
```

por:

```javascript
  const rolTxt = t(ROL_NOMBRE[sesion?.rol] ?? 'Administrador');
```

- [ ] **Step 5: `node --check`**

Run:
```bash
node --check assets/js/admin/dashboard.js
```
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add admin/dashboard/index.html assets/js/admin/dashboard.js
git commit -m "feat(rbac): gating del sidebar por data-perm + badge de 4 roles

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git push
```

---

## Task 6: Frontend — panel Usuarios con selector por nivel y matriz de permisos

**Files:**
- Create: `assets/js/admin/permisos-matriz.mjs`
- Create: `assets/js/admin/permisos-matriz.test.mjs`
- Modify: `assets/js/admin/usuarios.js` (reescritura del form + tabla de permisos)
- Modify: `assets/css/estilos-admin.css` (estilos `.pmx-*`)

**Interfaces:**
- Consumes: `api.getRoles/getPermisosCat/getRolPermisos/getPerfilPermisos/setPerfilPermiso/deletePerfilPermiso` (Task 4), `puede` + `miNivel` + `soyGlobal` (Task 4).
- Produces (módulo puro, para el test y `usuarios.js`):
  - `export function rolesAsignables(roles, miNivel)` → roles con `nivel < miNivel`.
  - `export function estadoEfectivo(permiso, rol, rolPermisos, perfilPermisos)` → `'concedido' | 'revocado' | 'hereda'`.
  - `export function accionTriestado(estado)` → siguiente estado al hacer clic: `'hereda' → 'concedido' → 'revocado' → 'hereda'`.
  - `export function defaultDelRol(permiso, rol, rolPermisos)` → boolean (si el rol lo trae por default).

- [ ] **Step 1: Escribir el test de la lógica de matriz (falla primero)**

Crear `assets/js/admin/permisos-matriz.test.mjs`:

```javascript
import assert from 'node:assert';
import { rolesAsignables, defaultDelRol, estadoEfectivo, accionTriestado } from './permisos-matriz.mjs';

const roles = [
  { clave: 'super_admin', nivel: 4 }, { clave: 'rh', nivel: 3 },
  { clave: 'jefe', nivel: 2 }, { clave: 'supervisor', nivel: 1 },
];
// Un jefe (nivel 2) solo puede asignar supervisor (nivel 1).
assert.deepStrictEqual(rolesAsignables(roles, 2).map(r => r.clave), ['supervisor']);
// Un rh (nivel 3) puede asignar jefe y supervisor.
assert.deepStrictEqual(rolesAsignables(roles, 3).map(r => r.clave), ['jefe', 'supervisor']);

const rolPermisos = [
  { rol: 'jefe', permiso: 'empleados.ver' },
  { rol: 'jefe', permiso: 'empleados.editar' },
];
assert.strictEqual(defaultDelRol('empleados.ver', 'jefe', rolPermisos), true);
assert.strictEqual(defaultDelRol('config.editar', 'jefe', rolPermisos), false);

// Sin override → hereda.
assert.strictEqual(estadoEfectivo('empleados.ver', 'jefe', rolPermisos, []), 'hereda');
// Override concedido / revocado mandan.
assert.strictEqual(estadoEfectivo('config.editar', 'jefe', rolPermisos,
  [{ permiso: 'config.editar', concedido: true }]), 'concedido');
assert.strictEqual(estadoEfectivo('empleados.ver', 'jefe', rolPermisos,
  [{ permiso: 'empleados.ver', concedido: false }]), 'revocado');

// Ciclo tri-estado.
assert.strictEqual(accionTriestado('hereda'), 'concedido');
assert.strictEqual(accionTriestado('concedido'), 'revocado');
assert.strictEqual(accionTriestado('revocado'), 'hereda');

console.log('permisos-matriz OK');
```

- [ ] **Step 2: Correr el test para verlo fallar**

Run:
```bash
node assets/js/admin/permisos-matriz.test.mjs
```
Expected: FAIL — `Cannot find module './permisos-matriz.mjs'`.

- [ ] **Step 3: Implementar `permisos-matriz.mjs`**

Crear `assets/js/admin/permisos-matriz.mjs`:

```javascript
// Lógica pura de la matriz de permisos por usuario. Sin DOM, testeable.

// Roles que un gestor puede asignar: estrictamente de menor nivel que el suyo.
export function rolesAsignables(roles, miNivel) {
  return roles.filter(r => r.nivel < miNivel);
}

// ¿El rol trae el permiso por default?
export function defaultDelRol(permiso, rol, rolPermisos) {
  return rolPermisos.some(rp => rp.rol === rol && rp.permiso === permiso);
}

// Estado efectivo de un permiso para un perfil: el override (si existe) manda;
// si no, 'hereda' (toma el default del rol).
export function estadoEfectivo(permiso, rol, rolPermisos, perfilPermisos) {
  const ov = perfilPermisos.find(pp => pp.permiso === permiso);
  if (ov) return ov.concedido ? 'concedido' : 'revocado';
  return 'hereda';
}

// Clic en la celda: hereda → concedido → revocado → hereda.
export function accionTriestado(estado) {
  return estado === 'hereda' ? 'concedido'
       : estado === 'concedido' ? 'revocado'
       : 'hereda';
}
```

- [ ] **Step 4: Correr el test para verlo pasar**

Run:
```bash
node assets/js/admin/permisos-matriz.test.mjs
```
Expected: PASS — imprime `permisos-matriz OK`.

- [ ] **Step 5: Reescribir `usuarios.js`**

Reemplazar el contenido completo de `assets/js/admin/usuarios.js` por:

```javascript
import * as api from './api.js';
import { loading, showToast, openModal, closeModal, confirm, esc, DEFAULT_PFP } from './utils.js';
import { t } from '../i18n.js';
import { getAdminSession } from './auth.js';
import { puede, miNivel, soyGlobal } from './permisos.js';
import { rolesAsignables, defaultDelRol, estadoEfectivo, accionTriestado } from './permisos-matriz.mjs';

let _plazas = [];
let _roles = [];           // catálogo de roles (clave, nombre, nivel, es_global)
let _permisos = [];        // catálogo de permisos (clave, zona, descripcion)
let _rolPermisos = [];     // defaults por rol
let _emailsChecador = new Set();

const rolNombre = (clave) => _roles.find(r => r.clave === clave)?.nombre ?? clave;
const rolEsGlobal = (clave) => _roles.find(r => r.clave === clave)?.es_global === true;

export async function init(panel) {
  panel.innerHTML = `
    <div class="panel-header">
      <h2>${t('Usuarios')}</h2>
      <div class="panel-header__actions">
        ${puede('usuarios.crear') ? `<button class="abtn abtn--primary" id="btn-nuevo-admin">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          ${t('Nuevo administrador')}
        </button>` : ''}
      </div>
    </div>
    <p class="td-muted" style="margin:-4px 0 14px">${t('Administra quién puede acceder al panel: rol, plaza, permisos y contraseña.')}</p>
    <div class="ad-card"><div id="tbl-usuarios-wrap"></div></div>`;

  document.getElementById('btn-nuevo-admin')?.addEventListener('click', () => formAdmin(null));
  await load();
}

async function load() {
  const wrap = document.getElementById('tbl-usuarios-wrap');
  loading(wrap);
  try {
    const [perfiles, plazas, empleados, roles, permisos, rolPermisos] = await Promise.all([
      api.getPerfilesAdmin(), api.getPlazas(), api.getEmpleados().catch(() => []),
      api.getRoles(), api.getPermisosCat(), api.getRolPermisos(),
    ]);
    _plazas = plazas; _roles = roles; _permisos = permisos; _rolPermisos = rolPermisos;
    _emailsChecador = new Set(empleados.filter(e => e.email).map(e => e.email.toLowerCase()));
    renderUsuarios(wrap, perfiles);
  } catch (e) {
    wrap.innerHTML = `<div class="ad-empty" style="color:#DC2626">${esc(e.message)}</div>`;
  }
}

// ¿Puedo gestionar este perfil? (espejo de puede_gestionar en SQL, para la UI).
function gestionable(p) {
  const yo = getAdminSession()?.id;
  if (p.id === yo) return false;
  const nivelObj = _roles.find(r => r.clave === p.rol)?.nivel ?? 0;
  return nivelObj < miNivel() && (soyGlobal() || p.plaza_id === getAdminSession()?.plaza_id);
}

function renderUsuarios(wrap, perfiles) {
  if (!perfiles.length) { wrap.innerHTML = `<div class="ad-empty">${t('Sin administradores.')}</div>`; return; }
  const yo = getAdminSession()?.id;
  wrap.innerHTML = `<div class="table-scroll"><table class="data-table">
    <thead><tr>
      <th>${t('Nombre')}</th><th>${t('Correo')}</th><th>${t('Rol')}</th>
      <th>${t('Plaza')}</th><th>${t('Estado')}</th><th style="width:120px">${t('Acciones')}</th>
    </tr></thead><tbody>
    ${perfiles.map(p => {
      const enChecador = p.email && _emailsChecador.has(p.email.toLowerCase());
      const esYo = p.id === yo;
      const editable = gestionable(p);
      return `<tr data-id="${p.id}"${p.activo ? '' : ' class="is-inactive"'}>
        <td data-label="${t('Nombre')}"><div class="u-cell">
          <img class="u-avatar" src="${esc(p.foto_url || DEFAULT_PFP)}" alt="">
          <div><div class="u-name">${esc(p.nombre)}${esYo ? ` <span class="abadge abadge--blue">${t('Tú')}</span>` : ''}</div>
            ${enChecador ? `<span class="abadge abadge--green" title="${t('También usa el checador')}">CHECADOR</span>` : ''}
          </div>
        </div></td>
        <td data-label="${t('Correo')}">${esc(p.email)}</td>
        <td data-label="${t('Rol')}">${esc(t(rolNombre(p.rol)))}</td>
        <td data-label="${t('Plaza')}">${esc(p.plazas?.nombre ?? (rolEsGlobal(p.rol) ? t('Global') : '—'))}</td>
        <td data-label="${t('Estado')}"><span class="abadge abadge--${p.activo ? 'green' : 'red'}">${t(p.activo ? 'Activo' : 'Inactivo')}</span></td>
        <td data-label="${t('Acciones')}"><div class="actions">
          ${editable ? `<button class="abtn abtn--ghost abtn--icon" title="${t('Editar')}" onclick="window._editAdmin('${p.id}')">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z"/></svg>
          </button>
          <button class="abtn abtn--ghost abtn--icon" title="${t('Permisos')}" onclick="window._permsAdmin('${p.id}')">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
          </button>` : ''}
          <button class="abtn abtn--ghost abtn--icon" title="${t('Enviar correo de contraseña')}" onclick="window._resetAdmin('${esc(p.email)}')">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 5L2 7"/></svg>
          </button>
        </div></td>
      </tr>`;
    }).join('')}
    </tbody></table></div>`;

  window._editAdmin  = (id) => formAdmin(perfiles.find(p => p.id === id));
  window._permsAdmin = (id) => formPermisos(perfiles.find(p => p.id === id));
  window._resetAdmin = async (email) => {
    if (!await confirm(`${t('Enviar correo de restablecimiento a')} ${email}?`, { ok: t('Enviar'), danger: false })) return;
    try { await api.enviarResetPassword(email); showToast('Correo enviado.', 'ok'); }
    catch (e) { showToast(e.message, 'error'); }
  };
}

function plazaOpts(sel) {
  return [`<option value="">${t('Sin plaza')}</option>`,
    ..._plazas.map(p => `<option value="${p.id}"${p.id === sel ? ' selected' : ''}>${esc(p.nombre)}</option>`)].join('');
}

// Modal crear/editar. Solo ofrece roles de nivel inferior al del gestor.
function formAdmin(perfil) {
  const editar = !!perfil;
  const asignables = rolesAsignables(_roles, miNivel());
  if (!asignables.length) { showToast(t('No tienes nivel para crear o editar usuarios.'), 'error'); return; }
  const rolOpts = asignables.map(r =>
    `<option value="${r.clave}"${perfil?.rol === r.clave ? ' selected' : ''}>${esc(t(r.nombre))}</option>`).join('');

  openModal(editar ? 'Editar administrador' : 'Nuevo administrador',
    `<div class="form-group">
      <label for="u-nombre">${t('Nombre')} *</label>
      <input id="u-nombre" class="form-input" autocomplete="off" value="${esc(perfil?.nombre ?? '')}">
    </div>
    <div class="form-group">
      <label for="u-email">${t('Correo')} *</label>
      <input id="u-email" type="email" class="form-input" autocomplete="off" value="${esc(perfil?.email ?? '')}"${editar ? ' disabled' : ''}>
      ${editar ? '' : `<p class="setting-row__hint">${t('Se enviará un correo para que defina su contraseña.')}</p>`}
    </div>
    <div class="form-row">
      <div class="form-group">
        <label for="u-rol">${t('Rol')} *</label>
        <select id="u-rol" class="form-input">${rolOpts}</select>
      </div>
      <div class="form-group">
        <label for="u-plaza">${t('Plaza')}</label>
        <select id="u-plaza" class="form-input">${plazaOpts(perfil?.plaza_id)}</select>
      </div>
    </div>
    <div class="form-group">
      <label for="u-foto">${t('Foto')}</label>
      <input id="u-foto" type="file" accept="image/*" class="form-input">
    </div>
    ${editar ? `<label class="u-check"><input type="checkbox" id="u-activo"${perfil?.activo ? ' checked' : ''}> ${t('Cuenta activa')}</label>` : ''}
    <p id="u-error" class="error-inline" hidden></p>`,
    async () => {
      const nombre = document.getElementById('u-nombre').value.trim();
      const email  = document.getElementById('u-email').value.trim();
      const rol    = document.getElementById('u-rol').value;
      const plaza_id = parseInt(document.getElementById('u-plaza').value) || null;
      const errEl  = document.getElementById('u-error');
      const fail = (m) => { errEl.textContent = m; errEl.hidden = false; };

      if (!nombre) return fail(t('Escribe un nombre.'));
      if (!editar && !email) return fail(t('Escribe un correo.'));
      // Rol no-global exige plaza (espejo del CHECK jefe_necesita_plaza + scope).
      if (!rolEsGlobal(rol) && !plaza_id) return fail(t('Este rol necesita una plaza asignada.'));

      try {
        let foto_url = perfil?.foto_url ?? null;
        const file = document.getElementById('u-foto').files[0];
        if (file) foto_url = await api.subirFotoPerfil(file);

        if (editar) {
          const activo = document.getElementById('u-activo').checked;
          await api.updatePerfilAdmin(perfil.id, { nombre, rol, plaza_id, activo, foto_url });
          showToast('Administrador actualizado.', 'ok');
        } else {
          const pwTemp = crypto.randomUUID();
          const id = await api.crearCuentaAuth(email, pwTemp);
          await api.createPerfilAdmin({ id, nombre, email, rol, plaza_id, foto_url });
          await api.enviarResetPassword(email);
          showToast('Administrador creado. Se envió el correo de contraseña.', 'ok');
        }
        closeModal();
        await load();
      } catch (e) { fail(e.message); }
    },
    editar ? 'Guardar' : 'Crear administrador'
  );
}

// Editor de permisos por usuario: matriz tri-estado. Solo muestra llaves que el
// gestor posee (no puedes delegar lo que no tienes). Escribe en perfil_permisos.
async function formPermisos(perfil) {
  let perfilPermisos = [];
  try { perfilPermisos = await api.getPerfilPermisos(perfil.id); }
  catch (e) { showToast(e.message, 'error'); return; }

  // Llaves visibles = las que el gestor posee (puede() lee la sesión).
  const visibles = _permisos.filter(pm => puede(pm.clave));
  if (!visibles.length) { showToast(t('No tienes permisos delegables.'), 'error'); return; }

  // Agrupa por zona para una matriz legible.
  const zonas = [...new Set(visibles.map(p => p.zona))];
  const ESTADO_LBL = { hereda: 'Hereda', concedido: 'Concedido', revocado: 'Revocado' };
  const ESTADO_CLS = { hereda: 'gray', concedido: 'green', revocado: 'red' };

  const celda = (pm) => {
    const est = estadoEfectivo(pm.clave, perfil.rol, _rolPermisos, perfilPermisos);
    const def = defaultDelRol(pm.clave, perfil.rol, _rolPermisos);
    return `<button class="pmx-cell" data-clave="${pm.clave}" data-estado="${est}">
      <span class="abadge abadge--${ESTADO_CLS[est]}">${t(ESTADO_LBL[est])}</span>
      <small class="pmx-def">${t('Rol')}: ${def ? t('Sí') : t('No')}</small>
    </button>`;
  };

  openModal(`${t('Permisos de')} ${esc(perfil.nombre)}`,
    `<p class="td-muted" style="margin:0 0 12px">${t('Clic para alternar: hereda del rol → concedido → revocado. Solo puedes ajustar los permisos que tú posees.')}</p>
     <div class="pmx">${zonas.map(z => `
       <div class="pmx-zona"><h4>${esc(t(z))}</h4>
         <div class="pmx-keys">${visibles.filter(p => p.zona === z).map(celda).join('')}</div>
       </div>`).join('')}</div>`,
    null, null, { wide: true });

  // Listener delegado: cada clic avanza el tri-estado y persiste.
  document.querySelector('.pmx')?.addEventListener('click', async (e) => {
    const btn = e.target.closest('.pmx-cell');
    if (!btn || btn.disabled) return;
    const clave = btn.dataset.clave;
    const nuevo = accionTriestado(btn.dataset.estado);
    btn.disabled = true;
    try {
      if (nuevo === 'hereda') await api.deletePerfilPermiso(perfil.id, clave);
      else await api.setPerfilPermiso(perfil.id, clave, nuevo === 'concedido');
      btn.dataset.estado = nuevo;
      const badge = btn.querySelector('.abadge');
      badge.className = `abadge abadge--${ESTADO_CLS[nuevo]}`;
      badge.textContent = t(ESTADO_LBL[nuevo]);
    } catch (err) { showToast(err.message, 'error'); }
    finally { btn.disabled = false; }
  });
}
```

> **Nota de interfaz:** este código asume que `openModal(titulo, html, onOk, okLabel, opts)` acepta un 5º argumento `opts` con `{ wide: true }` y que pasar `onOk=null` rinde un modal de solo cierre. **Antes de implementar, leer `assets/js/admin/utils.js` para confirmar la firma real de `openModal`.** Si no soporta `wide`/cierre-solo, usar la firma existente (p. ej. `openModal(titulo, html)` y un botón de cerrar propio) y omitir `wide` (la matriz cae a ancho normal con scroll). No inventes parámetros que `openModal` no tenga.

- [ ] **Step 6: Añadir estilos de la matriz a `estilos-admin.css`**

Anexar a `assets/css/estilos-admin.css`:

```css
/* Matriz de permisos por usuario (panel Usuarios). */
.pmx { display: grid; gap: 14px; }
.pmx-zona h4 { margin: 0 0 6px; font-size: .9rem; color: var(--ad-tinta); }
.pmx-keys { display: flex; flex-wrap: wrap; gap: 8px; }
.pmx-cell {
  display: flex; flex-direction: column; gap: 2px; align-items: flex-start;
  padding: 8px 10px; min-width: 120px; cursor: pointer;
  background: var(--ad-fondo-2, #f8fafc); border: 1px solid var(--ad-borde, #e2e8f0);
  border-radius: 10px; transition: transform .12s ease, box-shadow .12s ease;
}
.pmx-cell:hover { transform: translateY(-1px); box-shadow: 0 2px 8px rgba(15,23,42,.08); }
.pmx-cell:focus-visible { outline: 3px solid var(--ad-azul, #0369A1); outline-offset: 2px; }
.pmx-cell:disabled { opacity: .5; cursor: progress; }
.pmx-def { color: var(--ad-tinta-3, #94a3b8); font-size: .7rem; }
```

- [ ] **Step 7: Correr test + `node --check`**

Run:
```bash
node assets/js/admin/permisos-matriz.test.mjs && node --check assets/js/admin/usuarios.js
```
Expected: imprime `permisos-matriz OK` y exit 0 (sin error de sintaxis).

- [ ] **Step 8: Commit**

```bash
git add assets/js/admin/permisos-matriz.mjs assets/js/admin/permisos-matriz.test.mjs assets/js/admin/usuarios.js assets/css/estilos-admin.css
git commit -m "feat(rbac): panel Usuarios con roles por nivel + matriz de permisos

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git push
```

---

## Task 7: Migración 0036 — `turnos.color` + `turnos.plaza_id` nullable

**Files:**
- Create: `supabase/migrations/0036_turnos_color_global.sql`

**Interfaces:**
- Produces: columna `turnos.color text` (hex, nullable) y `turnos.plaza_id` nullable (null = turno global).

- [ ] **Step 1: Crear la migración**

Crear `supabase/migrations/0036_turnos_color_global.sql`:

```sql
-- 0036_turnos_color_global.sql — color elegible por turno + turno global.
-- color: hex '#RRGGBB' (null → el front usa la paleta por id). plaza_id nullable:
-- null = turno disponible en todas las plazas. Idempotente.

alter table turnos add column if not exists color text;

-- plaza_id era NOT NULL (0004). Permitir null para turnos globales.
alter table turnos alter column plaza_id drop not null;
```

- [ ] **Step 2: Verificar (usuario)**

Run:
```bash
supabase db push
```
Expected: aplica sin error. Verificación estática del agente: el `alter ... drop not null` es idempotente (re-aplicar no falla).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0036_turnos_color_global.sql
git commit -m "feat(turnos): columna color + plaza_id nullable para turno global (0036)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git push
```

---

## Task 8: Color de turno — módulo, picker y uso en grid/PDF

**Files:**
- Create: `assets/js/admin/turno-color.mjs`
- Create: `assets/js/admin/turno-color.test.mjs`
- Modify: `assets/js/admin/turnos.js` (picker en form, color en grid + PDF)

**Interfaces:**
- Consumes: `turnos.color` (Task 7).
- Produces:
  - `export function colorDeTurno(turno)` → hex `'#RRGGBB'` (usa `turno.color` o cae a la paleta por `turno.id`).
  - `export function contraste(hex)` → `'#ffffff' | '#111111'` (fg legible por luminancia).
  - `export const PALETA` → array de hex (reemplaza las clases `c-*`).

- [ ] **Step 1: Escribir el test (falla primero)**

Crear `assets/js/admin/turno-color.test.mjs`:

```javascript
import assert from 'node:assert';
import { colorDeTurno, contraste, PALETA } from './turno-color.mjs';

// Color explícito manda.
assert.strictEqual(colorDeTurno({ id: 1, color: '#FF0000' }), '#FF0000');
// Sin color → cae a la paleta por id, de forma estable.
const c = colorDeTurno({ id: 7 });
assert.ok(PALETA.includes(c), 'fallback debe venir de la paleta');
assert.strictEqual(colorDeTurno({ id: 7 }), colorDeTurno({ id: 7 }), 'estable por id');
// Contraste: fondo claro → texto oscuro; fondo oscuro → texto claro.
assert.strictEqual(contraste('#FFFFFF'), '#111111');
assert.strictEqual(contraste('#000000'), '#ffffff');
assert.strictEqual(contraste('#1E40AF'), '#ffffff'); // azul oscuro → blanco

console.log('turno-color OK');
```

- [ ] **Step 2: Correr el test para verlo fallar**

Run:
```bash
node assets/js/admin/turno-color.test.mjs
```
Expected: FAIL — `Cannot find module './turno-color.mjs'`.

- [ ] **Step 3: Implementar `turno-color.mjs`**

```javascript
// Color de turno: el elegido (turnos.color) o uno estable de la paleta por id.
// contraste() elige texto blanco/negro por luminancia (WCAG relative luminance).

export const PALETA = ['#3B82F6', '#10B981', '#14B8A6', '#F59E0B', '#8B5CF6'];

export function colorDeTurno(turno) {
  if (turno?.color) return turno.color;
  const id = turno?.id ?? 0;
  return PALETA[((id % PALETA.length) + PALETA.length) % PALETA.length];
}

// Texto legible sobre `hex`. Umbral 0.5 sobre luminancia relativa sRGB.
export function contraste(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return '#111111';
  const n = parseInt(m[1], 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  const L = 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  return L > 0.5 ? '#111111' : '#ffffff';
}
```

- [ ] **Step 4: Correr el test para verlo pasar**

Run:
```bash
node assets/js/admin/turno-color.test.mjs
```
Expected: PASS — `turno-color OK`.

- [ ] **Step 5: Usar el color en `turnos.js` (grid, tarjetas, PDF) y añadir el picker**

En `assets/js/admin/turnos.js`:

(a) Reemplazar el bloque de color autocalculado (líneas 53-55):

```javascript
// ── Color estable por turno (mismo en tarjetas y en la cuadrícula) ─────────
const COLORS = ['c-blue', 'c-emerald', 'c-teal', 'c-amber', 'c-violet'];
const turnoColor = (t) => COLORS[((t?.id ?? 0) % COLORS.length + COLORS.length) % COLORS.length];
```

por:

```javascript
// ── Color por turno (elegido o paleta por id). Ver turno-color.mjs ─────────
import { colorDeTurno, contraste, PALETA } from './turno-color.mjs';
```

> Mover ese `import` al bloque de imports del tope del archivo (junto a las otras líneas `import`), no a media función.

(b) En `loadGrid`, la celda del select (líneas 106-111) usa `turnoColor`. Reemplazar la construcción de la celda:

```javascript
          const t = turnoDe.get(sel);
          return `<td><select class="grid-sel ${t ? 'sel--' + turnoColor(t) : ''}" data-emp="${e.id}" data-fecha="${f}" ${readonly ? 'disabled' : ''}>${optsFor(sel)}</select></td>`;
```

por (color inline en vez de clase `sel--c-*`):

```javascript
          const tn = turnoDe.get(sel);
          const sty = tn ? `style="background:${colorDeTurno(tn)};color:${contraste(colorDeTurno(tn))}"` : '';
          return `<td><select class="grid-sel" ${sty} data-emp="${e.id}" data-fecha="${f}" ${readonly ? 'disabled' : ''}>${optsFor(sel)}</select></td>`;
```

(c) En el listener de cambio (líneas 125-138), reemplazar:

```javascript
          sel.className = `grid-sel ${turnoId ? 'sel--' + turnoColor(turnoDe.get(turnoId)) : ''}`;
```

por:

```javascript
          const tn2 = turnoId ? turnoDe.get(turnoId) : null;
          sel.style.background = tn2 ? colorDeTurno(tn2) : '';
          sel.style.color = tn2 ? contraste(colorDeTurno(tn2)) : '';
```

(d) Eliminar el mapa `TURNO_PDF` (líneas 144-151) y en `pdfTurnos` (líneas 176-177) reemplazar:

```javascript
      const c = TURNO_PDF[turnoColor(tn)] ?? { bg: '#fff', fg: '#111' };
      return `<td style="background:${c.bg};color:${c.fg};font-weight:600">${esc(tn.nombre)}<br><small>${(tn.hora_entrada || '').slice(0, 5)}–${(tn.hora_salida || '').slice(0, 5)}</small></td>`;
```

por:

```javascript
      const bg = colorDeTurno(tn);
      return `<td style="background:${bg};color:${contraste(bg)};font-weight:600">${esc(tn.nombre)}<br><small>${(tn.hora_entrada || '').slice(0, 5)}–${(tn.hora_salida || '').slice(0, 5)}</small></td>`;
```

(e) En `turnoCard` (líneas 240-265), reemplazar la clase de color por estilo inline en la barra superior. Cambiar la apertura:

```javascript
    <div class="turno-card turno-card--${turnoColor(t)}">
```

por:

```javascript
    <div class="turno-card" style="--turno-color:${colorDeTurno(t)}">
```

> Nota: la CSS `.turno-card--c-*` deja de usarse para color; la tarjeta ahora lee `var(--turno-color)`. En la Task 11 (gafetes redesign) NO se toca esto; el ajuste de `.turno-card` para consumir `--turno-color` va aquí: añadir a `estilos-admin.css` una regla mínima `.turno-card{border-top:3px solid var(--turno-color,#3B82F6)}` si las clases viejas daban el color por borde. **Antes de editar, leer las reglas `.turno-card` y `.turno-card--c-*` actuales en `estilos-admin.css`** y portar el punto donde se aplicaba el color (borde/acento) a `var(--turno-color)`. No dupliques estilos: reemplaza el mecanismo de color, conserva el resto.

(f) Añadir el picker al form (`openTurnoForm`). Tras el `form-group` del nombre (línea 299), añadir un campo de color. Insertar después del bloque `<div class="form-group">…t-nombre…</div>`:

```javascript
    <div class="form-group">
      <label for="t-color">${tr('Color')}</label>
      <input id="t-color" class="form-input" type="color" value="${turno?.color ?? colorDeTurno(turno ?? { id: 0 })}" style="height:42px;padding:4px">
    </div>
```

y en el `payload` (líneas 356-362) añadir `color`:

```javascript
      const payload = {
        nombre, plaza_id,
        color: document.getElementById('t-color').value,
        hora_entrada: h_ent, hora_salida: h_sal,
        tolerancia_entrada_min: tol_e, tolerancia_salida_min: tol_s,
        pausa_min: pausa,
        dias_semana: dias
      };
```

- [ ] **Step 6: Correr test + `node --check`**

Run:
```bash
node assets/js/admin/turno-color.test.mjs && node --check assets/js/admin/turnos.js
```
Expected: `turno-color OK` + exit 0.

- [ ] **Step 7: Commit**

```bash
git add assets/js/admin/turno-color.mjs assets/js/admin/turno-color.test.mjs assets/js/admin/turnos.js assets/css/estilos-admin.css
git commit -m "feat(turnos): color elegible por turno en form, grid y PDF

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git push
```

---

## Task 9: Turno global — opción "Todas las plazas" + inclusión en grid/tarjetas

**Files:**
- Modify: `assets/js/admin/turnos.js` (form, filtro de plaza)

**Interfaces:**
- Consumes: `turnos.plaza_id` nullable (Task 7).
- Produces: turnos con `plaza_id = null` se muestran en toda plaza y se pueden crear desde el form.

- [ ] **Step 1: Permitir elegir "global" en el form de turno**

En `openTurnoForm` (líneas 301-303), reemplazar el select de plaza:

```javascript
    <div class="form-group">
      <label for="t-plaza">${tr('Plaza')} *</label>
      <select id="t-plaza" class="form-input"><option value="">– ${tr('Selecciona')} –</option>${plazaOpts}</select>
    </div>
```

por (añade la opción global; el valor `"global"` se distingue de "sin selección"):

```javascript
    <div class="form-group">
      <label for="t-plaza">${tr('Plaza')} *</label>
      <select id="t-plaza" class="form-input">
        <option value="">– ${tr('Selecciona')} –</option>
        <option value="global"${turno && turno.plaza_id == null ? ' selected' : ''}>${tr('Todas las plazas (global)')}</option>
        ${plazaOpts}
      </select>
    </div>
```

- [ ] **Step 2: Resolver "global" → plaza_id null en el submit**

En el submit de `openTurnoForm` (línea 341), reemplazar:

```javascript
      const plaza_id = parseInt(document.getElementById('t-plaza').value) || null;
```

por:

```javascript
      const plazaSel = document.getElementById('t-plaza').value;
      const esGlobal = plazaSel === 'global';
      const plaza_id = esGlobal ? null : (parseInt(plazaSel) || null);
```

y en la validación (línea 350) permitir global (turno global no exige plaza):

```javascript
      if (!nombre || (!plaza_id && !esGlobal) || !h_ent || !h_sal || !dias.length) {
```

- [ ] **Step 3: Incluir turnos globales en el listado y la cuadrícula**

`filterByPlaza` descarta filas cuyo `plaza_id` no es el de foco; un turno global (`null`) quedaría fuera. Reemplazar los dos usos en `turnos.js`:

(a) En `loadGrid` (línea 67):

```javascript
    const turnos  = filterByPlaza(allTurnos, t => t.plaza_id);
```
por:
```javascript
    // Incluye turnos globales (plaza_id null) además de los de la plaza en foco.
    const scope = getPlazaScope();
    const turnos = allTurnos.filter(t => scope == null || t.plaza_id == null || t.plaza_id === scope);
```

(b) En `loadTurnos` (línea 272):

```javascript
    _allTurnos = filterByPlaza(await api.getTurnos(), t => t.plaza_id);
```
por:
```javascript
    const scope = getPlazaScope();
    const all = await api.getTurnos();
    _allTurnos = all.filter(t => scope == null || t.plaza_id == null || t.plaza_id === scope);
```

- [ ] **Step 4: Mostrar "Global" en la tarjeta de turno**

En `turnoCard` (línea 253), reemplazar:

```javascript
        <li>...</svg> ${t.plazas?.nombre ?? '–'}</li>
```
por:
```javascript
        <li>...</svg> ${t.plaza_id == null ? tr('Todas las plazas') : (t.plazas?.nombre ?? '–')}</li>
```

> Conservar el `<svg ...>` existente en esa línea; solo cambia el texto tras `</svg>`.

- [ ] **Step 5: `node --check`**

Run:
```bash
node --check assets/js/admin/turnos.js
```
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add assets/js/admin/turnos.js
git commit -m "feat(turnos): turno global (todas las plazas) en form, listado y grid

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git push
```

---

## Task 10: Gafete — logo de empresa desde `config_global`

**Files:**
- Modify: `assets/js/admin/gafetes.js` (cargar logo, dibujarlo en la banda)

**Interfaces:**
- Consumes: `api.getConfigGlobal()` (devuelve `[{clave,valor}]`), `fotoADataUrl` (ya existe en gafetes.js), `config_global.empresa_logo_url` / `nombre_empresa`.
- Produces: gafete con logo o nombre de empresa en vez del lockup "EQS/CHECADOR".

- [ ] **Step 1: Cargar config (logo + nombre) una vez en `init` y pasarla al dibujo**

En `gafetes.js`, dentro de `init` (línea 46), ampliar la carga inicial:

```javascript
  const [empleados, plazas] = await Promise.all([api.getEmpleados(), api.getPlazas()]);
  _empleados = empleados;
```
por:
```javascript
  const [empleados, plazas, config] = await Promise.all([
    api.getEmpleados(), api.getPlazas(), api.getConfigGlobal().catch(() => []),
  ]);
  _empleados = empleados;
  const cfg = Object.fromEntries((config || []).map(c => [c.clave, c.valor]));
  _empresa = { nombre: cfg.nombre_empresa || 'EQS', logoUrl: cfg.empresa_logo_url || null };
  _logoData = _empresa.logoUrl ? await fotoADataUrl(_empresa.logoUrl) : null;
```

y declarar el estado de módulo junto a `let _empleados = [];` (línea 16):

```javascript
let _empresa = { nombre: 'EQS', logoUrl: null };
let _logoData = null; // dataURL del logo (o null → se dibuja el nombre)
```

- [ ] **Step 2: Dibujar logo/nombre en la banda en vez de "EQS CHECADOR"**

En `dibujarGafete` (líneas 182-185), reemplazar:

```javascript
  doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
  doc.text('EQS', x + 5, y + 8.6);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(186, 222, 247);
  doc.text('CHECADOR', x + 5 + doc.getTextWidth('EQS') + 1.5, y + 8.6);
```

por:

```javascript
  // Logo de la empresa (config_global). Si no hay, el nombre en texto.
  if (_logoData) {
    // Alto de la banda menos margen; ancho proporcional acotado para no invadir "CREDENCIAL".
    const lh = 9, lw = 22;
    doc.addImage(_logoData, 'JPEG', x + 4, y + (hb - lh) / 2, lw, lh, undefined, 'FAST');
  } else {
    doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
    doc.text(doc.splitTextToSize(_empresa.nombre, 42).slice(0, 1), x + 5, y + 8.6);
  }
```

> `fotoADataUrl` ya normaliza a JPEG vía canvas y devuelve `null` si CORS lo contamina; por eso `_logoData` puede ser null aun habiendo URL → cae al nombre. Correcto (falla a texto, no rompe el PDF).

- [ ] **Step 3: `node --check`**

Run:
```bash
node --check assets/js/admin/gafetes.js
```
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add assets/js/admin/gafetes.js
git commit -m "feat(gafetes): usa el logo/nombre de la empresa (config_global) en la credencial

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git push
```

---

## Task 11: Sección Gafetes — rediseño visual (ui-ux-pro-max)

**Files:**
- Modify: `assets/css/estilos-admin.css` (reglas `.gf-*`)
- Modify: `assets/js/admin/gafetes.js:19-44` (markup del panel, solo clases/estructura)

**Interfaces:**
- Consumes: clases `.gf-card`, `.gf-row`, `.gf-preview*`, `.gf-pick`, `.gf-sub` (ya existen). No cambia lógica.
- Produces: nada para tareas siguientes.

> **Antes de empezar, leer las reglas `.gf-*` actuales en `assets/css/estilos-admin.css`** para reescribirlas, no duplicarlas. Aplicar guías ui-ux-pro-max: jerarquía por tamaño/espaciado (no solo color), preview más grande y centrado, animación de entrada 150–300ms con `prefers-reduced-motion` respetado, tokens `--ad-*` existentes, contraste AA. No introducir librerías ni emojis como iconos.

- [ ] **Step 1: Reescribir/ampliar los estilos `.gf-*`**

Localizar el bloque `.gf-*` actual en `estilos-admin.css` y reescribirlo para: (a) `.gf-preview` con más alto y centrado, sombra suave y `border-radius` del sistema; (b) `.gf-card` con animación de entrada; (c) `.gf-row` responsivo (stack en móvil). Ejemplo base (ajustar a los tokens reales del archivo):

```css
.gf-card { animation: gf-in .24s ease both; }
@keyframes gf-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) { .gf-card { animation: none; } }

.gf-row { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
.gf-preview-wrap { display: flex; justify-content: center; margin-top: 14px; }
.gf-preview { width: 100%; max-width: 520px; aspect-ratio: 85.6 / 54; border: 0;
  border-radius: 14px; box-shadow: 0 6px 24px rgba(15,23,42,.14); background: #fff; }
.gf-preview-vacio { color: var(--ad-tinta-3, #94a3b8); text-align: center; padding: 24px; }
@media (max-width: 640px) { .gf-row { flex-direction: column; align-items: stretch; } }
```

- [ ] **Step 2: Ajustar el markup del panel si hace falta para el nuevo layout**

En `gafetes.js` `init` (líneas 19-44), mantener ids (`gf-descargar`, `gf-preview`, `gf-preview-vacio`, `gf-emp-pick`, `gf-plaza-pick`, `gf-lote`) — la lógica depende de ellos. Solo reordenar/envolver con las clases nuevas si el diseño lo pide. No cambiar ningún `getElementById`.

- [ ] **Step 3: Verificación visual (usuario) + `node --check`**

Run:
```bash
node --check assets/js/admin/gafetes.js
```
Expected: exit 0. Verificación visual (usuario): abrir el panel Gafetes en escritorio y móvil; preview centrado y grande, animación suave, sin scroll horizontal.

- [ ] **Step 4: Commit**

```bash
git add assets/css/estilos-admin.css assets/js/admin/gafetes.js
git commit -m "style(gafetes): rediseño de la sección (preview, layout, animaciones)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git push
```

---

## Task 12: Móvil — turnos asignados prominentes + iconos de acción siempre visibles

**Files:**
- Modify: `assets/css/estilos-admin.css` (media queries móvil)

**Interfaces:**
- Consumes: estructura existente del panel Turnos (`.turno-cards`, `#grid-horarios-wrap`, `.panel-header`) y `.actions .abtn--icon` de las tablas.
- Produces: nada para tareas siguientes.

> **Antes de editar, leer las reglas actuales de `.actions`, `.abtn--icon`, `.turno-cards` y las media queries existentes en `estilos-admin.css`.** Hay reglas con `:hover` que ocultan iconos en escritorio; en móvil deben verse siempre (el hover no existe en touch).

- [ ] **Step 1: Iconos de acción siempre visibles en móvil**

Si las `.actions .abtn--icon` se revelan con `:hover`/`opacity` en escritorio, anular eso bajo `@media (hover: none), (max-width: 640px)`:

```css
/* Touch / móvil: los iconos de editar/eliminar no dependen de hover. */
@media (hover: none), (max-width: 640px) {
  .actions .abtn--icon { opacity: 1 !important; visibility: visible !important; }
}
```

- [ ] **Step 2: En móvil, priorizar la cuadrícula de turnos asignados**

Dar a la sección de distribución (asignados) el protagonismo en pantallas chicas y compactar la lista de turnos (catálogo). Ejemplo (ajustar a la estructura real):

```css
@media (max-width: 640px) {
  /* El catálogo de turnos ocupa menos; la distribución asignada va primero visualmente. */
  #tbl-turnos-wrap .turno-cards { gap: 8px; }
  #tbl-turnos-wrap .turno-card { padding: 10px 12px; }
  #grid-horarios-wrap { margin-top: 4px; }
  .grid-scroll { -webkit-overflow-scrolling: touch; }
}
```

> Si se requiere reordenar visualmente (asignados antes que catálogo) sin tocar el HTML, usar `order` con un contenedor flex/grid del panel. **Confirmar la estructura del panel en `turnos.js init` antes**; preferir el cambio CSS mínimo. ponytail: no reestructurar el HTML si un `order`/espaciado resuelve la prominencia.

- [ ] **Step 3: Verificación visual (usuario)**

Verificación (usuario): en móvil, los iconos editar/eliminar se ven sin hover en las tablas (Usuarios, Empleados, Plazas) y en las tarjetas de turno; la cuadrícula de asignación es lo prominente. Sin scroll horizontal salvo la tabla de cuadrícula (que ya scrollea dentro de `.grid-scroll`).

- [ ] **Step 4: Commit**

```bash
git add assets/css/estilos-admin.css
git commit -m "style(móvil): iconos de acción siempre visibles + turnos asignados prominentes

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git push
```

---

## Self-Review

**1. Spec coverage:**

| Requisito del spec | Tarea |
|---|---|
| Catálogo `roles` + seed 4 niveles | T1 |
| `perfiles_admin` enum + migración `es_admin_global→super_admin` | T1 |
| `permisos`/`rol_permisos`/`perfil_permisos` + defaults | T1 |
| Helpers `mi_nivel`/`es_global`/`tiene_permiso`/`puede_gestionar`/`mis_permisos` + repunte `es_admin_global` | T1 |
| Reglas de oro (RLS perfiles_admin + trigger) | T2 |
| `perfil_permisos` RLS "solo delegas lo que posees" | T2 |
| RLS uniforme de tablas de datos + RPCs | T3 |
| `permisos.js` + sesión con permisos + `mis_permisos()` | T4 |
| `data-perm` en dashboard + badge 4 roles | T5 |
| Panel Usuarios: rol por nivel, plaza obligatoria, matriz tri-estado | T6 |
| Migración `0036` color + plaza nullable | T7 |
| Color de turno (picker, grid, PDF) | T8 |
| Turno global | T9 |
| Logo en gafete | T10 |
| Sección Gafetes rediseño | T11 |
| Turnos móvil + iconos móvil | T12 |
| Smoke SQL (helpers, golden rules, override, delegación) | T1 + T2 |
| Tests JS puros (matriz, color) | T6 + T8 |

Sin huecos.

**2. Placeholder scan:** Sin "TBD"/"TODO". Los puntos con "leer X antes de editar" (openModal en T6, `.turno-card`/`.gf-*`/`.actions` CSS) son verificaciones obligatorias contra el código real, no placeholders de contenido — el código a escribir está completo; lo que se pide confirmar es una firma/superficie existente para no inventarla.

**3. Type consistency:**
- `puede(clave)` (T4) usado en T5/T6 con la misma firma.
- `misPermisos()` (T4) ⇄ `mis_permisos` RPC (T1).
- `colorDeTurno`/`contraste`/`PALETA` (T8) consistentes entre módulo, test y `turnos.js`.
- `rolesAsignables`/`estadoEfectivo`/`accionTriestado`/`defaultDelRol` (T6) idénticos entre módulo, test y `usuarios.js`.
- `NIVEL_ROL`/`GLOBAL_ROL` (T4 auth.js) coinciden con el seed `roles` (T1).
- Nombres de policy nuevos (`empleados_select`, `turnos_write`, …) no colisionan con los viejos (que se `drop`ean).

Riesgo anotado para ejecución: la firma de `openModal` (T6) y las reglas CSS preexistentes (`.turno-card`, `.gf-*`, `.actions`) deben leerse antes de editar; los pasos lo indican explícitamente.

---

Plan complete and saved to `docs/superpowers/plans/2026-06-26-roles-permisos-rbac.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
