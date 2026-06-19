# Historial por empleado (admin) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que un admin vea el historial de asistencia de un empleado por rango de fechas, con retardos y horas trabajadas calculadas, foto/firma de cada checada, y registro manual de incidencias.

**Architecture:** Vista de admin nueva con dos entradas (drill-down desde Empleados + panel "Historial"). Los cálculos (retardo, horas) se hacen en el cliente en un módulo puro y testeable. Solo lee `registros`; escribe en una tabla nueva `incidencias`. Sigue el patrón existente de módulos admin (lazy-import desde `dashboard.js`, RLS por JWT).

**Tech Stack:** HTML + CSS + ES Modules vanilla (sin build). Supabase Postgres + PostgREST (anon key + JWT admin). Node ≥18 solo para correr el self-check del módulo de cálculos.

## Global Constraints

- Sin build step, sin frameworks. ES Modules vanilla. (CLAUDE.md)
- Imports ES module deben empezar con `./`, `../` o `/`. Rutas de assets relativas (sin `/assets/...`). (CLAUDE.md "GitHub Pages base path")
- Nuevas tablas/policies en una migración numerada nueva, **idempotente** (`create table if not exists`, `drop policy if exists` + create, `drop trigger if exists` + create). Nunca editar una migración ya aplicada. (CLAUDE.md)
- pgcrypto vive en schema `extensions`; no aplica aquí (no se hashea nada) pero cualquier SECURITY DEFINER nuevo usaría `set search_path = public, extensions`.
- Frontend admin autentica con JWT en `sessionStorage['eqs_admin_session']`; PostgREST aplica RLS. RBAC: `rh` (todo) vs `jefe` (su `mi_plaza_id()`).
- Diseño visual de la vista: seguir el skill **ui-ux-pro-max** (touch targets ≥44px, badges con texto no solo color, alt text en imágenes, inputs nativos `type="date"`, contraste AA).
- Al terminar cada cambio: `git add . && git commit && git push` (instrucción permanente del usuario).

---

### Task 1: Migración `0008_incidencias`

**Files:**
- Create: `supabase/migrations/0008_incidencias.sql`

**Interfaces:**
- Produces: tabla `incidencias (id bigint, id_empleado bigint, fecha date, tipo text, nota text, created_by uuid, created_at timestamptz)` con RLS y auditoría. PostgREST la expone en `/rest/v1/incidencias`.
- Consumes: `mi_rol()`, `mi_plaza_id()`, `fn_audit_log()` (definidos en `0004_admin_schema.sql`).

- [ ] **Step 1: Escribir la migración completa**

Create `supabase/migrations/0008_incidencias.sql`:

```sql
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
```

- [ ] **Step 2: Aplicar la migración a la DB enlazada**

Run: `supabase db push`
Expected: aplica `0008_incidencias` sin error (las migraciones previas ya están aplicadas). Si `db push` reporta drift, aplicar solo este archivo: `supabase db query --linked --file supabase/migrations/0008_incidencias.sql`

- [ ] **Step 3: Verificar que la tabla existe y RLS está activa**

Run:
```bash
supabase db query --linked --file /dev/stdin <<'SQL'
select tablename, rowsecurity from pg_tables where tablename = 'incidencias';
select polname from pg_policies where tablename = 'incidencias';
SQL
```
Expected: una fila `incidencias | t` y dos policies (`rh_all_incidencias`, `jefe_all_incidencias`).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0008_incidencias.sql
git commit -m "feat(db): tabla incidencias con RLS y auditoría (0008)"
git push
```

---

### Task 2: Módulo de cálculos puros `historial-calc.mjs`

**Files:**
- Create: `assets/js/admin/historial-calc.mjs`
- Test: `assets/js/admin/historial-calc.test.mjs`

**Interfaces:**
- Produces:
  - `horaAMin(t: string) => number` — "09:00:00" o "09:00" → minutos del día.
  - `esRetardo(reg, turno) => boolean` — `reg = {tipo, hora}` (hora ISO), `turno = {hora_entrada, tolerancia_entrada_min}`. `false` si no hay turno o `reg.tipo !== 'entrada'`.
  - `horasPorDia(registros) => [{fecha:'YYYY-MM-DD', entrada, salida, horas, incompleto}]` — agrupa por día local, empareja primera entrada / última salida.
  - `resumen(registros, turno, incidencias=[]) => {totalChecadas, retardos, horasTotales, incidencias}`.
- Extensión `.mjs` para que Node lo corra como ESM sin `package.json`; el navegador lo importa igual por ruta relativa.

- [ ] **Step 1: Escribir el test que falla**

Create `assets/js/admin/historial-calc.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { horaAMin, esRetardo, horasPorDia, resumen } from './historial-calc.mjs';

const turno = { hora_entrada: '09:00:00', tolerancia_entrada_min: 15 };

test('horaAMin convierte HH:MM[:SS] a minutos', () => {
  assert.equal(horaAMin('09:00:00'), 540);
  assert.equal(horaAMin('09:15'), 555);
});

test('esRetardo: entrada después de hora_entrada + tolerancia', () => {
  // 09:20 local > 09:15 límite → retardo
  assert.equal(esRetardo({ tipo: 'entrada', hora: '2026-06-19T09:20:00' }, turno), true);
  // 09:10 local <= 09:15 → no
  assert.equal(esRetardo({ tipo: 'entrada', hora: '2026-06-19T09:10:00' }, turno), false);
  // salida nunca es retardo
  assert.equal(esRetardo({ tipo: 'salida', hora: '2026-06-19T20:00:00' }, turno), false);
  // sin turno → no se evalúa
  assert.equal(esRetardo({ tipo: 'entrada', hora: '2026-06-19T09:20:00' }, null), false);
});

test('horasPorDia empareja primera entrada con última salida', () => {
  const regs = [
    { tipo: 'entrada', hora: '2026-06-19T09:00:00' },
    { tipo: 'salida',  hora: '2026-06-19T13:00:00' },
    { tipo: 'salida',  hora: '2026-06-19T18:00:00' }, // última salida
  ];
  const dias = horasPorDia(regs);
  assert.equal(dias.length, 1);
  assert.equal(dias[0].incompleto, false);
  assert.equal(dias[0].horas, 9); // 09:00 → 18:00
});

test('horasPorDia marca incompleto el día sin salida', () => {
  const dias = horasPorDia([{ tipo: 'entrada', hora: '2026-06-19T09:00:00' }]);
  assert.equal(dias[0].incompleto, true);
  assert.equal(dias[0].horas, 0);
});

test('resumen agrega totales', () => {
  const regs = [
    { tipo: 'entrada', hora: '2026-06-19T09:20:00' }, // retardo
    { tipo: 'salida',  hora: '2026-06-19T18:00:00' },
  ];
  const r = resumen(regs, turno, [{ tipo: 'falta' }]);
  assert.equal(r.totalChecadas, 2);
  assert.equal(r.retardos, 1);
  assert.equal(r.incidencias, 1);
  assert.ok(Math.abs(r.horasTotales - 8.7) < 0.01); // 09:20→18:00 = 8.666… → 8.7
});
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `node --test assets/js/admin/historial-calc.test.mjs`
Expected: FAIL — `Cannot find module './historial-calc.mjs'`.

- [ ] **Step 3: Implementar el módulo**

Create `assets/js/admin/historial-calc.mjs`:

```js
// Cálculos puros del historial de un empleado (sin DOM). Node-runnable self-check.
// ponytail: usa la zona horaria local del runtime (el del admin). Si la DB guarda
// UTC y el admin está en otra zona, los minutos-del-día se interpretan en local —
// correcto para el admin. Upgrade: pasar timezone explícita si se requiere multi-zona.

const minutosDia = (d) => d.getHours() * 60 + d.getMinutes();

export function horaAMin(t) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

export function esRetardo(reg, turno) {
  if (!turno || reg.tipo !== 'entrada' || !turno.hora_entrada) return false;
  const limite = horaAMin(turno.hora_entrada) + (turno.tolerancia_entrada_min ?? 0);
  return minutosDia(new Date(reg.hora)) > limite;
}

export function horasPorDia(registros) {
  const dias = new Map();
  for (const r of registros) {
    const d = new Date(r.hora);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const e = dias.get(key) ?? { fecha: key, entrada: null, salida: null };
    if (r.tipo === 'entrada' && (!e.entrada || new Date(r.hora) < new Date(e.entrada))) e.entrada = r.hora;
    if (r.tipo === 'salida'  && (!e.salida  || new Date(r.hora) > new Date(e.salida)))  e.salida  = r.hora;
    dias.set(key, e);
  }
  return [...dias.values()].map((e) => {
    const incompleto = !e.entrada || !e.salida;
    const horas = incompleto ? 0 : (new Date(e.salida) - new Date(e.entrada)) / 3_600_000;
    return { ...e, horas, incompleto };
  });
}

export function resumen(registros, turno, incidencias = []) {
  const retardos = registros.filter((r) => esRetardo(r, turno)).length;
  const horasTotales = horasPorDia(registros).reduce((s, d) => s + d.horas, 0);
  return {
    totalChecadas: registros.length,
    retardos,
    horasTotales: Math.round(horasTotales * 10) / 10,
    incidencias: incidencias.length,
  };
}
```

- [ ] **Step 4: Correr el test para verificar que pasa**

Run: `node --test assets/js/admin/historial-calc.test.mjs`
Expected: PASS — 5 tests passing.

- [ ] **Step 5: Commit**

```bash
git add assets/js/admin/historial-calc.mjs assets/js/admin/historial-calc.test.mjs
git commit -m "feat(admin): módulo de cálculos de historial (retardos, horas) + tests"
git push
```

---

### Task 3: Funciones de API para historial e incidencias

**Files:**
- Modify: `assets/js/admin/api.js` (agregar al final, antes de `statsHoy` o tras las secciones existentes)

**Interfaces:**
- Consumes: `apiFetch` (ya definido), filtros PostgREST.
- Produces:
  - `getRegistrosEmpleado(idEmpleado, { desde, hasta }) => Promise<registro[]>` con `id,tipo,hora,latitud,longitud,geocerca_valida,distancia_metros,ruta_foto,ruta_firma`, `order=hora.asc`.
  - `getEmpleado(id) => Promise<empleado|null>` con `plazas(nombre), turnos(*)`.
  - `getIncidencias(idEmpleado, { desde, hasta }) => Promise<incidencia[]>`.
  - `createIncidencia(d)`, `updateIncidencia(id, d)`, `deleteIncidencia(id)`.
- `getEmpleados()` ya existe (para el selector, scoped por RLS).

- [ ] **Step 1: Agregar las funciones**

Modify `assets/js/admin/api.js` — añadir esta sección (después de la sección `// ── Registros / Asistencia` existente):

```js
// ── Historial por empleado ──────────────────────────────────────────────────
export const getRegistrosEmpleado = (idEmpleado, { desde, hasta }) =>
  apiFetch(`registros?select=id,tipo,hora,latitud,longitud,geocerca_valida,distancia_metros,ruta_foto,ruta_firma` +
    `&id_empleado=eq.${idEmpleado}&hora=gte.${desde}T00:00:00&hora=lte.${hasta}T23:59:59&order=hora.asc`);

export const getEmpleado = (id) =>
  apiFetch(`empleados?select=*,plazas(nombre),turnos(*)&id=eq.${id}`).then((r) => r[0] ?? null);

// ── Incidencias ───────────────────────────────────────────────────────────────
export const getIncidencias = (idEmpleado, { desde, hasta }) =>
  apiFetch(`incidencias?select=*&id_empleado=eq.${idEmpleado}&fecha=gte.${desde}&fecha=lte.${hasta}&order=fecha.desc`);

export const createIncidencia = (d) =>
  apiFetch('incidencias', { method: 'POST', body: JSON.stringify(d) });

export const updateIncidencia = (id, d) =>
  apiFetch(`incidencias?id=eq.${id}`, { method: 'PATCH', body: JSON.stringify(d) });

export const deleteIncidencia = (id) =>
  apiFetch(`incidencias?id=eq.${id}`, { method: 'DELETE', headers: { 'Prefer': '' } });
```

- [ ] **Step 2: Verificar import en consola del navegador (manual)**

Servir el sitio (`npx serve .`), loguearse en `/admin`, abrir DevTools → Console:
```js
const api = await import('./assets/js/admin/api.js');
console.log(typeof api.getRegistrosEmpleado, typeof api.createIncidencia);
```
Expected: `function function`. (No commit aún — se prueba con datos reales en Task 4.)

- [ ] **Step 3: Commit**

```bash
git add assets/js/admin/api.js
git commit -m "feat(admin): API de historial por empleado e incidencias"
git push
```

---

### Task 4: Vista `historial-empleado.js` + ruta + nav

**Files:**
- Create: `assets/js/admin/historial-empleado.js`
- Modify: `admin/dashboard/index.html` (nav link + panel div — el panel `#panel-historial` puede no existir aún)
- Modify: `assets/js/admin/dashboard.js` (ruta `historial`)

**Interfaces:**
- Consumes: `getEmpleados`, `getEmpleado`, `getRegistrosEmpleado`, `getIncidencias`, `createIncidencia`, `updateIncidencia`, `deleteIncidencia` (Task 3); `horasPorDia`, `esRetardo`, `resumen` (Task 2); `openModal`, `closeModal`, `showToast`, `confirm`, `fmtFecha`, `loading`, `empty` (utils); `SUPABASE_URL` (config).
- Produces:
  - `export async function init(panel)` — construye selector (empleado + rango) y contenedor de resultados; si hay preselección pendiente, la muestra.
  - `export function preseleccionar(id)` — fija el empleado a mostrar en el próximo `init` (usado por el drill-down de Task 5).
  - `export async function mostrar(panel, idEmpleado, { desde, hasta })` — fetch + render del historial en `#hist-resultado`.

**UI (ui-ux-pro-max):** botones `abtn` (≥44px ya), badges `abadge` con texto (entrada/salida/retardo/fuera de geocerca — no solo color), `<input type="date">` nativo, thumbnails de foto/firma con `alt`, lightbox accesible (cerrar con click en backdrop), tabla `data-table` con scroll horizontal en móvil (`.table-scroll` ya existe). Tarjetas de resumen reusan `.stat-card` del overview.

- [ ] **Step 1: Agregar el panel y el link de navegación al HTML**

Modify `admin/dashboard/index.html`:

En el `<nav>`, dentro de la sección **Gestión** (justo antes del `<a data-panel="turnos">` o tras Empleados), agregar:

```html
      <a href="#historial" class="sidebar__link" data-panel="historial">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 3v18h18"/><path d="M18.7 8l-5.1 5.2-2.8-2.7L7 14.3"/></svg>
        Historial
      </a>
```

En `<main class="admin-content">`, junto a los otros `<div class="admin-panel">`, agregar:

```html
      <div id="panel-historial" class="admin-panel" data-title="Historial por empleado" hidden></div>
```

- [ ] **Step 2: Agregar la ruta en dashboard.js (sin cachear, para que el drill-down siempre re-renderice)**

Modify `assets/js/admin/dashboard.js` — dentro de `showPanel(id)`, **antes** de la línea `if (_loaded[id]) return;`, insertar:

```js
  if (id === 'historial') {
    const m = await import('./historial-empleado.js');
    await m.init(panel);
    return;
  }
```

(No se agrega `case 'historial'` al switch — se maneja arriba para que `init` corra en cada visita y respete la preselección del drill-down.)

- [ ] **Step 3: Implementar la vista**

Create `assets/js/admin/historial-empleado.js`:

```js
import * as api from './api.js';
import { horasPorDia, esRetardo, resumen } from './historial-calc.mjs';
import { openModal, closeModal, showToast, confirm, fmtFecha, loading, empty } from './utils.js';
import { SUPABASE_URL } from '../config.js';

const TIPOS = ['falta', 'permiso', 'justificacion', 'vacaciones'];
const publicURL = (ruta) => ruta ? `${SUPABASE_URL}/storage/v1/object/public/${ruta}` : null;
const hoyISO = () => new Date().toISOString().slice(0, 10);
const haceDiasISO = (n) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

let _preId = null;
export function preseleccionar(id) { _preId = id; }

let _empleados = [];

export async function init(panel) {
  _empleados = await api.getEmpleados().catch(() => []);
  const opts = _empleados.map((e) => `<option value="${e.id}">${e.nombre}</option>`).join('');

  panel.innerHTML = `
    <div class="panel-header">
      <h2>Historial por empleado</h2>
      <div class="panel-header__actions" style="flex-wrap:wrap;gap:8px">
        <select id="hist-emp" class="form-input" style="height:36px;min-width:200px" aria-label="Empleado">
          <option value="">– Selecciona empleado –</option>${opts}
        </select>
        <input id="hist-desde" type="date" class="form-input" style="height:36px" value="${haceDiasISO(30)}" aria-label="Desde">
        <input id="hist-hasta" type="date" class="form-input" style="height:36px" value="${hoyISO()}" aria-label="Hasta">
        <button id="hist-ver" class="abtn abtn--primary">Ver</button>
      </div>
    </div>
    <div id="hist-resultado"></div>`;

  const verBtn = panel.querySelector('#hist-ver');
  const empSel = panel.querySelector('#hist-emp');
  verBtn.addEventListener('click', () => {
    const id = parseInt(empSel.value);
    if (!id) { showToast('Selecciona un empleado.', 'error'); return; }
    mostrar(panel, id, rangoDe(panel));
  });

  if (_preId) {
    empSel.value = String(_preId);
    mostrar(panel, _preId, rangoDe(panel));
    _preId = null;
  }
}

function rangoDe(panel) {
  return {
    desde: panel.querySelector('#hist-desde').value || haceDiasISO(30),
    hasta: panel.querySelector('#hist-hasta').value || hoyISO(),
  };
}

export async function mostrar(panel, idEmpleado, rango) {
  const wrap = panel.querySelector('#hist-resultado');
  if (!wrap) return;
  loading(wrap);
  try {
    const [emp, registros, incidencias] = await Promise.all([
      api.getEmpleado(idEmpleado),
      api.getRegistrosEmpleado(idEmpleado, rango),
      api.getIncidencias(idEmpleado, rango),
    ]);
    const turno = emp?.turnos ?? null;
    render(wrap, idEmpleado, emp, turno, registros, incidencias, rango, panel);
  } catch (e) {
    wrap.innerHTML = `<div class="ad-empty" style="color:#DC2626">${e.message}</div>`;
  }
}

function badgeTipo(t) {
  return t === 'entrada'
    ? '<span class="abadge abadge--green">Entrada</span>'
    : '<span class="abadge abadge--orange">Salida</span>';
}

function render(wrap, idEmpleado, emp, turno, registros, incidencias, rango, panel) {
  const r = resumen(registros, turno, incidencias);
  const sinTurno = !turno;

  const cards = `
    <div class="stat-grid" style="margin-bottom:16px">
      <div class="stat-card"><div class="stat-card__label">Checadas</div><div class="stat-card__value">${r.totalChecadas}</div></div>
      <div class="stat-card"><div class="stat-card__label">Retardos</div><div class="stat-card__value" style="color:#DC2626">${sinTurno ? '–' : r.retardos}</div></div>
      <div class="stat-card"><div class="stat-card__label">Horas trabajadas</div><div class="stat-card__value" style="color:#16A34A">${r.horasTotales}</div></div>
      <div class="stat-card"><div class="stat-card__label">Incidencias</div><div class="stat-card__value" style="color:#0EA5E9">${r.incidencias}</div></div>
    </div>`;

  const avisoTurno = sinTurno
    ? `<p class="td-muted" style="margin-bottom:12px">Sin turno asignado — no se evalúan retardos.</p>` : '';

  const filasReg = registros.length ? registros.map((reg) => {
    const tarde = esRetardo(reg, turno);
    const foto = publicURL(reg.ruta_foto);
    const firma = publicURL(reg.ruta_firma);
    return `<tr>
      <td>${fmtFecha(reg.hora)}</td>
      <td>${badgeTipo(reg.tipo)}${tarde ? ' <span class="abadge abadge--red">Retardo</span>' : ''}</td>
      <td>${reg.geocerca_valida === false ? '<span class="abadge abadge--red">Fuera de geocerca</span>' : '<span class="abadge abadge--green">OK</span>'}</td>
      <td>${foto ? `<img src="${foto}" alt="Foto de checada" class="hist-thumb" data-full="${foto}">` : '–'}</td>
      <td>${firma ? `<img src="${firma}" alt="Firma de checada" class="hist-thumb hist-thumb--firma" data-full="${firma}">` : '–'}</td>
    </tr>`;
  }).join('') : `<tr><td colspan="5"><div class="ad-empty">Sin checadas en este rango.</div></td></tr>`;

  const filasInc = incidencias.length ? incidencias.map((i) => `
    <tr>
      <td>${i.fecha}</td>
      <td><span class="abadge abadge--gray">${i.tipo}</span></td>
      <td>${i.nota ?? '–'}</td>
      <td><div class="actions">
        <button class="abtn abtn--danger abtn--icon" title="Eliminar" data-del-inc="${i.id}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/></svg>
        </button>
      </div></td>
    </tr>`).join('') : `<tr><td colspan="4"><div class="ad-empty">Sin incidencias.</div></td></tr>`;

  wrap.innerHTML = `
    <div class="panel-header" style="border:0;padding-top:0">
      <h3 style="margin:0">${emp?.nombre ?? 'Empleado'} <span class="td-muted">· ${rango.desde} a ${rango.hasta}</span></h3>
      <button id="hist-nueva-inc" class="abtn abtn--primary">+ Incidencia</button>
    </div>
    ${cards}${avisoTurno}
    <div class="ad-card" style="margin-bottom:16px">
      <div class="table-scroll"><table class="data-table">
        <thead><tr><th>Fecha y hora</th><th>Tipo</th><th>Geocerca</th><th>Foto</th><th>Firma</th></tr></thead>
        <tbody>${filasReg}</tbody>
      </table></div>
    </div>
    <h4 style="margin:0 0 8px">Incidencias</h4>
    <div class="ad-card">
      <div class="table-scroll"><table class="data-table">
        <thead><tr><th>Fecha</th><th>Tipo</th><th>Nota</th><th style="width:80px">Acciones</th></tr></thead>
        <tbody>${filasInc}</tbody>
      </table></div>
    </div>
    <div id="hist-lightbox" class="hist-lightbox" hidden><img alt="Vista ampliada"></div>`;

  // Lightbox
  const lb = wrap.querySelector('#hist-lightbox');
  const lbImg = lb.querySelector('img');
  wrap.querySelectorAll('.hist-thumb').forEach((img) => {
    img.addEventListener('click', () => { lbImg.src = img.dataset.full; lb.hidden = false; });
  });
  lb.addEventListener('click', () => { lb.hidden = true; lbImg.src = ''; });

  // Nueva incidencia
  wrap.querySelector('#hist-nueva-inc').addEventListener('click', () => abrirFormInc(idEmpleado, rango, panel));

  // Eliminar incidencia
  wrap.querySelectorAll('[data-del-inc]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('¿Eliminar esta incidencia?')) return;
      try {
        await api.deleteIncidencia(parseInt(btn.dataset.delInc));
        showToast('Incidencia eliminada.', 'ok');
        mostrar(panel, idEmpleado, rango);
      } catch (e) { showToast(e.message, 'error'); }
    });
  });
}

function abrirFormInc(idEmpleado, rango, panel) {
  const tipoOpts = TIPOS.map((t) => `<option value="${t}">${t}</option>`).join('');
  openModal('Nueva incidencia',
    `<div class="form-group">
      <label for="inc-fecha">Fecha *</label>
      <input id="inc-fecha" class="form-input" type="date" value="${hoyISO()}">
    </div>
    <div class="form-group">
      <label for="inc-tipo">Tipo *</label>
      <select id="inc-tipo" class="form-input">${tipoOpts}</select>
    </div>
    <div class="form-group">
      <label for="inc-nota">Nota</label>
      <input id="inc-nota" class="form-input" placeholder="Opcional">
    </div>
    <p id="inc-error" class="error-inline" hidden></p>`,
    async () => {
      const fecha = document.getElementById('inc-fecha').value;
      const tipo  = document.getElementById('inc-tipo').value;
      const nota  = document.getElementById('inc-nota').value.trim() || null;
      const errEl = document.getElementById('inc-error');
      if (!fecha || !tipo) { errEl.textContent = 'Fecha y tipo son obligatorios.'; errEl.hidden = false; return; }
      try {
        await api.createIncidencia({ id_empleado: idEmpleado, fecha, tipo, nota });
        closeModal();
        showToast('Incidencia registrada.', 'ok');
        mostrar(panel, idEmpleado, rango);
      } catch (e) { errEl.textContent = e.message; errEl.hidden = false; }
    },
    'Guardar'
  );
}
```

- [ ] **Step 4: Agregar estilos mínimos (thumbnails + lightbox)**

`abadge--orange` y `stat-grid`/`stat-card`/`td-muted` ya existen en `estilos-admin.css` — no re-agregar. Solo faltan los thumbnails y el lightbox.

Modify `assets/css/estilos-admin.css` — agregar al final:

```css
.hist-thumb { width:40px; height:54px; object-fit:cover; border-radius:6px; border:1px solid var(--ad-linea, #E2E8F0); cursor:pointer; }
.hist-thumb--firma { object-fit:contain; background:#fff; }
.hist-lightbox { position:fixed; inset:0; background:rgba(15,23,42,.8); display:flex; align-items:center; justify-content:center; z-index:1000; padding:24px; cursor:zoom-out; }
.hist-lightbox[hidden] { display:none; }
.hist-lightbox img { max-width:90vw; max-height:90vh; border-radius:12px; background:#fff; }
```

- [ ] **Step 5: Verificación manual end-to-end**

Servir (`npx serve .` + túnel HTTPS si hace falta), login admin, click en "Historial" en el sidebar:
- Selecciona un empleado con turno y registros → aparecen tarjetas de resumen, tabla de checadas con badges, thumbnails de foto/firma.
- Click en un thumbnail → abre lightbox; click fuera → cierra.
- "+ Incidencia" → guardar una falta → reaparece en la tabla de incidencias; eliminarla → desaparece.
- Selecciona un empleado **sin turno** → aviso "Sin turno asignado", retardos en "–".
Expected: todo lo anterior funciona sin errores en consola.

- [ ] **Step 6: Commit**

```bash
git add assets/js/admin/historial-empleado.js admin/dashboard/index.html assets/js/admin/dashboard.js assets/css/estilos-admin.css
git commit -m "feat(admin): panel Historial por empleado con retardos, horas e incidencias"
git push
```

---

### Task 5: Drill-down desde el panel Empleados

**Files:**
- Modify: `assets/js/admin/empleados.js`

**Interfaces:**
- Consumes: `preseleccionar(id)` de `historial-empleado.js`; el link de nav `[data-panel="historial"]` (Task 4).
- Produces: botón "Historial" por fila que abre el panel Historial con ese empleado preseleccionado.

- [ ] **Step 1: Agregar el handler y el botón**

Modify `assets/js/admin/empleados.js`:

(a) Dentro de `loadEmpleados()`, junto a los otros `window._*`, agregar:

```js
    window._verHistorial = async (id) => {
      const m = await import('./historial-empleado.js');
      m.preseleccionar(id);
      document.querySelector('.sidebar__link[data-panel="historial"]').click();
    };
```

(b) En `renderEmpleados`, en el bloque de acciones (la función `(r) => ...`), agregar como primer botón:

```js
      <button class="abtn abtn--ghost abtn--icon" title="Ver historial" onclick="window._verHistorial(${r.id})">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 3v18h18"/><path d="M18.7 8l-5.1 5.2-2.8-2.7L7 14.3"/></svg>
      </button>
```

- [ ] **Step 2: Verificación manual**

Login admin → panel Empleados → click en el botón "Ver historial" de una fila.
Expected: salta al panel Historial con ese empleado ya seleccionado y su historial cargado. El click del nav lo lleva (cierra sidebar en móvil). Repetir con otro empleado funciona (no se queda en el anterior).

- [ ] **Step 3: Commit**

```bash
git add assets/js/admin/empleados.js
git commit -m "feat(admin): drill-down a Historial desde el panel Empleados"
git push
```

---

## Self-Review

**1. Spec coverage:**
- Vista única + dos entradas (drill-down + panel) → Task 4 (panel) + Task 5 (drill-down), comparten `historial-empleado.js`. ✓
- `getRegistros` extendido con foto/firma + filtro por empleado/rango → Task 3 (`getRegistrosEmpleado`). ✓
- Turno del empleado para tolerancias → Task 3 (`getEmpleado` con `turnos(*)`). ✓
- Cálculos cliente: retardo, horas, sin-turno → Task 2 (módulo + tests) usado en Task 4. ✓
- Faltas manuales vía `incidencias` (no automáticas) → Task 1 (tabla) + Task 4 (CRUD UI). ✓
- Resumen: total, retardos, horas, incidencias → Task 2 `resumen` + Task 4 tarjetas. ✓
- Tabla `incidencias` con RLS espejando registros + auditoría → Task 1. ✓
- UI reusa data-table/abadge/modal/lightbox por URL pública → Task 4. ✓
- Solo lee registros, solo escribe incidencias → ninguna tarea modifica `registros`. ✓
- Ceiling (primera entrada/última salida, TZ local, sin festivos) → comentario `ponytail:` en Task 2. ✓

**2. Placeholder scan:** Sin TODO/TBD; todo el código está completo. ✓

**3. Type consistency:** `mostrar(panel, idEmpleado, {desde,hasta})`, `init(panel)`, `preseleccionar(id)`, `resumen(registros,turno,incidencias)`, `esRetardo(reg,turno)`, `horasPorDia(registros)` — nombres y firmas idénticos entre Task 2/3/4/5. `getRegistrosEmpleado`/`getEmpleado`/`getIncidencias`/`createIncidencia`/`deleteIncidencia` idénticos entre Task 3 y su uso en Task 4. ✓

**Nota de verificación:** este proyecto no tiene runner de tests de UI; la lógica no trivial (cálculos) se cubre con `node --test` en Task 2, y las piezas de UI/SQL se verifican manualmente (Tasks 1, 3, 4, 5) por ser vanilla sin build.
