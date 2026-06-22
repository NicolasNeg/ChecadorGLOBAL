import * as api from './api.js';
import { esRetardo, resumen, agruparPorDia, notasPorDia, estadoDia } from './historial-calc.mjs';
import { openModal, closeModal, showToast, confirm, loading, esc } from './utils.js';
import { combobox } from './combobox.js';
import { getPlazaScope } from './plaza-scope.js';
import { getAdminSession } from './auth.js';
import { SUPABASE_URL } from '../config.js';
import { t, getLang } from '../i18n.js';

const TIPOS = ['falta', 'permiso', 'justificacion', 'vacaciones', 'festivo'];

const ESTADO = {
  presente:      { txt: 'Presente',          cls: 'green'  },
  asistencia:    { txt: 'Asistencia',        cls: 'green'  },
  falta:         { txt: 'Falta',             cls: 'red'    },
  justificacion: { txt: 'Justificada',       cls: 'orange' },
  permiso:       { txt: 'Permiso',           cls: 'blue'   },
  vacaciones:    { txt: 'Vacaciones',        cls: 'blue'   },
  festivo:       { txt: 'Festivo',           cls: 'gray'   },
  futuro:        { txt: '',                  cls: 'gray'   },
};

const DOW = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const LOC = () => (getLang() === 'en' ? 'en-US' : 'es-MX');
const horaCorta = (iso) => new Date(iso).toLocaleTimeString(LOC(), { hour: '2-digit', minute: '2-digit' });
const diaCorto  = (ymd) => new Date(ymd + 'T12:00:00').toLocaleDateString(LOC(), { day: '2-digit', month: 'short' });
const diaLargo  = (ymd) => { const s = new Date(ymd + 'T12:00:00').toLocaleDateString(LOC(), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }); return s.charAt(0).toUpperCase() + s.slice(1); };
const publicURL = (ruta) => ruta ? `${SUPABASE_URL}/storage/v1/object/public/${ruta}` : null;
const hoyISO = () => new Date().toISOString().slice(0, 10);
const haceDiasISO = (n) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
const initials = (n) => (n || '').trim().split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
const ymdLocal = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const firstOfMonth = (d) => new Date(d.getFullYear(), d.getMonth(), 1);
const horasDe = (d) => (d?.entrada && d?.salida) ? Math.round((new Date(d.salida.hora) - new Date(d.entrada.hora)) / 360000) / 10 : null;
const DEFECTO = () => `<div class="ad-empty">${t('Selecciona un empleado y pulsa “Ver historial”.')}</div>`;

// Config: KPIs fijos (inline) vs. bajo demanda (toast). La escribe Ajustes.
const kpisFijos = () => localStorage.getItem('eqs_admin_kpis_fijos') === '1';
const autorActual = () => getAdminSession()?.nombre || 'Admin';

let _preId = null;
export function preseleccionar(id) { _preId = id; }

let _empleados = [];
let _cbPlaza, _cbPuesto, _cbEmp;
let _ctx = null;   // { panel, idEmpleado, rango, emp, turno, registros, incidencias, desde, hasta, mapDia, notasMap }
let _mes = null;   // Date: primer día del mes mostrado

export async function init(panel) {
  panel.classList.add('admin-panel--full'); // historial ocupa todo el ancho en PC
  const [empleados, plazas] = await Promise.all([
    api.getEmpleados().catch(() => []),
    api.getPlazas().catch(() => []),
  ]);
  _empleados = empleados;

  panel.innerHTML = `
    <div class="hist-head">
      <div class="hist-head__icon">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
      </div>
      <div>
        <h2 class="hist-head__title">${t('Historial por empleado')}</h2>
        <p class="hist-head__sub">${t('Asistencia y notas en calendario, por persona y rango de fechas.')}</p>
      </div>
    </div>

    <details class="ad-card hist-filtros" id="hf-wrap" open>
      <summary class="hist-filtros__summary">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>
        <span>${t('Filtros')}</span>
        <svg class="hist-filtros__chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
      </summary>
      <div class="hist-filtros__grid">
        <div class="ff"><label>${t('Plaza')}</label><div id="hf-plaza"></div></div>
        <div class="ff"><label>${t('Puesto')}</label><div id="hf-puesto"></div></div>
        <div class="ff ff--emp"><label>${t('Empleado')} <span class="ff__req">*</span></label><div id="hf-emp"></div></div>
        <div class="ff">
          <label>${t('Fecha inicio')}</label>
          <div class="ff__date">
            <input id="hf-desde" type="date" class="form-input" value="${haceDiasISO(30)}" max="${hoyISO()}" aria-label="${t('Fecha inicio')}">
            <button type="button" class="abtn abtn--ghost ff__hoy" id="hf-semana" title="${t('Últimos 7 días')}">${t('Semana')}</button>
          </div>
        </div>
        <div class="ff"><label>${t('Fecha final')}</label><input id="hf-hasta" type="date" class="form-input" value="${hoyISO()}" max="${hoyISO()}" aria-label="${t('Fecha final')}"></div>
      </div>
      <div class="hist-filtros__acts">
        <button class="abtn abtn--ghost" id="hf-reset">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.5 15a9 9 0 1 0 2.1-9.4L1 10"/></svg>
          ${t('Resetear')}
        </button>
        <button class="abtn abtn--primary" id="hf-ver">${t('Ver historial')}</button>
      </div>
    </details>

    <div id="hist-resultado">${DEFECTO()}</div>`;

  // ── Comboboxes ──────────────────────────────────────────────────────────
  const plazaOpts = [{ value: '', label: t('Seleccionar (todas)') }, ...plazas.map(p => ({ value: p.id, label: p.nombre }))];
  _cbPlaza = combobox({ placeholder: t('Todas las plazas'), options: plazaOpts, value: getPlazaScope() ?? '', onChange: rebuildEmp });
  _cbPuesto = combobox({ placeholder: t('Todos'), options: puestoOpts(), value: '', searchable: false, onChange: rebuildEmp });
  _cbEmp   = combobox({ placeholder: t('Selecciona empleado…'), options: empOpts(), value: '' });
  panel.querySelector('#hf-plaza').appendChild(_cbPlaza.el);
  panel.querySelector('#hf-puesto').appendChild(_cbPuesto.el);
  panel.querySelector('#hf-emp').appendChild(_cbEmp.el);

  // Puestos distintos presentes en la lista de empleados (filtro dinámico).
  function puestoOpts() {
    const set = [...new Set(_empleados.map(e => e.puesto).filter(Boolean))].sort();
    return [{ value: '', label: t('Seleccionar (todos)') }, ...set.map(p => ({ value: p, label: p }))];
  }
  function empOpts() {
    const plaza  = parseInt(_cbPlaza?.getValue?.() ?? '') || null;
    const puesto = _cbPuesto?.getValue?.() ?? '';
    return _empleados
      .filter(e => (!plaza || e.plaza_id === plaza) && (!puesto || e.puesto === puesto))
      .map(e => ({
        value: e.id, label: e.nombre,
        img: e.foto_url || null, ph: e.foto_url ? null : initials(e.nombre),
        sub: e.puesto || e.plazas?.nombre || '',
      }));
  }
  function rebuildEmp() { _cbEmp.setOptions(empOpts()); }

  // ── Atajos ──────────────────────────────────────────────────────────────
  // "Semana": rango = hoy y los 7 días previos.
  panel.querySelector('#hf-semana').onclick = () => {
    panel.querySelector('#hf-desde').value = haceDiasISO(7);
    panel.querySelector('#hf-hasta').value = hoyISO();
  };
  panel.querySelector('#hf-reset').onclick = () => {
    _cbPlaza.setValue(getPlazaScope() ?? '');
    _cbPuesto.setValue('');
    rebuildEmp();
    _cbEmp.setValue('');
    panel.querySelector('#hf-desde').value = haceDiasISO(30);
    panel.querySelector('#hf-hasta').value = hoyISO();
    panel.querySelector('#hf-wrap').open = true;
    panel.querySelector('#hist-resultado').innerHTML = DEFECTO();
  };
  panel.querySelector('#hf-ver').onclick = () => {
    const id = parseInt(_cbEmp.getValue());
    if (!id) { showToast('Selecciona un empleado.', 'error'); return; }
    mostrar(panel, id, rangoDe(panel));
  };

  if (_preId) {
    _cbEmp.setValue(String(_preId));
    mostrar(panel, _preId, rangoDe(panel));
    _preId = null;
  }
}

function rangoDe(panel) {
  const hoy = hoyISO();
  // El max del input bloquea el picker; el clamp cubre fechas tecleadas a mano.
  const cap = (v) => (v && v <= hoy ? v : hoy);
  return {
    desde: cap(panel.querySelector('#hf-desde').value || haceDiasISO(30)),
    hasta: cap(panel.querySelector('#hf-hasta').value || hoy),
  };
}

export async function mostrar(panel, idEmpleado, rango) {
  _ctx = { panel, idEmpleado, rango };
  if (!await cargar()) return;
  _mes = firstOfMonth(new Date(_ctx.hasta + 'T12:00:00'));
  clampMes();
  pintar();
  const wrap = panel.querySelector('#hf-wrap'); // colapsa los filtros para ver más
  if (wrap) wrap.open = false;
}

// Refetch + re-render conservando el mes actual; reabre un día si se pide.
async function recargar(reopenYmd) {
  if (!await cargar()) return;
  clampMes();
  pintar();
  if (reopenYmd) abrirDia(reopenYmd);
}

async function cargar() {
  const { panel, idEmpleado, rango } = _ctx;
  const wrap = panel.querySelector('#hist-resultado');
  if (!wrap) return false;
  loading(wrap);
  try {
    const [emp, registros, incidencias] = await Promise.all([
      api.getEmpleado(idEmpleado),
      api.getRegistrosEmpleado(idEmpleado, rango),
      api.getIncidencias(idEmpleado, rango),
    ]);
    // Regla 1: nunca antes de la fecha de alta del empleado.
    const desdeEf = (emp?.fecha_ingreso && emp.fecha_ingreso > rango.desde) ? emp.fecha_ingreso : rango.desde;
    _ctx.emp = emp;
    _ctx.turno = emp?.turnos ?? null;
    _ctx.registros = registros;
    _ctx.incidencias = incidencias;
    _ctx.desde = desdeEf;
    _ctx.hasta = rango.hasta;
    _ctx.mapDia = agruparPorDia(registros);
    _ctx.notasMap = notasPorDia(incidencias);
    return true;
  } catch (e) {
    wrap.innerHTML = `<div class="ad-empty" style="color:#DC2626">${esc(e.message)}</div>`;
    return false;
  }
}

// ── Límites del navegador de meses ──────────────────────────────────────────
function clampMes() {
  const min = firstOfMonth(new Date(_ctx.desde + 'T12:00:00'));
  const max = firstOfMonth(new Date(_ctx.hasta + 'T12:00:00'));
  if (_mes < min) _mes = min;
  if (_mes > max) _mes = max;
}

// ── KPIs ─────────────────────────────────────────────────────────────────
const KPI_ICO = {
  checadas: '<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
  retardos: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  horas:    '<path d="M5 22h14M5 2h14M17 22v-4.2a2 2 0 0 0-.6-1.4L12 12 7.6 16.4a2 2 0 0 0-.6 1.4V22M7 2v4.2a2 2 0 0 0 .6 1.4L12 12l4.4-4.4a2 2 0 0 0 .6-1.4V2"/>',
  notas:    '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>',
};
const kpiCard = (variant, ico, label, value) =>
  `<div class="stat-card stat-card--${variant}">
    <div class="stat-card__icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${KPI_ICO[ico]}</svg></div>
    <div class="stat-card__body"><div class="stat-card__label">${label}</div><div class="stat-card__value">${value}</div></div>
  </div>`;

function statsCardsHTML() {
  const r = resumen(_ctx.registros, _ctx.turno, _ctx.incidencias);
  const sinTurno = !_ctx.turno;
  return `
    <div class="stat-grid hist-stats">
      ${kpiCard('blue',   'checadas', t('Checadas'),         r.totalChecadas)}
      ${kpiCard('red',    'retardos', t('Retardos'),         sinTurno ? '–' : r.retardos)}
      ${kpiCard('green',  'horas',    t('Horas trabajadas'), r.horasTotales)}
      ${kpiCard('orange', 'notas',    t('Notas'),            r.incidencias)}
    </div>`;
}

function showStatsPop() {
  document.getElementById('hist-statspop')?.remove();
  const pop = document.createElement('div');
  pop.id = 'hist-statspop';
  pop.className = 'hist-statspop';
  pop.innerHTML = `
    <div class="hist-statspop__card">
      <div class="hist-statspop__head"><span>${t('Estadísticas del rango')}</span>
        <button class="hist-statspop__x" aria-label="${t('Cerrar')}">✕</button>
      </div>
      ${statsCardsHTML()}
    </div>`;
  const cerrar = () => { pop.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') cerrar(); };
  pop.addEventListener('click', (e) => { if (e.target === pop || e.target.closest('.hist-statspop__x')) cerrar(); });
  document.addEventListener('keydown', onKey);
  document.body.appendChild(pop);
}

// ── Render principal ─────────────────────────────────────────────────────
function pintar() {
  const { panel, emp } = _ctx;
  const wrap = panel.querySelector('#hist-resultado');
  if (!wrap) return;

  const foto = emp?.foto_url
    ? `<img class="hist-subj__av" src="${esc(emp.foto_url)}" alt="">`
    : `<span class="hist-subj__av hist-subj__av--ph">${initials(emp?.nombre)}</span>`;
  const meta = [emp?.puesto, emp?.plazas?.nombre].filter(Boolean).join(' · ');
  const subject = `
    <div class="hist-subj">
      ${foto}
      <div class="hist-subj__info">
        <h3 class="hist-subj__name">${esc(emp?.nombre ?? t('Empleado'))}</h3>
        ${meta ? `<span class="hist-subj__meta">${esc(meta)}</span>` : ''}
      </div>
      <span class="hist-subj__range">${diaCorto(_ctx.desde)} – ${diaCorto(_ctx.hasta)}</span>
      <button id="hist-stats-btn" class="abtn abtn--ghost abtn--icon" title="${t('Estadísticas')}" aria-label="${t('Ver estadísticas')}">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
      </button>
      <button id="hist-nueva-nota" class="abtn abtn--primary">+ ${t('Nota')}</button>
    </div>`;

  const avisoTurno = !_ctx.turno
    ? `<p class="td-muted" style="margin:0 0 12px">${t('Sin turno asignado — no se evalúan retardos.')}</p>` : '';

  wrap.innerHTML = `
    ${subject}
    ${kpisFijos() ? statsCardsHTML() : ''}
    ${avisoTurno}
    <div class="ad-card cal-month" id="hist-cal">${mesHTML()}</div>`;

  wrap.querySelector('#hist-stats-btn').onclick = showStatsPop;
  wrap.querySelector('#hist-nueva-nota').onclick = () => formNota(hoyISO());
  wireCal(wrap);
}

function wireCal(wrap) {
  const cal = wrap.querySelector('#hist-cal');
  cal.querySelector('#cal-prev')?.addEventListener('click', () => { _mes = new Date(_mes.getFullYear(), _mes.getMonth() - 1, 1); clampMes(); cal.innerHTML = mesHTML(); wireCal(wrap); });
  cal.querySelector('#cal-next')?.addEventListener('click', () => { _mes = new Date(_mes.getFullYear(), _mes.getMonth() + 1, 1); clampMes(); cal.innerHTML = mesHTML(); wireCal(wrap); });
  // Solo lectura: faltas/asistencias se editan desde la sección Asistencia.
  cal.querySelectorAll('[data-day]').forEach((c) => {
    c.addEventListener('click', () => abrirDia(c.dataset.day));
  });
}

// ── Cuadrícula mensual (estilo Google Calendar) ─────────────────────────────
function mesHTML() {
  const y = _mes.getFullYear(), m = _mes.getMonth();
  const desde = _ctx.desde, hasta = _ctx.hasta, hoyKey = hoyISO();
  const min = firstOfMonth(new Date(desde + 'T12:00:00'));
  const max = firstOfMonth(new Date(hasta + 'T12:00:00'));
  const titulo = _mes.toLocaleDateString(LOC(), { month: 'long', year: 'numeric' });

  const startDow = new Date(y, m, 1).getDay();
  const nDias = new Date(y, m + 1, 0).getDate();
  let celdas = '';
  for (let i = 0; i < startDow; i++) celdas += '<div class="cal-cell cal-cell--blank"></div>';
  for (let d = 1; d <= nDias; d++) {
    const key = ymdLocal(new Date(y, m, d));
    if (key < desde || key > hasta) { celdas += `<div class="cal-cell cal-cell--out"><span class="cal-cell__num">${d}</span></div>`; continue; }
    const reg = _ctx.mapDia.get(key) ?? {};
    const notas = _ctx.notasMap.get(key) ?? [];
    const estado = estadoDia({ entrada: reg.entrada, salida: reg.salida, notas }, key, hoyKey);
    const tarde = reg.entrada && esRetardo(reg.entrada, _ctx.turno);
    const horas = horasDe(reg);
    const e = ESTADO[estado] ?? ESTADO.falta;
    const esInicio = key === _ctx.emp?.fecha_ingreso;
    const marks =
      (esInicio ? `<span class="cal-cell__tag cal-cell__tag--inicio">⭐ ${t('DÍA DE INICIO')}</span>` : '') +
      (estado === 'presente'
        ? `<span class="cal-cell__tag cal-cell__tag--green">${horas != null ? horas + ' h' : t('Presente')}</span>`
        : (estado !== 'futuro' ? `<span class="cal-cell__tag cal-cell__tag--${e.cls}">${t(e.txt)}</span>` : '')) +
      (tarde ? `<span class="cal-cell__tag cal-cell__tag--red">${t('Retardo')}</span>` : '') +
      (notas.length ? `<span class="cal-cell__notas">📝 ${notas.length}</span>` : '');
    celdas += `<div class="cal-cell cal-cell--${estado}${key === hoyKey ? ' cal-cell--hoy' : ''}${esInicio ? ' cal-cell--inicio' : ''}" data-day="${key}" role="button" tabindex="0" title="${t('Abrir día')}">
      <span class="cal-cell__num">${d}</span>
      <div class="cal-cell__marks">${marks}</div>
    </div>`;
  }

  return `
    <div class="cal-month__head">
      <button class="abtn abtn--ghost abtn--icon" id="cal-prev" ${_mes <= min ? 'disabled' : ''} aria-label="${t('Mes anterior')}">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
      </button>
      <h4 class="cal-month__title">${titulo.charAt(0).toUpperCase() + titulo.slice(1)}</h4>
      <button class="abtn abtn--ghost abtn--icon" id="cal-next" ${_mes >= max ? 'disabled' : ''} aria-label="${t('Mes siguiente')}">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
      </button>
    </div>
    <div class="cal-grid">
      ${DOW.map((d) => `<div class="cal-dow">${t(d)}</div>`).join('')}
      ${celdas}
    </div>`;
}

// ── Detalle de un día (asistencia + notas) ──────────────────────────────────
function abrirDia(key) {
  document.getElementById('hist-day')?.remove();
  const reg = _ctx.mapDia.get(key) ?? {};
  const notas = _ctx.notasMap.get(key) ?? [];

  const thumbs = (r) => {
    if (!r) return '';
    const f = publicURL(r.ruta_foto), s = publicURL(r.ruta_firma);
    return `${f ? `<img src="${f}" class="hist-thumb" data-full="${f}" alt="${t('Foto')}">` : ''}${s ? `<img src="${s}" class="hist-thumb hist-thumb--firma" data-full="${s}" alt="${t('Firma')}">` : ''}`;
  };
  const punto = (r, lbl) => r
    ? `<div class="cordon__pt"><span class="cordon__dot cordon__dot--${lbl === 'Entrada' ? 'in' : 'out'}"></span><span class="cordon__t">${horaCorta(r.hora)}</span><span class="cordon__lbl">${t(lbl)}${r.geocerca_valida === false ? ` <span class="abadge abadge--red">${t('Fuera')}</span>` : ''}</span></div>`
    : `<div class="cordon__pt cordon__pt--miss"><span class="cordon__dot cordon__dot--miss"></span><span class="cordon__lbl">${t(lbl === 'Entrada' ? 'Sin entrada' : 'Sin salida')}</span></div>`;
  const horas = horasDe(reg);
  const tarde = reg.entrada && esRetardo(reg.entrada, _ctx.turno);
  const asistencia = (reg.entrada || reg.salida)
    ? `<div class="cordon">
        ${punto(reg.entrada, 'Entrada')}${tarde ? `<span class="abadge abadge--red">${t('Retardo')}</span>` : ''}
        <div class="cordon__line">${horas != null ? `<span class="cordon__dur">${horas} h</span>` : ''}</div>
        ${punto(reg.salida, 'Salida')}
      </div>
      <div class="hist-fotos">
        ${reg.entrada && thumbs(reg.entrada) ? `<div class="hist-fotos__grupo"><span class="hist-fotos__lbl hist-fotos__lbl--in">${t('Entrada')}</span><div class="cal-thumbs">${thumbs(reg.entrada)}</div></div>` : ''}
        ${reg.salida && thumbs(reg.salida) ? `<div class="hist-fotos__grupo"><span class="hist-fotos__lbl hist-fotos__lbl--out">${t('Salida')}</span><div class="cal-thumbs">${thumbs(reg.salida)}</div></div>` : ''}
      </div>`
    : `<p class="td-muted" style="margin:0">${t('Sin checadas este día.')}</p>`;

  const notasHTML = notas.length ? notas.map((n) => {
    const e = ESTADO[n.tipo] ?? ESTADO.falta;
    const edit = n.actualizado_en ? `${t('Editada por')} ${esc(n.editor_nombre || '—')} · ${new Date(n.actualizado_en).toLocaleDateString(LOC())}` : `${t('Por')} ${esc(n.autor_nombre || '—')}`;
    return `<div class="nota-item">
      <div class="nota-item__top">
        <span class="abadge abadge--${e.cls}">${esc(t(n.tipo))}</span>
        <div class="nota-item__acts">
          <button class="abtn abtn--ghost abtn--icon" title="${t('Editar')}" data-edit-nota="${n.id}"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/></svg></button>
          <button class="abtn abtn--danger abtn--icon" title="${t('Eliminar')}" data-del-nota="${n.id}"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/></svg></button>
        </div>
      </div>
      ${n.nota ? `<p class="nota-item__txt">${esc(n.nota)}</p>` : ''}
      ${n.imagen_url ? `<img src="${esc(n.imagen_url)}" class="hist-thumb nota-item__img" data-full="${esc(n.imagen_url)}" alt="${t('Adjunto')}">` : ''}
      <span class="nota-item__meta">${edit}</span>
    </div>`;
  }).join('') : `<p class="td-muted" style="margin:0">${t('Sin notas este día.')}</p>`;

  const ov = document.createElement('div');
  ov.id = 'hist-day';
  ov.className = 'ad-modal hist-day';
  ov.innerHTML = `
    <div class="ad-modal__card hist-day__card">
      <div class="ad-modal__header">
        <h3 style="margin:0;font-size:1rem">${diaLargo(key)}</h3>
        <button class="ad-modal__close" data-close aria-label="${t('Cerrar')}">✕</button>
      </div>
      <div class="ad-modal__body hist-day__body">
        <h4 class="hist-day__sec">${t('Asistencia')}</h4>
        ${asistencia}
        <div class="hist-day__notas-head">
          <h4 class="hist-day__sec" style="margin:0">${t('Notas')}</h4>
          <button class="abtn abtn--primary abtn--sm" data-add-nota>+ ${t('Nota')}</button>
        </div>
        ${notasHTML}
      </div>
      <div id="hist-lightbox" class="hist-lightbox" hidden><img alt="${t('Vista ampliada')}"></div>
    </div>`;

  const cerrar = () => { ov.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') cerrar(); };
  ov.addEventListener('click', (e) => {
    if (e.target === ov || e.target.closest('[data-close]')) { cerrar(); return; }
    const thumb = e.target.closest('.hist-thumb');
    if (thumb) { const lb = ov.querySelector('#hist-lightbox'); lb.querySelector('img').src = thumb.dataset.full; lb.hidden = false; return; }
    const lb = e.target.closest('#hist-lightbox');
    if (lb) { lb.hidden = true; lb.querySelector('img').src = ''; return; }
  });
  document.addEventListener('keydown', onKey);
  document.body.appendChild(ov);

  ov.querySelector('[data-add-nota]').onclick = () => formNota(key);
  ov.querySelectorAll('[data-edit-nota]').forEach((b) =>
    b.onclick = () => formNota(key, notas.find((n) => n.id === parseInt(b.dataset.editNota))));
  ov.querySelectorAll('[data-del-nota]').forEach((b) =>
    b.onclick = async () => {
      if (!await confirm('¿Eliminar esta nota?', { ok: 'Eliminar' })) return;
      try {
        await api.deleteIncidencia(parseInt(b.dataset.delNota));
        showToast('Nota eliminada.', 'ok');
        cerrar();
        recargar(key);
      } catch (e) { showToast(e.message, 'error'); }
    });
}

// ── Crear / editar nota ─────────────────────────────────────────────────────
function formNota(fecha, existing = null) {
  const tipoOpts = TIPOS.map((tp) => `<option value="${tp}" ${existing?.tipo === tp ? 'selected' : ''}>${t(tp)}</option>`).join('');
  openModal(existing ? 'Editar nota' : 'Nueva nota',
    `<div class="form-group">
      <label for="nota-fecha">${t('Fecha')} *</label>
      <input id="nota-fecha" class="form-input" type="date" value="${existing?.fecha ?? fecha}">
    </div>
    <div class="form-group">
      <label for="nota-tipo">${t('Tipo')} *</label>
      <select id="nota-tipo" class="form-input">${tipoOpts}</select>
    </div>
    <div class="form-group">
      <label for="nota-texto">${t('Nota')}</label>
      <textarea id="nota-texto" class="form-input" rows="3" placeholder="${t('Detalle (opcional)')}">${esc(existing?.nota ?? '')}</textarea>
    </div>
    <div class="form-group">
      <label for="nota-img">${t('Imagen adjunta')}</label>
      <input id="nota-img" class="form-input" type="file" accept="image/*">
      ${existing?.imagen_url ? `<img src="${esc(existing.imagen_url)}" class="hist-thumb" style="margin-top:8px" alt="${t('Actual')}">` : ''}
    </div>
    <p id="nota-error" class="error-inline" hidden></p>`,
    async () => {
      const f = document.getElementById('nota-fecha').value;
      const tipo = document.getElementById('nota-tipo').value;
      const nota = document.getElementById('nota-texto').value.trim() || null;
      const file = document.getElementById('nota-img').files[0];
      const errEl = document.getElementById('nota-error');
      if (!f || !tipo) { errEl.textContent = t('Fecha y tipo son obligatorios.'); errEl.hidden = false; return; }
      const saveBtn = document.getElementById('modal-save');
      saveBtn.disabled = true;
      try {
        let imagen_url = existing?.imagen_url ?? null;
        if (file) imagen_url = await api.subirImagenNota(file);
        if (existing) {
          await api.updateIncidencia(existing.id, {
            fecha: f, tipo, nota, imagen_url,
            editor_nombre: autorActual(), actualizado_en: new Date().toISOString(),
          });
        } else {
          await api.createIncidencia({ id_empleado: _ctx.idEmpleado, fecha: f, tipo, nota, imagen_url, autor_nombre: autorActual() });
        }
        closeModal();
        document.getElementById('hist-day')?.remove();
        showToast(existing ? 'Nota actualizada.' : 'Nota registrada.', 'ok');
        recargar(f);
      } catch (e) { errEl.textContent = e.message; errEl.hidden = false; saveBtn.disabled = false; }
    },
    'Guardar'
  );
}
