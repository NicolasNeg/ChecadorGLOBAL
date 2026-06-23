import * as api from './api.js';
import { loading, showToast, openModal, closeModal, fmtHora, confirm, esc } from './utils.js';
import { getPlazaScope, filterByPlaza } from './plaza-scope.js';
import { t as tr } from '../i18n.js'; // alias: 't' ya se usa para objetos turno en este módulo

let _plazas = [];
const DIAS = ['', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

// ── Helpers de semana (lunes–domingo, sin libs de fechas) ──────────────────
const lunesDe = (d) => { const x = new Date(d); const dow = (x.getDay() + 6) % 7; x.setDate(x.getDate() - dow); x.setHours(0, 0, 0, 0); return x; };
const ymd     = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDias = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const minutos = (t) => { const [h, m] = (t || '0:0').split(':'); return (+h) * 60 + (+m); };
const horasTurno = (t) => t ? Math.max(0, minutos(t.hora_salida) - minutos(t.hora_entrada) - (t.pausa_min || 0)) : 0;
let _semana = lunesDe(new Date()); // lunes de la semana visible
let _gridActivos = [];             // empleados activos de la plaza en foco (para copiar semana)
let _gridPDF = null;               // datos de la cuadrícula visible para exportar a PDF

export async function init(panel) {
  _plazas = await api.getPlazas().catch(() => []);

  panel.innerHTML = `
    <div class="panel-header">
      <h2>${tr('Turnos')}</h2>
      <div class="panel-header__actions">
        <button class="abtn abtn--primary" id="btn-nuevo-turno" data-rh-only>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          ${tr('Nuevo Turno')}
        </button>
      </div>
    </div>
    <div id="tbl-turnos-wrap"></div>

    <div class="panel-header" style="margin-top:28px">
      <h2>${tr('Distribución de turnos')}</h2>
      <div class="panel-header__actions">
        <button class="abtn abtn--ghost" id="btn-pdf-turnos">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          ${tr('Generar PDF')}
        </button>
      </div>
    </div>
    <p class="td-muted" style="font-size:.85rem;margin:-6px 0 12px">${tr('Asigna el turno de cada empleado por fecha. Las semanas pasadas son solo lectura.')}</p>
    <div class="ad-card"><div id="grid-horarios-wrap"></div></div>`;

  document.getElementById('btn-nuevo-turno')?.addEventListener('click', () => openTurnoForm());
  document.getElementById('btn-pdf-turnos')?.addEventListener('click', pdfTurnos);
  await loadTurnos();
  await loadGrid();
}

// ── Color estable por turno (mismo en tarjetas y en la cuadrícula) ─────────
const COLORS = ['c-blue', 'c-emerald', 'c-teal', 'c-amber', 'c-violet'];
const turnoColor = (t) => COLORS[((t?.id ?? 0) % COLORS.length + COLORS.length) % COLORS.length];

async function loadGrid() {
  const wrap = document.getElementById('grid-horarios-wrap');
  loading(wrap);
  try {
    const fechas = [0, 1, 2, 3, 4, 5, 6].map(i => addDias(_semana, i));
    const desde = ymd(_semana), hasta = ymd(fechas[6]);
    const [empleados, allTurnos, dias] = await Promise.all([
      api.getEmpleados(), api.getTurnos(), api.getTurnosDia({ desde, hasta })
    ]);
    // Solo turnos de la plaza en foco: no asignar un turno de otra plaza.
    const turnos  = filterByPlaza(allTurnos, t => t.plaza_id);
    const activos = filterByPlaza(empleados.filter(e => e.activo), e => e.plaza_id);
    _gridActivos = activos;
    const turnoDe = new Map(turnos.map(t => [t.id, t]));
    const asignado = new Map(dias.map(d => [`${d.id_empleado}-${d.fecha}`, d.turno_id]));

    const readonly = ymd(_semana) < ymd(lunesDe(new Date())); // semana ya pasada → inmutable
    const fechaLabel = (d) => d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' });
    const rango = `${fechaLabel(_semana)} – ${fechaLabel(fechas[6])} ${fechas[6].getFullYear()}`;
    // Datos para el PDF: nombre de plaza + lo necesario para reconstruir la cuadrícula.
    const plazaNombre = _plazas.find(p => p.id === getPlazaScope())?.nombre ?? null;
    _gridPDF = { fechas, activos, turnoDe, rango, plazaNombre };

    const optsFor = (sel) => `<option value="">${tr('Descanso')}</option>` + turnos.map(t =>
      `<option value="${t.id}" ${sel === t.id ? 'selected' : ''}>${t.nombre} (${(t.hora_entrada||'').slice(0,5)}-${(t.hora_salida||'').slice(0,5)})</option>`
    ).join('');

    const nav = `
      <div class="sem-nav">
        <button class="sem-nav__btn" id="sem-prev" aria-label="${tr('Semana anterior')}">‹</button>
        <div class="sem-nav__label">${rango}</div>
        <button class="sem-nav__btn" id="sem-next" aria-label="${tr('Semana siguiente')}">›</button>
        <button class="sem-nav__hoy" id="sem-hoy">${tr('Hoy')}</button>
        <button class="sem-nav__hoy" id="sem-copiar" ${readonly ? 'hidden' : ''}>${tr('Copiar semana anterior')}</button>
        <span class="sem-total">${tr('Total semana')}: <strong id="sem-total-h">0 h</strong></span>
      </div>
      ${readonly ? `<div class="sem-ro" role="status">${tr('Modo solo lectura — esta semana ya pasó.')}</div>` : ''}`;

    if (!activos.length) {
      wrap.innerHTML = nav + `<div class="ad-empty">${tr('No hay empleados activos.')}</div>`;
      bindNav(wrap);
      return;
    }

    const head = `<tr><th class="grid-emp">${tr('Empleado')}</th>${fechas.map(d =>
      `<th>${tr(DIAS[((d.getDay() + 6) % 7) + 1])}<span class="grid-fecha">${fechaLabel(d)}</span></th>`).join('')}</tr>`;
    const rows = activos.map(e => `
      <tr>
        <td class="grid-emp">${e.nombre}</td>
        ${fechas.map(d => {
          const f = ymd(d);
          const sel = asignado.get(`${e.id}-${f}`) ?? '';
          const t = turnoDe.get(sel);
          return `<td><select class="grid-sel ${t ? 'sel--' + turnoColor(t) : ''}" data-emp="${e.id}" data-fecha="${f}" ${readonly ? 'disabled' : ''}>${optsFor(sel)}</select></td>`;
        }).join('')}
      </tr>`).join('');

    wrap.innerHTML = nav + `<div class="grid-scroll"><table class="grid-horarios"><thead>${head}</thead><tbody>${rows}</tbody></table></div>`;
    bindNav(wrap);
    wrap.querySelector('#sem-copiar')?.addEventListener('click', () => copiarSemanaAnterior());

    const recalcTotal = () => {
      let min = 0;
      wrap.querySelectorAll('.grid-sel').forEach(s => { min += horasTurno(turnoDe.get(parseInt(s.value) || 0)); });
      wrap.querySelector('#sem-total-h').textContent = `${(min / 60).toFixed(1)} h`;
    };
    recalcTotal();

    if (!readonly) wrap.querySelectorAll('.grid-sel').forEach(sel => {
      sel.addEventListener('change', async () => {
        const emp = parseInt(sel.dataset.emp), fecha = sel.dataset.fecha;
        const turnoId = parseInt(sel.value) || null;
        sel.disabled = true;
        try {
          await api.setTurnoDia(emp, fecha, turnoId);
          sel.className = `grid-sel ${turnoId ? 'sel--' + turnoColor(turnoDe.get(turnoId)) : ''}`;
          recalcTotal();
          showToast('Turno actualizado.', 'ok');
        } catch (err) { showToast(err.message, 'error'); }
        finally { sel.disabled = false; }
      });
    });
  } catch (e) {
    wrap.innerHTML = `<div class="ad-empty" style="color:#DC2626">${e.message}</div>`;
  }
}

// Color de celda en el PDF, mismo mapeo que la cuadrícula (.grid-sel.sel--c-*).
const TURNO_PDF = {
  'c-blue':    { bg: '#DBEAFE', fg: '#1E40AF' },
  'c-emerald': { bg: '#DCFCE7', fg: '#166534' },
  'c-teal':    { bg: '#CCFBF1', fg: '#115E59' },
  'c-amber':   { bg: '#FEF3C7', fg: '#92400E' },
  'c-violet':  { bg: '#EDE9FE', fg: '#5B21B6' },
};

// PDF de la distribución semanal: réplica imprimible de la cuadrícula en pantalla.
// Lee los <select> en vivo para reflejar exactamente lo que ve el usuario.
function pdfTurnos() {
  if (!_gridPDF || !_gridPDF.activos.length) { showToast(tr('No hay turnos que exportar.'), 'error'); return; }
  const { fechas, activos, turnoDe, rango, plazaNombre } = _gridPDF;
  const w = window.open('', '_blank');
  if (!w) { showToast(tr('Permite las ventanas emergentes para exportar.'), 'error'); return; }
  const fechaLabel = (d) => d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' });

  const head = `<th class="emp">${tr('Empleado')}</th>` + fechas.map(d => {
    const finde = [0, 6].includes(d.getDay());
    return `<th${finde ? ' class="we"' : ''}>${tr(DIAS[((d.getDay() + 6) % 7) + 1])}<br><small>${fechaLabel(d)}</small></th>`;
  }).join('');

  let totalMin = 0;
  const body = activos.map(e => {
    const tds = fechas.map(d => {
      const f = ymd(d);
      const sel = document.querySelector(`.grid-sel[data-emp="${e.id}"][data-fecha="${f}"]`);
      const tn = sel ? turnoDe.get(parseInt(sel.value) || 0) : null;
      if (!tn) return `<td class="off">${tr('Descanso')}</td>`;
      totalMin += horasTurno(tn);
      const c = TURNO_PDF[turnoColor(tn)] ?? { bg: '#fff', fg: '#111' };
      return `<td style="background:${c.bg};color:${c.fg};font-weight:600">${esc(tn.nombre)}<br><small>${(tn.hora_entrada || '').slice(0, 5)}–${(tn.hora_salida || '').slice(0, 5)}</small></td>`;
    }).join('');
    return `<tr><td class="emp">${esc(e.nombre)}</td>${tds}</tr>`;
  }).join('');

  const titulo = `${tr('Distribución de turnos')}${plazaNombre ? ' — ' + esc(plazaNombre) : ''}`;
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(titulo)}</title><style>
    *{-webkit-print-color-adjust:exact;print-color-adjust:exact}
    body{font:12px system-ui,-apple-system,sans-serif;margin:22px;color:#0f172a}
    h1{font-size:17px;margin:0 0 2px}
    .sub{color:#64748b;font-size:11px;margin:0 0 14px;display:flex;justify-content:space-between;gap:12px}
    table{border-collapse:collapse;width:100%;table-layout:fixed}
    th,td{border:1px solid #cbd5e1;padding:6px 7px;text-align:center;vertical-align:middle}
    th{background:#f1f5f9;font-size:10px;line-height:1.3}
    th small,td small{font-weight:400;opacity:.75;font-size:9px}
    td.emp,th.emp{text-align:left;white-space:nowrap;font-weight:600;background:#f8fafc;width:150px}
    td.off{color:#94a3b8;font-style:italic}
    .we{background:#e2e8f0}
    @page{size:landscape;margin:12mm}
  </style></head><body>
    <h1>${esc(titulo)}</h1>
    <div class="sub"><span>${esc(rango)}</span><span>${tr('Total semana')}: ${(totalMin / 60).toFixed(1)} h</span></div>
    <table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>
    <scr` + `ipt>window.onload=function(){window.print()}</scr` + `ipt>
  </body></html>`);
  w.document.close();
}

function bindNav(wrap) {
  const go = (n) => { _semana = n; loadGrid(); };
  wrap.querySelector('#sem-prev')?.addEventListener('click', () => go(addDias(_semana, -7)));
  wrap.querySelector('#sem-next')?.addEventListener('click', () => go(addDias(_semana, 7)));
  wrap.querySelector('#sem-hoy') ?.addEventListener('click', () => go(lunesDe(new Date())));
}

// "Copiar semana anterior": la semana visible queda idéntica a la previa.
async function copiarSemanaAnterior() {
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
    // "Copiar" = limpia y reescribe el rango visible para estos empleados.
    await api.deleteTurnosDiaRango(activos.map(e => e.id), ymd(_semana), ymd(addDias(_semana, 6)));
    await api.setTurnosDiaBulk(rows);
    showToast(tr('Semana copiada.'), 'ok');
    await loadGrid();
  } catch (e) { showToast(e.message, 'error'); }
}

let _allTurnos = [];

function turnoCard(t) {
  const dias = (t.dias_semana || []).map(d => tr(DIAS[d])).join(' · ') || tr('Sin días');
  return `
    <div class="turno-card turno-card--${turnoColor(t)}">
      <div class="turno-card__top">
        <h3 class="turno-card__name">${t.nombre}</h3>
        <span class="turno-card__badge">${tr(t.activo ? 'Activo' : 'Inactivo')}</span>
      </div>
      <div class="turno-card__time">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 16 14"/></svg>
        ${fmtHora(t.hora_entrada)} – ${fmtHora(t.hora_salida)}
      </div>
      <ul class="turno-card__meta">
        <li><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg> ${t.plazas?.nombre ?? '–'}</li>
        <li><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/></svg> ${dias}</li>
        <li><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 16 14"/></svg> ${tr('Tol.')} ${t.tolerancia_entrada_min}/${t.tolerancia_salida_min} min</li>
      </ul>
      <div class="turno-card__actions" data-rh-only>
        <button class="turno-card__btn" title="${tr('Editar')}" onclick="window._editTurno(${t.id})">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        <button class="turno-card__btn" title="${tr('Eliminar')}" onclick="window._deleteTurno(${t.id}, '${t.nombre.replace(/'/g, "\\'")}')">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/></svg>
        </button>
      </div>
    </div>`;
}

async function loadTurnos() {
  const wrap = document.getElementById('tbl-turnos-wrap');
  loading(wrap);
  try {
    _allTurnos = filterByPlaza(await api.getTurnos(), t => t.plaza_id);
    wrap.innerHTML = _allTurnos.length
      ? `<div class="turno-cards">${_allTurnos.map(turnoCard).join('')}</div>`
      : `<div class="ad-card"><div class="ad-empty">${tr('No hay turnos en esta plaza. Crea el primero.')}</div></div>`;

    window._editTurno   = (id) => { const t = _allTurnos.find(t => t.id === id); if (t) openTurnoForm(t); };
    window._deleteTurno = async (id, nombre) => {
      if (!await confirm(`${tr('¿Eliminar turno?')} "${nombre}"`, { ok: 'Eliminar' })) return;
      try { await api.deleteTurno(id); showToast('Turno eliminado.', 'ok'); await loadTurnos(); }
      catch (e) { showToast(e.message, 'error'); }
    };
  } catch (e) {
    wrap.innerHTML = `<div class="ad-card"><div class="ad-empty" style="color:#DC2626">${e.message}</div></div>`;
  }
}

function openTurnoForm(turno = null) {
  const isEdit = !!turno;
  const defPlaza  = turno?.plaza_id ?? getPlazaScope();
  const plazaOpts = _plazas.map(p => `<option value="${p.id}" ${defPlaza === p.id ? 'selected' : ''}>${p.nombre}</option>`).join('');
  const diasActivos = turno?.dias_semana ?? [1, 2, 3, 4, 5];

  openModal(
    isEdit ? `${tr('Editar')}: ${turno.nombre}` : 'Nuevo Turno',
    `<div class="form-group">
      <label for="t-nombre">${tr('Nombre del turno')} *</label>
      <input id="t-nombre" class="form-input" value="${turno?.nombre ?? ''}" placeholder="${tr('Ej: Turno Matutino')}">
    </div>
    <div class="form-group">
      <label for="t-plaza">${tr('Plaza')} *</label>
      <select id="t-plaza" class="form-input"><option value="">– ${tr('Selecciona')} –</option>${plazaOpts}</select>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <div class="form-group">
        <label for="t-entrada">${tr('Hora de entrada')} *</label>
        <input id="t-entrada" class="form-input" type="time" value="${turno?.hora_entrada?.slice(0,5) ?? '08:00'}">
      </div>
      <div class="form-group">
        <label for="t-salida">${tr('Hora de salida')} *</label>
        <input id="t-salida" class="form-input" type="time" value="${turno?.hora_salida?.slice(0,5) ?? '17:00'}">
      </div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px">
      <div class="form-group">
        <label for="t-tol-e">${tr('Tol. entrada (min)')}</label>
        <input id="t-tol-e" class="form-input" type="number" min="0" max="120" value="${turno?.tolerancia_entrada_min ?? 15}">
      </div>
      <div class="form-group">
        <label for="t-tol-s">${tr('Tol. salida (min)')}</label>
        <input id="t-tol-s" class="form-input" type="number" min="0" max="120" value="${turno?.tolerancia_salida_min ?? 10}">
      </div>
      <div class="form-group">
        <label for="t-pausa">${tr('Pausa (min)')}</label>
        <input id="t-pausa" class="form-input" type="number" min="0" max="480" value="${turno?.pausa_min ?? 0}">
      </div>
    </div>
    <div class="form-group">
      <label>${tr('Días de la semana')} *</label>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        ${[1,2,3,4,5,6,7].map(d => `
          <label style="display:flex;align-items:center;gap:4px;font-size:.85rem;text-transform:none;color:var(--ad-tinta);font-weight:500;cursor:pointer">
            <input type="checkbox" name="t-dia" value="${d}" ${diasActivos.includes(d) ? 'checked' : ''} style="width:14px;height:14px">
            ${tr(DIAS[d])}
          </label>`).join('')}
      </div>
    </div>
    <p id="t-error" class="error-inline" hidden></p>`,
    async () => {
      const nombre   = document.getElementById('t-nombre').value.trim();
      const plaza_id = parseInt(document.getElementById('t-plaza').value) || null;
      const h_ent    = document.getElementById('t-entrada').value;
      const h_sal    = document.getElementById('t-salida').value;
      const tol_e    = parseInt(document.getElementById('t-tol-e').value) || 0;
      const tol_s    = parseInt(document.getElementById('t-tol-s').value) || 0;
      const pausa    = parseInt(document.getElementById('t-pausa').value) || 0;
      const dias     = [...document.querySelectorAll('input[name="t-dia"]:checked')].map(el => parseInt(el.value));
      const errEl    = document.getElementById('t-error');

      if (!nombre || !plaza_id || !h_ent || !h_sal || !dias.length) {
        errEl.textContent = tr('Completa todos los campos obligatorios.');
        errEl.hidden = false;
        return;
      }

      const payload = {
        nombre, plaza_id,
        hora_entrada: h_ent, hora_salida: h_sal,
        tolerancia_entrada_min: tol_e, tolerancia_salida_min: tol_s,
        pausa_min: pausa,
        dias_semana: dias
      };

      errEl.hidden = true;
      try {
        if (isEdit) await api.updateTurno(turno.id, payload);
        else        await api.createTurno(payload);
        closeModal();
        showToast(isEdit ? 'Turno actualizado.' : 'Turno creado.', 'ok');
        await loadTurnos();
      } catch (e) {
        errEl.textContent = e.message;
        errEl.hidden = false;
      }
    }
  );
}
