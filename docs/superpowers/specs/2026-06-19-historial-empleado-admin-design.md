# Historial por empleado (admin) — Diseño

**Fecha:** 2026-06-19
**Subproyecto:** #1 de la iniciativa "reemplazar funciones de RH en el dashboard de admin".
Subproyectos posteriores (cada uno con su propio spec): #2 Reportes/exportar, #3 Correcciones de registros, #4 Gestión de admins.

## Objetivo

Que un admin (RH o jefe) pueda ver el historial de asistencia de un empleado por rango de
fechas, con retardos y horas trabajadas calculadas, ver foto/firma de cada checada, y marcar
incidencias manuales (faltas, permisos, justificaciones, vacaciones).

## No-objetivos (fase 1)

- Cálculo automático de faltas. Las faltas se registran manualmente vía `incidencias`.
- Festivos automáticos. Se cubren marcando incidencias a mano.
- Exportar a CSV/Excel (subproyecto #2).
- Editar/borrar/agregar checadas (`registros`) — eso es el subproyecto #3 (correcciones).
  Esta fase solo **lee** `registros`; solo **escribe** en `incidencias`.

## Enfoque elegido: cálculos en el cliente

El admin trae los `registros` del empleado + su turno + sus incidencias del rango, y calcula
retardos/horas trabajadas en JS. Es el patrón que ya usa la app (asistencia y stats se calculan
en cliente) y RLS ya protege los datos; no se justifica un RPC SECURITY DEFINER nuevo.

Alternativa descartada: RPC en la DB que devuelve métricas pre-calculadas. Más robusta pero
agrega SQL sin frontera de seguridad nueva que lo amerite — el admin ya lee `registros` directo.

## Componentes

### 1. Vista `assets/js/admin/historial-empleado.js` (nuevo)

Módulo de render con una entrada pública:

```
export async function render(panel, idEmpleado, { desde, hasta })
```

Dos formas de llegar a él, ambas llaman `render(...)`:

- **Drill-down** desde el panel Empleados: click en una fila abre el historial de ese empleado.
  Rango por defecto: últimos 30 días.
- **Panel "Historial"** (nuevo): selector de empleado + inputs de rango (`<input type="date">`),
  botón "Ver". Nuevo botón en el sidebar, sección **Gestión**.

### 2. Routing / sidebar (`admin/dashboard/index.html` + `dashboard.js`)

- Nuevo `<a data-panel="historial">` en sección Gestión, y `<div id="panel-historial">`.
- `dashboard.js`: nuevo `case 'historial'` que importa `historial-empleado.js`.
  El panel sin empleado seleccionado muestra el selector; con empleado, el historial.
- Drill-down: en `empleados.js`, la fila (o un botón "Historial") navega a
  `#historial` y dispara el render con ese `idEmpleado`. Se comparte el panel `#panel-historial`.

### 3. API (`assets/js/admin/api.js`)

- Extender/crear `getRegistrosEmpleado(idEmpleado, { desde, hasta })`:
  `select=id,tipo,hora,latitud,longitud,geocerca_valida,distancia_metros,ruta_foto,ruta_firma`
  filtrado por `id_empleado=eq.` + rango sobre `hora`, `order=hora.asc`.
- `getEmpleado(id)` con `turnos(*)` para obtener tolerancias y horario.
- Incidencias CRUD:
  - `getIncidencias(idEmpleado, { desde, hasta })`
  - `createIncidencia(d)` / `updateIncidencia(id, d)` / `deleteIncidencia(id)`

### 4. Cálculos en cliente (dentro de `historial-empleado.js`)

- **Retardo**: una checada `tipo='entrada'` cuya hora-del-día `> turno.hora_entrada +
  tolerancia_entrada_min` → badge "Retardo". Sin turno asignado → no se evalúa.
- **Horas trabajadas por día**: emparejar primera `entrada` con última `salida` del mismo día.
  Día sin salida → "incompleto", no suma horas.
- **Faltas**: NO se calculan. Se muestran las incidencias `tipo='falta'` marcadas a mano.
- **Resumen del rango** (arriba): total checadas, # retardos, horas trabajadas totales,
  # incidencias.

`ponytail:` retardos/horas asumen una entrada y una salida limpias por día; con múltiples
checadas se toma la **primera** entrada y la **última** salida del día. Festivos automáticos no
existen — se cubren con incidencias manuales. Upgrade: tabla de festivos + cálculo de faltas
automático en una fase posterior.

### 5. Tabla nueva `incidencias` (migración `supabase/migrations/0008_incidencias.sql`)

```sql
create table if not exists incidencias (
  id          bigint generated always as identity primary key,
  id_empleado bigint not null references empleados(id) on delete cascade,
  fecha       date not null,
  tipo        text not null check (tipo in ('falta','permiso','justificacion','vacaciones')),
  nota        text,
  created_by  uuid references perfiles_admin(id),
  created_at  timestamptz not null default now()
);
create index if not exists incidencias_empleado_fecha_idx on incidencias (id_empleado, fecha);
alter table incidencias enable row level security;
```

RLS espejando `registros` (idempotente, `drop policy if exists` + create):

- `rh_all_incidencias`: `to authenticated using (mi_rol() = 'rh') with check (mi_rol() = 'rh')`.
- `jefe_all_incidencias` (select/insert/update/delete) scoped:
  `mi_rol() = 'jefe' and id_empleado in (select id from empleados where plaza_id = mi_plaza_id())`.

Auditoría: trigger de audit_log sobre `incidencias` espejando el patrón de las otras tablas
(`drop trigger if exists` + create).

Migración idempotente y acumulativa; no editar migraciones previas.

### 6. UI

- Reusa estilos de admin existentes: `data-table`, `abadge` (verde/rojo/gris), `panel-header`,
  `ad-card`, modal compartido (`openModal`/`closeModal`), `showToast`.
- Foto/firma de cada checada: thumbnail → lightbox por URL pública del bucket
  (`${SUPABASE_URL}/storage/v1/object/public/<ruta>`), igual que el historial del empleado.
- Botón "Marcar incidencia" abre el modal compartido (fecha, tipo, nota) → `createIncidencia`.
  Cada incidencia listada tiene editar/borrar.
- Badges por fila: "Entrada/Salida", "Retardo", "Fuera de geocerca" (si `geocerca_valida=false`).

## Manejo de errores

- Empleado sin turno: render normal, sin columna/badge de retardo, aviso "Sin turno asignado".
- Rango vacío: estado vacío "Sin checadas en este rango".
- Fallo de red en cualquier fetch: mensaje de error en el panel (patrón `ad-empty` rojo ya usado).
- `jefe` intentando ver empleado de otra plaza: RLS devuelve vacío (no es fuga, es correcto);
  el selector de empleado solo lista los que su RLS le permite (`getEmpleados` ya está scoped).

## Pruebas

- Self-check de los cálculos (retardo, emparejado entrada/salida, horas) con datos de ejemplo
  en un pequeño bloque de aserciones (sin framework), por ser la lógica no trivial de la fase.
- Verificación manual: aplicar `0008`, marcar una incidencia, ver retardo con un empleado con
  turno, ver "sin turno" con uno sin turno.

## Archivos tocados

- `supabase/migrations/0008_incidencias.sql` (nuevo)
- `assets/js/admin/historial-empleado.js` (nuevo)
- `assets/js/admin/api.js` (extender)
- `assets/js/admin/empleados.js` (drill-down)
- `assets/js/admin/dashboard.js` (routing `historial`)
- `admin/dashboard/index.html` (nav + panel)
- CSS admin solo si hace falta algo que no cubran los estilos existentes.
