# Roles y permisos del panel admin — Diseño

**Fecha:** 2026-06-22
**Estado:** propuesta (pendiente de revisión)

## Objetivo

Sistema de roles para el panel admin, **distinto de los puestos operativos**, con:

1. Un rol nuevo `supervisor` = **solo lectura** acotado a su plaza.
2. El catálogo rol→permisos **vive en la base de datos** (editable sin redeploy), no escrito en el código JS.
3. El rol del usuario se verifica **server-side** (derivado del JWT, no de lo que mande el cliente).
4. La seguridad real la hace **RLS** de Supabase; la UI es defensa en profundidad, no la barrera.

## Modelo de roles

| Rol | Alcance | Resumen |
|-----|---------|---------|
| `rh` | Todas las plazas | Super admin (sin cambios) |
| `jefe` | Su plaza (`mi_plaza_id()`) | Gestiona su plaza (sin cambios) |
| `supervisor` | Su plaza | **Nuevo** — solo lectura |

`es_admin_global` sigue siendo ortogonal al rol y gatea Usuarios + Administración (sin cambios).

## Catálogo de permisos en la base de datos

Tabla `rol_permisos (rol, capacidad)` — una fila por capacidad concedida. Es la **única fuente** de "qué puede hacer cada rol" para la UI. Editable solo por `es_admin_global()`, legible por cualquier admin autenticado.

Capacidades (gatean paneles del sidebar y acciones):

| Capacidad | rh | jefe | supervisor |
|-----------|----|----|-----------|
| `overview` | ✓ | ✓ | ✗ |
| `asistencia` | ✓ | ✓ | ✓ |
| `marcar_incidencia` | ✓ | ✓ | ✗ |
| `historial` | ✓ | ✓ | ✓ |
| `empleados_ver` | ✓ | ✓ | ✓ |
| `empleados_editar` | ✓ | ✓ | ✗ |
| `plazas` | ✓ | ✓ | ✗ |
| `turnos` | ✓ | ✓ | ✗ |
| `puestos` | ✓ | ✓ | ✗ |
| `auditoria` | ✓ | ✗ | ✗ |

`usuarios` / `administracion` no van en el catálogo: siguen gateados por `es_admin_global` (atributo `data-admin-global`). `ajustes` queda disponible para todo admin.

### RPC `mis_permisos()`

`SECURITY DEFINER STABLE`. Deriva el rol del usuario actual desde `auth.uid()` → `perfiles_admin.rol` → `rol_permisos`. El cliente **no puede** declarar su propio rol; la función lo resuelve del JWT. El frontend la llama una vez al cargar el dashboard.

```sql
create or replace function mis_permisos()
returns setof text
language sql security definer stable
set search_path = public
as $$
  select rp.capacidad
  from perfiles_admin pa
  join rol_permisos rp on rp.rol = pa.rol
  where pa.id = auth.uid();
$$;
grant execute on function mis_permisos() to authenticated;
```

## Seguridad real: RLS (migración 0021)

El catálogo `rol_permisos` solo guía la UI. **La barrera de datos son las políticas RLS por tabla**, keyed en `mi_rol()`. El supervisor obtiene políticas **dedicadas `supervisor_select_*` (FOR SELECT)**, nunca se añade a las políticas `jefe_*` (varias son `for all` → leerían *y escribirían*). Cero políticas de escritura para supervisor.

Cada política espeja la cláusula de scope del `jefe` correspondiente (verificadas contra las migraciones actuales):

- `plazas`: `id = mi_plaza_id()`
- `turnos`: `plaza_id = mi_plaza_id()`
- `empleados`: `plaza_id = mi_plaza_id()`
- `registros`: `id_empleado in (select id from empleados where plaza_id = mi_plaza_id())`
- `turnos_dia`: `id_empleado in (select id from empleados where plaza_id = mi_plaza_id())`
- `horarios_semana`: `id_empleado in (select id from empleados where plaza_id = mi_plaza_id())`
- `incidencias`: `id_empleado in (select id from empleados where plaza_id = mi_plaza_id())`

`config_global` ya es legible por todo authenticated (0019) → sin cambios.

### SQL de la migración

```sql
-- 0021_roles_permisos.sql — rol supervisor + catálogo de permisos en BD. Idempotente.

-- 1) Rol supervisor en el CHECK
alter table perfiles_admin drop constraint if exists perfiles_admin_rol_check;
alter table perfiles_admin
  add constraint perfiles_admin_rol_check check (rol in ('rh','jefe','supervisor'));

-- supervisor también necesita plaza (igual que jefe)
alter table perfiles_admin drop constraint if exists jefe_necesita_plaza;
alter table perfiles_admin drop constraint if exists rol_necesita_plaza;
alter table perfiles_admin
  add constraint rol_necesita_plaza check (rol = 'rh' or plaza_id is not null);

-- 2) Catálogo rol→capacidad
create table if not exists rol_permisos (
  rol       text not null,
  capacidad text not null,
  primary key (rol, capacidad)
);
alter table rol_permisos enable row level security;

drop policy if exists "rol_permisos_select" on rol_permisos;
create policy "rol_permisos_select" on rol_permisos
  for select to authenticated using (true);

drop policy if exists "rol_permisos_admin_global" on rol_permisos;
create policy "rol_permisos_admin_global" on rol_permisos
  for all to authenticated
  using (es_admin_global()) with check (es_admin_global());

insert into rol_permisos (rol, capacidad) values
  ('rh','overview'),('rh','asistencia'),('rh','marcar_incidencia'),('rh','historial'),
  ('rh','empleados_ver'),('rh','empleados_editar'),('rh','plazas'),('rh','turnos'),
  ('rh','puestos'),('rh','auditoria'),
  ('jefe','overview'),('jefe','asistencia'),('jefe','marcar_incidencia'),('jefe','historial'),
  ('jefe','empleados_ver'),('jefe','empleados_editar'),('jefe','plazas'),('jefe','turnos'),
  ('jefe','puestos'),
  ('supervisor','asistencia'),('supervisor','historial'),('supervisor','empleados_ver')
on conflict do nothing;

-- 3) RPC: permisos del usuario actual (rol derivado del JWT)
create or replace function mis_permisos()
returns setof text
language sql security definer stable
set search_path = public
as $$
  select rp.capacidad
  from perfiles_admin pa
  join rol_permisos rp on rp.rol = pa.rol
  where pa.id = auth.uid();
$$;
grant execute on function mis_permisos() to authenticated;

-- 4) RLS: lectura del supervisor, scope plaza, SOLO SELECT
drop policy if exists "supervisor_select_plazas" on plazas;
create policy "supervisor_select_plazas" on plazas
  for select to authenticated
  using (mi_rol() = 'supervisor' and id = mi_plaza_id());

drop policy if exists "supervisor_select_turnos" on turnos;
create policy "supervisor_select_turnos" on turnos
  for select to authenticated
  using (mi_rol() = 'supervisor' and plaza_id = mi_plaza_id());

drop policy if exists "supervisor_select_empleados" on empleados;
create policy "supervisor_select_empleados" on empleados
  for select to authenticated
  using (mi_rol() = 'supervisor' and plaza_id = mi_plaza_id());

drop policy if exists "supervisor_select_registros" on registros;
create policy "supervisor_select_registros" on registros
  for select to authenticated
  using (mi_rol() = 'supervisor'
         and id_empleado in (select id from empleados where plaza_id = mi_plaza_id()));

drop policy if exists "supervisor_select_turnos_dia" on turnos_dia;
create policy "supervisor_select_turnos_dia" on turnos_dia
  for select to authenticated
  using (mi_rol() = 'supervisor'
         and id_empleado in (select id from empleados where plaza_id = mi_plaza_id()));

drop policy if exists "supervisor_select_horarios" on horarios_semana;
create policy "supervisor_select_horarios" on horarios_semana
  for select to authenticated
  using (mi_rol() = 'supervisor'
         and id_empleado in (select id from empleados where plaza_id = mi_plaza_id()));

drop policy if exists "supervisor_select_incidencias" on incidencias;
create policy "supervisor_select_incidencias" on incidencias
  for select to authenticated
  using (mi_rol() = 'supervisor'
         and id_empleado in (select id from empleados where plaza_id = mi_plaza_id()));
```

## Frontend (gate por capacidad desde la BD)

- **`assets/js/admin/api.js`**: `getMisPermisos()` → llama RPC `mis_permisos()`, devuelve `string[]`.
- **`assets/js/admin/dashboard.js`**:
  - Al iniciar, `const caps = new Set(await api.getMisPermisos());`.
  - Cada link del sidebar lleva `data-cap="<capacidad>"`; se elimina el link cuyo cap no esté en `caps` (igual que hoy con `data-rh-only`). `auditoria` pasa de `data-rh-only` a `data-cap="auditoria"`. `usuarios`/`administracion` siguen con `data-admin-global`.
  - `showPanel(id)` bloquea el routing a un panel sin capacidad (vuelve al landing).
  - Landing: si `caps` no tiene `overview`, primer panel disponible (asistencia para supervisor).
  - Badge: etiqueta para `supervisor`.
- **`assets/js/admin/usuarios.js`**: `ROLES` añade `['supervisor','Supervisor']`; la validación de plaza pasa de `rol === 'jefe'` a `rol !== 'rh'`.
- **`assets/js/admin/asistencia.js`**: el menú contextual de incidencia solo si `caps.has('marcar_incidencia')` (recibe `caps` desde dashboard al hacer `init`).
- **`assets/js/i18n.js`**: clave EN para `'Supervisor'` (y badge si aplica).

ponytail: políticas `supervisor_select_*` dedicadas en vez de ensanchar las `jefe_*` mixtas — más líneas, pero imposible filtrar escritura por accidente. El catálogo en BD permite cambiar permisos sin redeploy; si más adelante se quiere editar desde un panel, la tabla y su política de escritura ya existen.

## Self-review

- **Cobertura:** rol nuevo (CHECK + constraint plaza), permisos en BD (tabla + seed + RPC), RLS por tabla (7 políticas select), gate de UI por capacidad, alta de supervisor en Usuarios. ✓
- **Consistencia:** capacidades del catálogo == `data-cap` del sidebar == claves usadas en `puede`/`caps`. Cláusulas de scope copiadas verbatim de las políticas `jefe_*` existentes. ✓
- **Sin placeholders:** SQL completo y real. ✓
- **Riesgo:** el supervisor no tiene ninguna política de escritura → INSERT/UPDATE/DELETE denegados por RLS aunque la UI fallara. El rol se deriva del JWT en `mis_permisos()` y en `mi_rol()`; el cliente no lo puede falsear. ✓
- **Diferido (ponytail):** panel para editar `rol_permisos` desde la UI — la tabla y su RLS ya lo permiten; se añade cuando se pida.
```
