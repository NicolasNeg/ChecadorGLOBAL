# Mejoras Operativas (MVP) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (ejecución inline, por lotes con checkpoints). Steps usan checkbox (`- [ ]`).

**Goal:** Dos mejoras operativas de alto impacto y bajo riesgo sobre datos existentes: copiar la distribución de turnos de la semana anterior, y exportar el tablero de asistencia a CSV.

**Architecture:** Sitio estático multipágina (vanilla ES Modules, sin build) contra Supabase. Ambas mejoras son cliente puro: nuevos helpers en `admin/api.js` (PostgREST) y handlers en los módulos del panel. CSV vía `Blob` + `<a download>` (sin librerías).

**Tech Stack:** Vanilla JS, PostgREST REST, Blob API.

## Global Constraints

- Rutas relativas en HTML, `BASE + '/ruta'` en navegación JS (GitHub Pages `/ChecadorGLOBAL/`).
- Fechas TZ-safe: `ymd()` local (`getFullYear/getMonth/getDate`), NUNCA `toISOString()`. Para parsear `'YYYY-MM-DD'` sin correr de día usar `new Date(fecha + 'T12:00:00')`.
- No añadir dependencias (ponytail): CSV y descarga con APIs nativas.
- Respetar el alcance por plaza: las operaciones masivas sólo tocan empleados de la plaza en foco (`filterByPlaza`).
- Toda nueva cadena visible va con su clave EN en `assets/js/i18n.js`.
- Cada cambio termina con `git add . && git commit && git push`; el commit cierra con:
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`

---

## Phase A — Copiar semana anterior (distribución de turnos)

**Problema:** RH planifica cada semana desde cero en la cuadrícula (`turnos_dia`). Replicar el patrón de la semana previa es lo más común y hoy es manual celda por celda.

**Enfoque:** Botón "Copiar semana anterior" en la barra de navegación de la cuadrícula (sólo si la semana visible es editable). "Copiar" = la semana visible queda **idéntica** a la anterior: se borra el rango y se reescribe con las filas de la semana previa desplazadas +7 días (preserva el día de la semana). Confirmación antes (sobrescribe).

### Task A.1: Helpers de API (bulk upsert + borrado de rango)

**Files:**
- Modify: `assets/js/admin/api.js:108` (tras `setTurnoDia`)

**Interfaces:**
- Produces:
  - `deleteTurnosDiaRango(empIds:number[], desde:string, hasta:string) → Promise`
  - `setTurnosDiaBulk(rows:{id_empleado,fecha,turno_id}[]) → Promise`

- [ ] **Step 1: Añadir los helpers**

```js
// Reemplazo de semana: borra el rango de estos empleados…
export const deleteTurnosDiaRango = (empIds, desde, hasta) =>
  empIds.length
    ? apiFetch(`turnos_dia?id_empleado=in.(${empIds.join(',')})&fecha=gte.${desde}&fecha=lte.${hasta}`,
        { method: 'DELETE', headers: { Prefer: '' } })
    : null;

// …y luego inserta en bloque (upsert por (empleado, fecha)).
export const setTurnosDiaBulk = (rows) =>
  rows.length
    ? apiFetch('turnos_dia?on_conflict=id_empleado,fecha', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify(rows)
      })
    : null;
```

- [ ] **Step 2: Verificar sintaxis** — `node --check assets/js/admin/api.js`

### Task A.2: Botón + handler en la cuadrícula

**Files:**
- Modify: `assets/js/admin/turnos.js` (nav, scope de `activos`, handler)
- Modify: `assets/js/i18n.js` (claves EN)

- [ ] **Step 1: Guardar `activos` a nivel de módulo** — añadir `let _gridActivos = [];` cerca de `let _semana` (línea 15) y, en `loadGrid` tras calcular `activos` (línea 58), `_gridActivos = activos;`.

- [ ] **Step 2: Añadir el botón al nav** — en el bloque `nav` (líneas 70-78), tras el botón `#sem-hoy`:
```js
        <button class="sem-nav__hoy" id="sem-copiar" ${readonly ? 'hidden' : ''}>${tr('Copiar semana anterior')}</button>
```

- [ ] **Step 3: Implementar y enlazar el handler** — tras `bindNav(wrap);` en `loadGrid` (línea 100), añadir:
```js
    wrap.querySelector('#sem-copiar')?.addEventListener('click', () => copiarSemanaAnterior(wrap));
```
Y la función (junto a `bindNav`):
```js
async function copiarSemanaAnterior(wrap) {
  const activos = _gridActivos;
  if (!activos.length) return;
  if (!await confirm(tr('¿Copiar la semana anterior? Se reemplazará la semana actual.'), { ok: tr('Copiar') })) return;

  const srcLunes = addDias(_semana, -7);
  const src = await api.getTurnosDia({ desde: ymd(srcLunes), hasta: ymd(addDias(srcLunes, 6)) });
  const empSet = new Set(activos.map(e => e.id));
  // Cada fila origen → misma posición +7 días (conserva el día de la semana).
  const rows = src.filter(d => empSet.has(d.id_empleado)).map(d => ({
    id_empleado: d.id_empleado,
    fecha: ymd(addDias(new Date(d.fecha + 'T12:00:00'), 7)),
    turno_id: d.turno_id,
  }));
  if (!rows.length) { showToast(tr('La semana anterior no tiene turnos.'), 'error'); return; }

  try {
    // "Copiar" = la semana queda idéntica a la anterior: limpia y reescribe.
    await api.deleteTurnosDiaRango(activos.map(e => e.id), ymd(_semana), ymd(addDias(_semana, 6)));
    await api.setTurnosDiaBulk(rows);
    showToast(tr('Semana copiada.'), 'ok');
    await loadGrid();
  } catch (e) { showToast(e.message, 'error'); }
}
```

- [ ] **Step 4: Claves EN en i18n.js**
```js
'Copiar semana anterior': 'Copy previous week',
'¿Copiar la semana anterior? Se reemplazará la semana actual.': 'Copy the previous week? This will replace the current week.',
'Copiar': 'Copy',
'La semana anterior no tiene turnos.': 'The previous week has no shifts.',
'Semana copiada.': 'Week copied.',
```

- [ ] **Step 5: Verificar** — `node --check assets/js/admin/turnos.js assets/js/i18n.js`

- [ ] **Step 6: Commit**
```bash
git add assets/js/admin/api.js assets/js/admin/turnos.js assets/js/i18n.js
git commit -m "feat(turnos): copiar la distribución de la semana anterior

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git push
```

---

## Phase B — Exportar asistencia a CSV

**Problema:** El tablero mensual de asistencia no se puede sacar para nómina/reportes.

**Enfoque:** Botón "Exportar CSV" en la cabecera del tablero. Exporta la matriz ya calculada (`_tablero`): una fila por empleado, una columna por día con el estado de cada celda. CSV con BOM UTF-8 (acentos en Excel) y descarga nativa.

### Task B.1: Botón + exportador

**Files:**
- Modify: `assets/js/admin/asistencia.js` (botón en header, handler, helpers)
- Modify: `assets/js/i18n.js` (claves EN)

- [ ] **Step 1: Botón en la cabecera** — en `panel-header` (líneas 42-48), junto a `#btn-refrescar`:
```js
      <button class="abtn abtn--ghost" id="btn-exportar">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        ${t('Exportar CSV')}
      </button>
```

- [ ] **Step 2: Enlazar** — tras la línea del listener de `#btn-refrescar` (línea 70):
```js
  document.getElementById('btn-exportar').addEventListener('click', exportarCSV);
```

- [ ] **Step 3: Handler + helpers** (al final del archivo):
```js
const csvCell = (v) => {
  const s = String(v ?? '');
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

function descargar(texto, nombre) {
  const url = URL.createObjectURL(new Blob([texto], { type: 'text/csv;charset=utf-8;' }));
  const a = document.createElement('a');
  a.href = url; a.download = nombre;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

function exportarCSV() {
  if (!_tablero) return;
  const { dias, filas } = _tablero;
  const head = [t('Empleado'), t('Núm.'), ...dias.map(d => `${d.dia} ${DOW_AB[d.dow]}`)];
  const rows = filas.map(f => [
    f.empleado.nombre,
    f.empleado.numero_empleado || '',
    ...f.celdas.map(c => c.cat === 'futuro' ? '' : (c.estado || '')),
  ]);
  const csv = [head, ...rows].map(r => r.map(csvCell).join(',')).join('\r\n');
  const mm = String(_mes.m + 1).padStart(2, '0');
  descargar('﻿' + csv, `asistencia-${_mes.y}-${mm}.csv`);
}
```

- [ ] **Step 4: Claves EN en i18n.js**
```js
'Exportar CSV': 'Export CSV',
'Núm.': 'No.',
```

- [ ] **Step 5: Verificar** — `node --check assets/js/admin/asistencia.js assets/js/i18n.js`

- [ ] **Step 6: Commit**
```bash
git add assets/js/admin/asistencia.js assets/js/i18n.js
git commit -m "feat(asistencia): exportar el tablero mensual a CSV

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git push
```

---

## Self-Review

- **Cobertura:** A = copiar semana (turnos), B = export CSV (asistencia). Ambas mejoras solicitadas como operativas/funciones nuevas.
- **Sin placeholders:** código real para helpers de API, handler de copia y exportador.
- **Consistencia de tipos:** `setTurnosDiaBulk` consume `{id_empleado,fecha,turno_id}` (misma forma que `getTurnosDia` devuelve). `_tablero.filas[].celdas[].{cat,estado,ymd,dia}` y `.dias[].{dia,dow}` ya existentes en `tableroMes`.
- **Riesgo:** copiar borra+reescribe SÓLO el rango de la semana visible y de los empleados de la plaza en foco; con confirmación previa. CSV es de sólo lectura.
- **Diferido (ponytail):** PWA instalable + fichaje offline — superficie mayor y el encolado de escrituras offline tiene correctitud propia; no entra aquí.
