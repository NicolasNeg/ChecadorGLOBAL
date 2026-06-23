import * as api from './api.js';
import { esc, showToast, DEFAULT_PFP } from './utils.js';
import { filterByPlaza } from './plaza-scope.js';
import { tableroMes } from './historial-calc.mjs';
import { getAdminSession } from './auth.js';
import { t, getLang } from '../i18n.js';

let _refreshTimer = null;
let _mes = null;        // { y, m } mes en foco
let _tablero = null;    // último tablero calculado (para el spotlight)
let _sel = null;        // id del empleado seleccionado
let _menu = null;       // menú contextual (click derecho / mantener pulsado)
let _menuTarget = null; // { emp, ymd } de la celda apuntada

// Opciones del menú contextual → tipo de incidencia ('reset' = borrar overrides del día).
const MENU = [
  ['asistencia', 'Asistencia'],
  ['falta',      'Falta'],
  ['permiso',    'Permiso'],
  ['festivo',    'Festivo'],
  ['vacaciones', 'Vacaciones'],
  ['descanso',   'Descanso'],
  ['reset',      'Reset'],
];

const DOW_AB = ['D','L','M','M','J','V','S'];
const CATS = [
  { cat: 'presente',   label: 'Asistencia' },
  { cat: 'retardo',    label: 'Retardo' },
  { cat: 'falta',      label: 'Falta' },
  { cat: 'permiso',    label: 'Permiso' },
  { cat: 'descanso',   label: 'Descanso' },
  { cat: 'sinasignar', label: 'Sin asignar' },
];

// Etiqueta legible por estado granular (para el tooltip de cada celda).
const ESTADO_LBL = {
  presente: 'Asistencia', retardo: 'Retardo', falta: 'Falta', permiso: 'Permiso',
  justificacion: 'Justificación', vacaciones: 'Vacaciones', festivo: 'Festivo',
  descanso: 'Descanso', sinasignar: 'Sin asignar', futuro: '', previo: '',
};

// PDF: inicial + color por estado. Estados sin entrada (sinasignar/futuro/previo)
// salen en blanco. Colores alineados con la leyenda en pantalla.
const PDF_CELL = {
  presente:      { ini: 'A',  bg: '#22C55E', fg: '#fff' },
  retardo:       { ini: 'R',  bg: '#F59E0B', fg: '#fff' },
  falta:         { ini: 'F',  bg: '#EF4444', fg: '#fff' },
  permiso:       { ini: 'P',  bg: '#3B82F6', fg: '#fff' },
  justificacion: { ini: 'J',  bg: '#3B82F6', fg: '#fff' },
  vacaciones:    { ini: 'V',  bg: '#3B82F6', fg: '#fff' },
  festivo:       { ini: 'Fe', bg: '#3B82F6', fg: '#fff' },
  descanso:      { ini: 'D',  bg: '#CBD5E1', fg: '#0f172a' },
};
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const hoyYmd = () => ymd(new Date()); // fecha local de hoy (ymd queda tapado por el parámetro en showMenu)
const iniciales = (n) => (n || '?').trim().split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
const rangoMes = ({ y, m }) => ({ desde: ymd(new Date(y, m, 1)), hasta: ymd(new Date(y, m + 1, 0)) });

export async function init(panel) {
  const now = new Date();
  _mes = { y: now.getFullYear(), m: now.getMonth() };
  _sel = null;

  panel.innerHTML = `
    <div class="panel-header">
      <h2>${t('Tablero de Asistencia')}</h2>
      <div class="panel-header__actions">
        <button class="abtn abtn--ghost" id="btn-spotlight" title="${t('Mostrar u ocultar el panel lateral')}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="15" y1="3" x2="15" y2="21"/></svg>
          ${t('Panel')}
        </button>
        <button class="abtn abtn--ghost" id="btn-exportar">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="15" x2="15" y2="15"/><line x1="9" y1="18" x2="15" y2="18"/></svg>
          ${t('Exportar PDF')}
        </button>
        <button class="abtn abtn--ghost" id="btn-refrescar">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
          ${t('Actualizar')}
        </button>
      </div>
    </div>

    <div class="asis-bar">
      <div class="asis-nav">
        <button class="abtn abtn--ghost abtn--icon" id="mes-prev" aria-label="${t('Mes anterior')}">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        <input type="month" class="asis-nav__title asis-month" id="mes-pick" aria-label="${t('Ir al mes')}">
        <button class="abtn abtn--ghost abtn--icon" id="mes-next" aria-label="${t('Mes siguiente')}">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
        </button>
      </div>
      <div class="asis-legend" id="asis-legend">
        ${CATS.map(c => `<button class="asis-leg asis-leg--${c.cat}" data-cat="${c.cat}" aria-pressed="false"><span class="asis-leg__dot"></span>${t(c.label)}</button>`).join('')}
      </div>
    </div>

    <div class="asis-board">
      <div class="ad-card asis-board__grid" id="asis-grid-wrap"></div>
      <aside class="ad-card asis-spotlight" id="asis-spotlight"></aside>
    </div>`;

  document.getElementById('btn-refrescar').addEventListener('click', load);
  document.getElementById('btn-exportar').addEventListener('click', exportarPDF);
  document.getElementById('btn-spotlight').addEventListener('click', () => {
    localStorage.setItem('eqs_asis_spotlight_fijo', spotFijo() ? '0' : '1');
    applySpot();
  });
  applySpot();
  document.getElementById('mes-prev').addEventListener('click', () => stepMes(-1));
  document.getElementById('mes-next').addEventListener('click', () => stepMes(1));
  document.getElementById('mes-pick').addEventListener('change', (e) => {
    const [y, m] = e.target.value.split('-').map(Number);
    if (y && m) { _mes = { y, m: m - 1 }; load(); }
  });
  document.getElementById('asis-legend').addEventListener('click', onLegend);

  buildMenu();
  await load();
  _refreshTimer = setInterval(load, 60_000);
}

export function destroy() {
  clearInterval(_refreshTimer);
  document.removeEventListener('click', onDocClick, true);
  document.removeEventListener('keydown', onEsc);
  window.removeEventListener('scroll', hideMenu, true);
  _menu?.remove();
  _menu = null;
}

// ── Menú contextual: marca una incidencia para una celda (empleado + día) ─────
function buildMenu() {
  if (_menu) return;
  _menu = document.createElement('div');
  _menu.className = 'ctx-menu';
  _menu.hidden = true;
  _menu.setAttribute('role', 'menu');
  _menu.innerHTML = MENU.map(([tipo, label]) =>
    `<button type="button" class="ctx-menu__item ctx-menu__item--${tipo}" data-tipo="${tipo}" role="menuitem"><span class="ctx-menu__dot"></span>${t(label)}</button>`).join('');
  _menu.addEventListener('click', (e) => {
    const b = e.target.closest('[data-tipo]');
    if (!b || !_menuTarget) return;
    const { emp, ymd } = _menuTarget;
    hideMenu();
    setIncidencia(emp, ymd, b.dataset.tipo);
  });
  document.body.appendChild(_menu);
  document.addEventListener('click', onDocClick, true);
  document.addEventListener('keydown', onEsc);
  window.addEventListener('scroll', hideMenu, true);
}

// Asistencia/Falta no se pueden marcar en días que aún no llegan (no son hechos
// todavía); permiso/festivo/vacaciones/descanso sí se pueden adelantar.
const FUTURO_BLOQUEADO = new Set(['asistencia', 'falta']);

function showMenu(x, y, emp, ymd) {
  _menuTarget = { emp: parseInt(emp), ymd };
  const esFuturo = ymd > hoyYmd();
  _menu.querySelectorAll('[data-tipo]').forEach((b) => {
    const bloq = esFuturo && FUTURO_BLOQUEADO.has(b.dataset.tipo);
    b.disabled = bloq;
    b.classList.toggle('ctx-menu__item--disabled', bloq);
  });
  _menu.hidden = false; // mostrar para medir tamaño
  const w = _menu.offsetWidth, h = _menu.offsetHeight;
  _menu.style.left = Math.min(x, window.innerWidth - w - 8) + 'px';
  _menu.style.top  = Math.min(y, window.innerHeight - h - 8) + 'px';
}
function hideMenu() { if (_menu) _menu.hidden = true; }
function onDocClick(e) { if (_menu && !_menu.hidden && !_menu.contains(e.target)) hideMenu(); }
function onEsc(e) { if (e.key === 'Escape') hideMenu(); }

async function setIncidencia(empId, fecha, tipo) {
  if (FUTURO_BLOQUEADO.has(tipo) && fecha > hoyYmd()) {
    showToast(t('No se puede marcar asistencia ni falta en días que aún no llegan.'), 'error');
    return;
  }
  try {
    // Siempre limpiamos overrides previos del día; 'reset' deja el día sin override
    // (vuelve al estado calculado por checadas + turnos_dia).
    const prev = await api.getIncidencias(empId, { desde: fecha, hasta: fecha });
    for (const i of prev) await api.deleteIncidencia(i.id);
    if (tipo !== 'reset')
      await api.createIncidencia({ id_empleado: empId, fecha, tipo, autor_nombre: getAdminSession()?.nombre || 'Admin' });
    showToast(tipo === 'reset' ? t('Día restablecido.') : t('Registro actualizado.'), 'ok');
    await load();
  } catch (e) {
    showToast(e.message || t('No se pudo actualizar.'), 'error');
  }
}

function stepMes(delta) {
  const d = new Date(_mes.y, _mes.m + delta, 1); // Date normaliza el desbordamiento de año
  _mes = { y: d.getFullYear(), m: d.getMonth() };
  load();
}

async function load() {
  const wrap = document.getElementById('asis-grid-wrap');
  if (!wrap) return;
  document.getElementById('mes-pick').value = `${_mes.y}-${String(_mes.m + 1).padStart(2, '0')}`;
  wrap.innerHTML = `<div class="ad-loading"><div class="ad-spinner"></div> ${t('Cargando asistencia…')}</div>`;

  try {
    const rango = rangoMes(_mes);
    const [empleados, turnos, turnosDia, registros, incidencias] = await Promise.all([
      api.getEmpleados(), api.getTurnos(), api.getTurnosDia(rango),
      api.getRegistrosRango(rango), api.getIncidenciasRango(rango),
    ]);
    const activos = filterByPlaza(empleados.filter(e => e.activo), e => e.plaza_id);
    if (!activos.length) { wrap.innerHTML = `<div class="ad-empty">${t('No hay empleados activos en esta plaza.')}</div>`; return; }

    _tablero = tableroMes(activos, registros, incidencias, turnosDia, turnos, rango);
    renderGrid(wrap);
    if (_sel == null || !_tablero.filas.some(f => f.empleado.id === _sel)) _sel = _tablero.filas[0].empleado.id;
    markSel();
    renderSpotlight();
    aplicarFiltro();
  } catch (e) {
    wrap.innerHTML = `<div class="ad-empty" style="color:#DC2626">${esc(e.message)}</div>`;
  }
}

function renderGrid(wrap) {
  const { dias, filas } = _tablero;
  const hoy = ymd(new Date());
  const head = `<tr>
    <th class="hm-emp hm-emp--h">${t('Empleado')}</th>
    ${dias.map(d => `<th class="hm-dh ${d.finde ? 'hm--finde' : ''} ${d.esHoy ? 'hm--hoy' : ''}">
      <span class="hm-dh__dow">${DOW_AB[d.dow]}</span><span class="hm-dh__num">${d.dia}</span>
    </th>`).join('')}
  </tr>`;

  const body = filas.map(f => {
    const e = f.empleado;
    const av = `<img class="hm-av" src="${esc(e.foto_url || DEFAULT_PFP)}" alt="">`;
    const celdas = f.celdas.map(c => {
      // 'previo' = día anterior al alta del empleado: no es editable (aún no
      // trabajaba). Se marca inválido y se le quita el menú de incidencias.
      const previo = c.estado === 'previo';
      const titulo = `${c.dia}: ${previo ? t('Antes del ingreso · no editable') : t(ESTADO_LBL[c.estado] || c.estado)}`;
      return `<td class="hm-cell hm--${c.cat}${previo ? ' hm-cell--previo' : ''} ${c.ymd === hoy ? 'hm-cell--hoy' : ''}"${previo ? ' data-previo="1" aria-disabled="true"' : ''} data-emp="${e.id}" data-ymd="${c.ymd}" title="${esc(titulo)}"></td>`;
    }).join('');
    return `<tr data-emp="${e.id}">
      <td class="hm-emp">
        ${av}
        <span class="hm-emp__txt"><span class="hm-emp__name">${esc(e.nombre)}</span>
        <span class="hm-emp__id">${esc(e.numero_empleado || '—')}</span></span>
      </td>
      ${celdas}
    </tr>`;
  }).join('');

  wrap.innerHTML = `<div class="heatmap-scroll"><table class="heatmap"><thead>${head}</thead><tbody>${body}</tbody></table></div>`;

  wrap.querySelectorAll('[data-emp]').forEach(el => {
    el.addEventListener('click', () => { _sel = parseInt(el.dataset.emp); markSel(); if (spotFijo()) renderSpotlight(); else toastResumen(); });
  });

  // Menú por celda: click derecho (escritorio) o mantener pulsado (móvil).
  // Los días previos al alta (:not([data-previo])) no reciben menú: no editables.
  wrap.querySelectorAll('.hm-cell[data-emp][data-ymd]:not([data-previo])').forEach(c => {
    c.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      showMenu(e.clientX, e.clientY, c.dataset.emp, c.dataset.ymd);
    });
    let lp = null;
    c.addEventListener('touchstart', (e) => {
      const tp = e.touches[0];
      lp = setTimeout(() => { lp = null; showMenu(tp.clientX, tp.clientY, c.dataset.emp, c.dataset.ymd); }, 500);
    }, { passive: true });
    const cancel = () => { if (lp) { clearTimeout(lp); lp = null; } };
    c.addEventListener('touchend', cancel);
    c.addEventListener('touchmove', cancel);
    c.addEventListener('touchcancel', cancel);
  });
}

function markSel() {
  document.querySelectorAll('.heatmap tr[data-emp]').forEach(tr =>
    tr.classList.toggle('hm-row--sel', parseInt(tr.dataset.emp) === _sel));
}

function renderSpotlight() {
  const aside = document.getElementById('asis-spotlight');
  if (!aside || !_tablero) return;
  const fila = _tablero.filas.find(f => f.empleado.id === _sel);
  if (!fila) { aside.innerHTML = ''; return; }
  const e = fila.empleado;
  const r = fila.resumen;

  // anillo de estado = categoría del último día con estado real (no futuro)
  const ultima = [...fila.celdas].reverse().find(c => c.cat !== 'futuro');
  const ring = ultima?.cat ?? 'futuro';
  const av = `<img class="spot-av hm--ring-${ring}" src="${esc(e.foto_url || DEFAULT_PFP)}" alt="">`;

  aside.innerHTML = `
    <div class="spot-head">
      ${av}
      <div class="spot-id">
        <strong>${esc(e.nombre)}</strong>
        <span>${esc(e.puesto || t('Sin puesto'))}</span>
        <span class="spot-mono">${esc(e.numero_empleado || '—')}</span>
      </div>
    </div>
    <div class="spot-stats">
      ${CATS.map(c => `<div class="spot-stat spot-stat--${c.cat}">
        <span class="spot-stat__n">${r[c.cat] ?? 0}</span><span class="spot-stat__l">${t(c.label)}</span>
      </div>`).join('')}
    </div>
    <button class="abtn abtn--primary spot-cta" id="spot-hist" type="button">${t('Ver historial completo')}</button>`;
  // Navega al panel de historial reusando el enlace del sidebar (no recargamos).
  aside.querySelector('#spot-hist')?.addEventListener('click', () =>
    document.querySelector('.sidebar__link[data-panel="historial"]')?.click());
  // ponytail: "Enviar notificación" / "Generar justificante" del diseño quedan
  // fuera — requieren backend (envío de avisos, generación de PDF) inexistente.
}

// ── Panel lateral: fijo (junto a la tabla) o bajo demanda (toast) ────────────
const spotFijo = () => localStorage.getItem('eqs_asis_spotlight_fijo') !== '0'; // default: fijo
function applySpot() {
  const board = document.querySelector('.asis-board');
  if (board) board.classList.toggle('asis-board--solo', !spotFijo());
  document.getElementById('btn-spotlight')?.classList.toggle('active', spotFijo());
}
function toastResumen() {
  const fila = _tablero?.filas.find(f => f.empleado.id === _sel);
  if (!fila) return;
  const r = fila.resumen;
  showToast(`${fila.empleado.nombre} — ${CATS.map(c => `${t(c.label)} ${r[c.cat] ?? 0}`).join(' · ')}`, 'ok');
}

// ── Exportar el tablero mensual a PDF (impresión nativa del navegador, sin libs) ─
// ponytail: abrimos una ventana imprimible y disparamos print(); el usuario guarda
// como PDF (no editable). Una lib de PDF (jsPDF) sería una dependencia nueva por gusto.
function exportarPDF() {
  if (!_tablero) return;
  const { dias, filas } = _tablero;
  const loc = getLang() === 'en' ? 'en-US' : 'es-MX';
  const titulo = `${t('Asistencia')} — ${new Date(_mes.y, _mes.m, 1).toLocaleString(loc, { month: 'long', year: 'numeric' })}`;
  const head = `<th class="emp">${t('Empleado')}</th><th>${t('Núm.')}</th>` +
    dias.map(d => `<th${d.finde ? ' class="we"' : ''}>${d.dia}<br><small>${DOW_AB[d.dow]}</small></th>`).join('');
  const body = filas.map(f =>
    `<tr><td class="emp">${esc(f.empleado.nombre)}</td><td>${esc(f.empleado.numero_empleado || '')}</td>` +
    f.celdas.map(c => {
      const m = PDF_CELL[c.estado];
      return m ? `<td style="background:${m.bg};color:${m.fg};font-weight:700">${m.ini}</td>` : '<td></td>';
    }).join('') + '</tr>').join('');
  // Leyenda de iniciales (solo las que aparecen en el tablero, en orden estable).
  const presentes = new Set(filas.flatMap(f => f.celdas.map(c => c.estado)));
  const leyenda = Object.keys(PDF_CELL).filter(e => presentes.has(e)).map(e => {
    const m = PDF_CELL[e];
    return `<span class="lg"><b style="background:${m.bg};color:${m.fg}">${m.ini}</b> ${esc(t(ESTADO_LBL[e] || e))}</span>`;
  }).join('');

  const w = window.open('', '_blank');
  if (!w) { showToast(t('Permite las ventanas emergentes para exportar.'), 'error'); return; }
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(titulo)}</title><style>
    *{-webkit-print-color-adjust:exact;print-color-adjust:exact}
    body{font:12px system-ui,-apple-system,sans-serif;margin:24px;color:#111}
    h1{font-size:16px;margin:0 0 8px}
    .leg{margin:0 0 12px;font-size:10px;display:flex;flex-wrap:wrap;gap:10px}
    .lg{display:inline-flex;align-items:center;gap:4px}
    .lg b{display:inline-block;min-width:16px;text-align:center;border-radius:3px;padding:1px 3px;font-size:9px}
    table{border-collapse:collapse;width:100%}
    th,td{border:1px solid #cbd5e1;padding:4px 6px;text-align:center}
    th{background:#f1f5f9;font-size:10px}
    td.emp,th.emp{text-align:left;white-space:nowrap}
    .we{background:#e2e8f0}
    @page{size:landscape;margin:12mm}
  </style></head><body><h1>${esc(titulo)}</h1>
    <div class="leg">${leyenda}</div>
    <table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>
    <scr` + `ipt>window.onload=function(){window.print()}</scr` + `ipt>
  </body></html>`);
  w.document.close();
}

// Leyenda como filtro: chips activos = categorías visibles; ninguno = todas.
function onLegend(ev) {
  const chip = ev.target.closest('.asis-leg');
  if (!chip) return;
  chip.setAttribute('aria-pressed', chip.getAttribute('aria-pressed') !== 'true');
  aplicarFiltro();
}

function aplicarFiltro() {
  const activos = new Set([...document.querySelectorAll('.asis-leg[aria-pressed="true"]')].map(c => c.dataset.cat));
  document.querySelectorAll('.heatmap .hm-cell').forEach(td => {
    const cat = td.className.match(/hm--(\w+)/)?.[1];
    td.classList.toggle('hm-cell--dim', activos.size > 0 && !activos.has(cat));
  });
}
