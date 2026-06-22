import * as api from './api.js';
import { esc, showToast } from './utils.js';
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

// Opciones del menú contextual → tipo de incidencia.
const MENU = [
  ['asistencia', 'Asistencia'],
  ['falta',      'Falta'],
  ['permiso',    'Permiso'],
  ['festivo',    'Festivo'],
  ['vacaciones', 'Vacaciones'],
];

const DOW_AB = ['D','L','M','M','J','V','S'];
const CATS = [
  { cat: 'presente', label: 'Asistencia' },
  { cat: 'retardo',  label: 'Retardo' },
  { cat: 'falta',    label: 'Falta' },
  { cat: 'permiso',  label: 'Permiso' },
  { cat: 'descanso', label: 'Descanso' },
];
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
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
        <button class="abtn abtn--ghost" id="btn-exportar">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          ${t('Exportar CSV')}
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
        <h3 class="asis-nav__title" id="mes-titulo">—</h3>
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
  document.getElementById('btn-exportar').addEventListener('click', exportarCSV);
  document.getElementById('mes-prev').addEventListener('click', () => stepMes(-1));
  document.getElementById('mes-next').addEventListener('click', () => stepMes(1));
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

function showMenu(x, y, emp, ymd) {
  _menuTarget = { emp: parseInt(emp), ymd };
  _menu.hidden = false; // mostrar para medir tamaño
  const w = _menu.offsetWidth, h = _menu.offsetHeight;
  _menu.style.left = Math.min(x, window.innerWidth - w - 8) + 'px';
  _menu.style.top  = Math.min(y, window.innerHeight - h - 8) + 'px';
}
function hideMenu() { if (_menu) _menu.hidden = true; }
function onDocClick(e) { if (_menu && !_menu.hidden && !_menu.contains(e.target)) hideMenu(); }
function onEsc(e) { if (e.key === 'Escape') hideMenu(); }

async function setIncidencia(empId, fecha, tipo) {
  try {
    const prev = await api.getIncidencias(empId, { desde: fecha, hasta: fecha });
    for (const i of prev) await api.deleteIncidencia(i.id);
    await api.createIncidencia({ id_empleado: empId, fecha, tipo, autor_nombre: getAdminSession()?.nombre || 'Admin' });
    showToast(t('Registro actualizado.'), 'ok');
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
  const loc = getLang() === 'en' ? 'en-US' : 'es-MX';
  const mesNombre = new Date(_mes.y, _mes.m, 1).toLocaleString(loc, { month: 'long' });
  document.getElementById('mes-titulo').textContent = `${mesNombre.charAt(0).toUpperCase() + mesNombre.slice(1)} ${_mes.y}`;
  wrap.innerHTML = `<div class="ad-loading"><div class="ad-spinner"></div> ${t('Cargando asistencia…')}</div>`;

  try {
    const rango = rangoMes(_mes);
    const [empleados, horarios, turnos, registros, incidencias] = await Promise.all([
      api.getEmpleados(), api.getHorarios(), api.getTurnos(),
      api.getRegistrosRango(rango), api.getIncidenciasRango(rango),
    ]);
    const activos = filterByPlaza(empleados.filter(e => e.activo), e => e.plaza_id);
    if (!activos.length) { wrap.innerHTML = `<div class="ad-empty">${t('No hay empleados activos en esta plaza.')}</div>`; return; }

    _tablero = tableroMes(activos, registros, incidencias, horarios, turnos, rango);
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
    const av = e.foto_url
      ? `<img class="hm-av" src="${esc(e.foto_url)}" alt="">`
      : `<span class="hm-av hm-av--ph">${esc(iniciales(e.nombre))}</span>`;
    const celdas = f.celdas.map(c =>
      `<td class="hm-cell hm--${c.cat} ${c.ymd === hoy ? 'hm-cell--hoy' : ''}" data-emp="${e.id}" data-ymd="${c.ymd}" title="${c.dia}: ${esc(c.estado)}"></td>`
    ).join('');
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
    el.addEventListener('click', () => { _sel = parseInt(el.dataset.emp); markSel(); renderSpotlight(); });
  });

  // Menú por celda: click derecho (escritorio) o mantener pulsado (móvil).
  wrap.querySelectorAll('.hm-cell[data-emp][data-ymd]').forEach(c => {
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
  const av = e.foto_url
    ? `<img class="spot-av hm--ring-${ring}" src="${esc(e.foto_url)}" alt="">`
    : `<span class="spot-av spot-av--ph hm--ring-${ring}">${esc(iniciales(e.nombre))}</span>`;

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

// ── Exportar el tablero mensual a CSV (Excel-friendly, sin libs) ─────────────
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
