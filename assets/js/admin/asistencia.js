import * as api from './api.js';
import { esc } from './utils.js';
import { filterByPlaza } from './plaza-scope.js';
import { tableroMes } from './historial-calc.mjs';
import { t, getLang } from '../i18n.js';

let _refreshTimer = null;
let _mes = null;        // { y, m } mes en foco
let _tablero = null;    // último tablero calculado (para el spotlight)
let _sel = null;        // id del empleado seleccionado

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
      <button class="abtn abtn--ghost" id="btn-refrescar">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
        ${t('Actualizar')}
      </button>
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
  document.getElementById('mes-prev').addEventListener('click', () => stepMes(-1));
  document.getElementById('mes-next').addEventListener('click', () => stepMes(1));
  document.getElementById('asis-legend').addEventListener('click', onLegend);

  await load();
  _refreshTimer = setInterval(load, 60_000);
}

export function destroy() { clearInterval(_refreshTimer); }

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
