import * as api from './api.js';
import { loading, showToast, openModal, closeModal, fmtHora, confirm } from './utils.js';
import { getPlazaScope, filterByPlaza } from './plaza-scope.js';

let _plazas = [];
const DIAS = ['', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

export async function init(panel) {
  _plazas = await api.getPlazas().catch(() => []);

  panel.innerHTML = `
    <div class="panel-header">
      <h2>Turnos</h2>
      <div class="panel-header__actions">
        <button class="abtn abtn--primary" id="btn-nuevo-turno" data-rh-only>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Nuevo Turno
        </button>
      </div>
    </div>
    <div id="tbl-turnos-wrap"></div>

    <div class="panel-header" style="margin-top:28px">
      <h2>Asignación semanal</h2>
      <span class="td-muted" style="font-size:.85rem">Elige el turno de cada empleado por día. Se guarda al instante.</span>
    </div>
    <div class="ad-card"><div id="grid-horarios-wrap"></div></div>`;

  document.getElementById('btn-nuevo-turno')?.addEventListener('click', () => openTurnoForm());
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
    const [empleados, allTurnos, horarios] = await Promise.all([
      api.getEmpleados(), api.getTurnos(), api.getHorarios()
    ]);
    // Solo turnos de la plaza en foco: no asignar un turno de otra plaza.
    const turnos = filterByPlaza(allTurnos, t => t.plaza_id);
    const activos = filterByPlaza(empleados.filter(e => e.activo), e => e.plaza_id);
    if (!activos.length) { wrap.innerHTML = '<div class="ad-empty">No hay empleados activos.</div>'; return; }

    // key "empleado-dia" → turno_id
    const asignado = new Map(horarios.map(h => [`${h.id_empleado}-${h.dia_semana}`, h.turno_id]));
    const optsFor = (sel) => `<option value="">Descanso</option>` + turnos.map(t =>
      `<option value="${t.id}" ${sel === t.id ? 'selected' : ''}>${t.nombre} (${(t.hora_entrada||'').slice(0,5)}-${(t.hora_salida||'').slice(0,5)})</option>`
    ).join('');

    const head = `<tr><th class="grid-emp">Empleado</th>${[1,2,3,4,5,6,7].map(d => `<th>${DIAS[d]}</th>`).join('')}</tr>`;
    const rows = activos.map(e => `
      <tr>
        <td class="grid-emp">${e.nombre}</td>
        ${[1,2,3,4,5,6,7].map(d => {
          const sel = asignado.get(`${e.id}-${d}`) ?? '';
          const t = turnos.find(t => t.id === sel);
          return `<td><select class="grid-sel ${t ? 'sel--' + turnoColor(t) : ''}" data-emp="${e.id}" data-dia="${d}">${optsFor(sel)}</select></td>`;
        }).join('')}
      </tr>`).join('');

    wrap.innerHTML = `<div class="grid-scroll"><table class="grid-horarios"><thead>${head}</thead><tbody>${rows}</tbody></table></div>`;

    wrap.querySelectorAll('.grid-sel').forEach(sel => {
      sel.addEventListener('change', async () => {
        const emp = parseInt(sel.dataset.emp), dia = parseInt(sel.dataset.dia);
        const turnoId = parseInt(sel.value) || null;
        sel.disabled = true;
        try {
          await api.setHorario(emp, dia, turnoId);
          const t = turnos.find(t => t.id === turnoId);
          sel.className = `grid-sel ${t ? 'sel--' + turnoColor(t) : ''}`;
          showToast('Horario actualizado.', 'ok');
        } catch (err) { showToast(err.message, 'error'); }
        finally { sel.disabled = false; }
      });
    });
  } catch (e) {
    wrap.innerHTML = `<div class="ad-empty" style="color:#DC2626">${e.message}</div>`;
  }
}

let _allTurnos = [];

function turnoCard(t) {
  const dias = (t.dias_semana || []).map(d => DIAS[d]).join(' · ') || 'Sin días';
  return `
    <div class="turno-card turno-card--${turnoColor(t)}">
      <div class="turno-card__top">
        <h3 class="turno-card__name">${t.nombre}</h3>
        <span class="turno-card__badge">${t.activo ? 'Activo' : 'Inactivo'}</span>
      </div>
      <div class="turno-card__time">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 16 14"/></svg>
        ${fmtHora(t.hora_entrada)} – ${fmtHora(t.hora_salida)}
      </div>
      <ul class="turno-card__meta">
        <li><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg> ${t.plazas?.nombre ?? '–'}</li>
        <li><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/></svg> ${dias}</li>
        <li><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 16 14"/></svg> Tol. ${t.tolerancia_entrada_min}/${t.tolerancia_salida_min} min</li>
      </ul>
      <div class="turno-card__actions" data-rh-only>
        <button class="turno-card__btn" title="Editar" onclick="window._editTurno(${t.id})">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        <button class="turno-card__btn" title="Eliminar" onclick="window._deleteTurno(${t.id}, '${t.nombre.replace(/'/g, "\\'")}')">
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
      : '<div class="ad-card"><div class="ad-empty">No hay turnos en esta plaza. Crea el primero.</div></div>';

    window._editTurno   = (id) => { const t = _allTurnos.find(t => t.id === id); if (t) openTurnoForm(t); };
    window._deleteTurno = async (id, nombre) => {
      if (!await confirm(`¿Eliminar turno "${nombre}"?`, { ok: 'Eliminar' })) return;
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
    isEdit ? `Editar: ${turno.nombre}` : 'Nuevo Turno',
    `<div class="form-group">
      <label for="t-nombre">Nombre del turno *</label>
      <input id="t-nombre" class="form-input" value="${turno?.nombre ?? ''}" placeholder="Ej: Turno Matutino">
    </div>
    <div class="form-group">
      <label for="t-plaza">Plaza *</label>
      <select id="t-plaza" class="form-input"><option value="">– Selecciona –</option>${plazaOpts}</select>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <div class="form-group">
        <label for="t-entrada">Hora de entrada *</label>
        <input id="t-entrada" class="form-input" type="time" value="${turno?.hora_entrada?.slice(0,5) ?? '08:00'}">
      </div>
      <div class="form-group">
        <label for="t-salida">Hora de salida *</label>
        <input id="t-salida" class="form-input" type="time" value="${turno?.hora_salida?.slice(0,5) ?? '17:00'}">
      </div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px">
      <div class="form-group">
        <label for="t-tol-e">Tol. entrada (min)</label>
        <input id="t-tol-e" class="form-input" type="number" min="0" max="120" value="${turno?.tolerancia_entrada_min ?? 15}">
      </div>
      <div class="form-group">
        <label for="t-tol-s">Tol. salida (min)</label>
        <input id="t-tol-s" class="form-input" type="number" min="0" max="120" value="${turno?.tolerancia_salida_min ?? 10}">
      </div>
      <div class="form-group">
        <label for="t-pausa">Pausa (min)</label>
        <input id="t-pausa" class="form-input" type="number" min="0" max="480" value="${turno?.pausa_min ?? 0}">
      </div>
    </div>
    <div class="form-group">
      <label>Días de la semana *</label>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        ${[1,2,3,4,5,6,7].map(d => `
          <label style="display:flex;align-items:center;gap:4px;font-size:.85rem;text-transform:none;color:var(--ad-tinta);font-weight:500;cursor:pointer">
            <input type="checkbox" name="t-dia" value="${d}" ${diasActivos.includes(d) ? 'checked' : ''} style="width:14px;height:14px">
            ${DIAS[d]}
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
        errEl.textContent = 'Completa todos los campos obligatorios.';
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
