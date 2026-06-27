# Roles, permisos y RBAC del panel admin — Diseño

**Fecha:** 2026-06-26
**Estado:** Aprobado (brainstorming)

## Objetivo

Reemplazar el RBAC actual (hardcoded `rol ∈ {rh, jefe}` + flag `es_admin_global`)
por un modelo de **4 roles jerárquicos + permisos por rol + overrides por usuario**,
forzado íntegramente desde la base de datos vía RLS. El front solo pinta/oculta por
conveniencia; la verdad vive en Postgres.

Incluye además un paquete de mejoras de UI/UX del panel (logo de empresa en el
gafete, sección de gafetes, color y alcance global de turnos, turnos en móvil,
iconos de acción en móvil).

## Decisiones tomadas

- **Dónde viven los permisos:** roles administrativos dedicados (no el catálogo de
  `puestos`, que queda informativo). Un empleado operativo nunca hereda accesos por
  su puesto.
- **Roster (4 niveles), gobierno por delegación de nivel:** cada quien gestiona solo
  niveles inferiores; nunca a un par ni a sí mismo.
- **Overrides por usuario** para dar permisos extra puntuales sin crear más roles.
- **Mecanismo:** tabla de llaves de permiso + helper RLS `tiene_permiso(clave)`.

### Roster de roles

| Nivel | Rol (`clave`) | Global | Alcance | Gestiona a |
|------:|---------------|:------:|---------|------------|
| 4 | `super_admin` | sí | Todo, incl. datos de empresa (config/logo), plazas (geocercas), usuarios, auditoría | rh, jefe, supervisor |
| 3 | `rh`          | sí | Empleados/asistencia/turnos/gafetes/nóminas/avisos de **todas** las plazas; usuarios (inferiores); auditoría. **No** edita config de empresa ni plazas | jefe, supervisor |
| 2 | `jefe`        | no | "RH" de **su** plaza (empleados, asistencia, turnos, gafetes, avisos, nóminas-lectura); gestiona al supervisor de su plaza | supervisor (misma plaza) |
| 1 | `supervisor`  | no | **Su** plaza, principalmente lectura | — |

## Arquitectura de datos (migración `0035_roles_permisos.sql`)

Idempotente (`create table if not exists`, `on conflict do nothing`, `create or replace`).

### Catálogo de roles

```sql
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
```

### `perfiles_admin` (cambios)

- El check de `rol` pasa a `('super_admin','rh','jefe','supervisor')`.
- Migración de datos: `update perfiles_admin set rol='super_admin' where es_admin_global = true;`
  (los `rol='rh'` se quedan; `jefe` igual).
- Se conserva la columna `es_admin_global` por compatibilidad de lectura, pero deja
  de ser fuente de verdad. `es_admin_global()` se repunta (ver helpers).
- Añadir FK lógica: `rol` referencia conceptual a `roles.clave` (sin FK dura para no
  romper inserts antes del seed; el check enum ya acota valores).

### Catálogo de permisos y defaults

```sql
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
```

**Llaves de permiso (seed de `permisos`):**

| Zona | Llaves |
|------|--------|
| empleados | `empleados.ver`, `empleados.editar` |
| asistencia | `asistencia.ver`, `asistencia.editar` |
| turnos | `turnos.ver`, `turnos.editar` |
| gafetes | `gafetes.ver` |
| nominas | `nominas.ver`, `nominas.editar` *(módulo futuro; llaves listas, sin UI aún)* |
| avisos | `avisos.ver`, `avisos.editar` |
| plazas | `plazas.ver`, `plazas.editar` |
| puestos | `puestos.editar` |
| usuarios | `usuarios.ver`, `usuarios.crear`, `usuarios.editar` |
| config | `config.ver`, `config.editar` |
| auditoria | `auditoria.ver` |

**Defaults por rol (seed de `rol_permisos`)** — ✓ = lo trae por defecto:

| Llave | super_admin | rh | jefe | supervisor |
|-------|:--:|:--:|:--:|:--:|
| empleados.ver | ✓ | ✓ | ✓ | ✓ |
| empleados.editar | ✓ | ✓ | ✓ | |
| asistencia.ver | ✓ | ✓ | ✓ | ✓ |
| asistencia.editar | ✓ | ✓ | ✓ | |
| turnos.ver | ✓ | ✓ | ✓ | ✓ |
| turnos.editar | ✓ | ✓ | ✓ | |
| gafetes.ver | ✓ | ✓ | ✓ | ✓ |
| nominas.ver | ✓ | ✓ | ✓ | |
| nominas.editar | ✓ | ✓ | | |
| avisos.ver | ✓ | ✓ | ✓ | ✓ |
| avisos.editar | ✓ | ✓ | ✓ | |
| plazas.ver | ✓ | ✓ | ✓ | ✓ |
| plazas.editar | ✓ | | | |
| puestos.editar | ✓ | ✓ | | |
| usuarios.ver | ✓ | ✓ | ✓ | |
| usuarios.crear | ✓ | ✓ | ✓ | |
| usuarios.editar | ✓ | ✓ | ✓ | |
| config.ver | ✓ | ✓ | | |
| config.editar | ✓ | | | |
| auditoria.ver | ✓ | ✓ | | |

`usuarios.*` en jefe queda acotado por `puede_gestionar` (solo supervisores de su
plaza). `plazas.editar`, `config.editar` y `auditoria.ver` reservados arriba cumplen
"RH no se mete en datos de empresa más allá de RRHH".

### Helpers (todos `security definer`, `stable`, leen `auth.uid()` + `activo`)

```sql
-- nivel del rol actual (0 si no hay perfil activo)
create or replace function mi_nivel() returns int ...
  select coalesce((select r.nivel from perfiles_admin p join roles r on r.clave=p.rol
                   where p.id=auth.uid() and p.activo), 0);

-- ¿mi rol es global?
create or replace function es_global() returns boolean ...
  select coalesce((select r.es_global from perfiles_admin p join roles r on r.clave=p.rol
                   where p.id=auth.uid() and p.activo), false);

-- compat: repunta el helper de 0019 al nuevo modelo
create or replace function es_admin_global() returns boolean ...
  select mi_rol() = 'super_admin';

-- EL gate de permisos: override gana sobre el default del rol
create or replace function tiene_permiso(p_clave text) returns boolean ...
  select coalesce(
    (select pp.concedido from perfil_permisos pp
       where pp.perfil_id = auth.uid() and pp.permiso = p_clave),
    exists (select 1 from perfiles_admin p
              join rol_permisos rp on rp.rol = p.rol
            where p.id = auth.uid() and p.activo and rp.permiso = p_clave)
  );

-- reglas de oro: ¿puedo gestionar al perfil objetivo?
create or replace function puede_gestionar(p_objetivo uuid) returns boolean ...
  select case
    when p_objetivo = auth.uid() then false                  -- no a sí mismo
    when mi_nivel() = 0 then false
    else exists (
      select 1 from perfiles_admin t join roles r on r.clave = t.rol
      where t.id = p_objetivo
        and r.nivel < mi_nivel()                              -- estrictamente inferior
        and (es_global() or t.plaza_id = mi_plaza_id())       -- en mi alcance
    )
  end;

-- para el front: llaves efectivas del usuario actual
create or replace function mis_permisos() returns text[] ...
  select coalesce(array_agg(clave), '{}') from (
    select p.clave from permisos p
    where tiene_permiso(p.clave)
  ) q;
grant execute on function mis_permisos() to authenticated;
```

`grant select on roles, permisos, rol_permisos to authenticated;` (catálogos no sensibles, para pintar la matriz).

## Reglas de oro — RLS de gestión de usuarios

**`perfiles_admin`:**
- SELECT: `id = auth.uid() OR (tiene_permiso('usuarios.ver') AND (es_global() OR plaza_id = mi_plaza_id()))`
- INSERT (`with check`): `tiene_permiso('usuarios.crear') AND (select nivel from roles where clave = rol) < mi_nivel() AND (es_global() OR plaza_id = mi_plaza_id())`
- DELETE (`using`): `puede_gestionar(id)`
- UPDATE (`using`): `puede_gestionar(id) OR id = auth.uid()`

**Trigger `fn_guard_perfil` (`before update` / `before insert` en `perfiles_admin`):**
cierra lo que RLS no puede a nivel de columna.
- En la **propia** fila (`id = auth.uid()`): bloquear cambios en `rol`, `plaza_id`, `activo`.
- Gestionando a otro: el `rol` resultante debe tener `nivel < mi_nivel()` (no promover a par/superior).
- Si la regla se viola → `raise exception`.

**`perfil_permisos` (overrides):** INSERT/UPDATE/DELETE con
`puede_gestionar(perfil_id) AND tiene_permiso(permiso)`.
La segunda condición: **solo delegas permisos que tú mismo posees**.

> **Nota de provisión de cuentas:** crear el usuario en Supabase Auth requiere
> service_role (no lo tiene el cliente). El flujo actual da de alta el usuario en
> Auth y luego inserta su fila en `perfiles_admin`. Esta RLS gobierna la fila de
> perfil; la provisión del usuario Auth sigue el flujo existente (manual o edge
> function). No se amplía la superficie del cliente.

## RLS de tablas de datos

Reemplaza las policies `mi_rol()='rh'`/`'jefe'` por el patrón uniforme:
- SELECT: `tiene_permiso('<zona>.ver') AND (es_global() OR <plaza> = mi_plaza_id())`
- Escritura: `tiene_permiso('<zona>.editar') AND (es_global() OR <plaza> = mi_plaza_id())`

| Tabla | zona | scope-plaza |
|-------|------|-------------|
| empleados | empleados | `plaza_id` |
| registros | asistencia | vía `empleados.plaza_id` (subquery) |
| turnos | turnos | `plaza_id` **o global** (`plaza_id is null` visible a todos con `turnos.ver`) |
| plazas | plazas | `id` (editar = `plazas.editar`, default solo super_admin) |
| puestos | puestos | read libre `authenticated`; write `puestos.editar` |
| avisos | avisos | `plaza_id` (null = global) — reescribe policies de 0034 |
| config_global | config | `config.ver` / `config.editar` |
| audit_log | auditoria | `auditoria.ver` |
| incidencias | asistencia | vía plaza del empleado |

**RPCs:** `crear_empleado` y `actualizar_pin_empleado` cambian los checks `mi_rol()`
por `tiene_permiso('empleados.editar') AND (es_global() OR p_plaza_id = mi_plaza_id())`.

## Frontend

### Sesión y gating
- `assets/js/admin/auth.js`: tras cargar el perfil, llamar `mis_permisos()` (RPC) y
  guardar `perfil.permisos = [...]` en la sesión.
- Nuevo `assets/js/admin/permisos.js`: `puede(clave)` lee la sesión.
- `admin/dashboard/index.html`: cambiar `data-rh-only`/`data-admin-global` por
  `data-perm="<zona>.ver"` en links y grupos del sidebar.
- `assets/js/admin/dashboard.js`: ocultar links/grupos cuyo `data-perm` no se tenga;
  el badge de rol muestra los 4 nombres.

### Panel Usuarios (`assets/js/admin/usuarios.js`)
- Lista: solo usuarios visibles (la RLS ya filtra).
- Alta: selector de rol limitado a niveles `< mi_nivel`; plaza obligatoria si el rol
  no es global.
- **Editor de permisos por usuario:** matriz por zona, cada llave con tri-estado
  *hereda (default del rol) / concedido / revocado* → escribe en `perfil_permisos`
  (`concedido=true/false`, o borra la fila para "hereda"). Solo muestra llaves que el
  gestor **posee**. Editar/eliminar oculto si no `puede_gestionar`.

### Mejoras UI/UX (ui-ux-pro-max, estilo existente)
1. **Logo en gafete** (`gafetes.js`): dibujar `config_global.empresa_logo_url`
   (carga async de imagen en el PDF, `addImage`); fallback al `nombre_empresa` en
   texto si no hay logo. Sustituye el lockup "EQS/CHECADOR".
2. **Sección Gafetes:** mejor layout, animaciones de entrada, colores del sistema,
   preview más grande y centrado.
3. **Color de turno:** migración `turnos.color text` (`0036`); color picker en
   `turnos.js`; usar el color en la cuadrícula y reportes (reemplaza autocálculo).
4. **Turno global:** `turnos.plaza_id` pasa a *nullable* (`0036`); opción
   "Todas las plazas (global)" en el form de turno; un turno global aparece en todas.
5. **Turnos en móvil:** reordenar para que "mis turnos asignados" sea lo prominente y
   la cuadrícula general no acapare la pantalla.
6. **Iconos editar/eliminar en móvil:** siempre visibles (no hover) en pantallas
   chicas, en todas las tablas (CSS).

## Migraciones nuevas

- **`0035_roles_permisos.sql`** — roles, permisos, rol_permisos, perfil_permisos,
  helpers (`mi_nivel`, `es_global`, `tiene_permiso`, `puede_gestionar`, `mis_permisos`,
  repunte de `es_admin_global`), trigger `fn_guard_perfil`, reescritura de RLS de
  todas las tablas de datos + `perfiles_admin` + `perfil_permisos`, ajuste de
  `crear_empleado`/`actualizar_pin_empleado`, migración de datos
  `es_admin_global→super_admin`.
- **`0036_turnos_color_global.sql`** — `turnos.color text`, `turnos.plaza_id` nullable.

## Pruebas (mínimas, ponytail)

- SQL de humo para los helpers/golden-rules: dado un set de perfiles de prueba (uno
  por rol, dos jefes de plazas distintas), afirmar con asserts: `puede_gestionar`
  falso sobre sí mismo, falso entre pares, verdadero hacia inferior en alcance, falso
  hacia inferior de otra plaza; `tiene_permiso` respeta override sobre default; un
  jefe no puede conceder un permiso que no posee.
- `node --check` de los módulos JS nuevos/tocados; el patrón de tests `.mjs` puros
  existente para cualquier cálculo de la matriz de permisos en el front.

## Compatibilidad / riesgos

- `es_admin_global()` repuntado mantiene válidas las policies de `0019` sin tocarlas.
- La reescritura de RLS debe ser idempotente y borrar las policies viejas
  (`drop policy if exists`) antes de crear las nuevas, para no duplicar.
- Orden de despliegue: aplicar `0035`/`0036` (`supabase db push`) **antes** de subir
  el front que llama `mis_permisos()`; si el RPC no existe aún, el front degrada a
  "sin permisos" y oculta de más (falla cerrado, seguro).

## Techos conocidos (MVP)

- La provisión de usuarios Auth sigue fuera de RLS (service_role/manual).
- `nominas.*` son llaves listas sin módulo; no se renderiza zona de nóminas aún.
- Auditoría por plaza no se implementa (audit_log no está scopeado por plaza);
  `auditoria.ver` queda global (super_admin + rh).
