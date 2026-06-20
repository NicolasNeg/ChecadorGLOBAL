import * as api from './api.js';
import { renderTable, loading, showToast, openModal, closeModal, fmtHora, confirm } from './utils.js';

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
    <div class="ad-card"><div id="tbl-turnos-wrap"></div></div>

    <div class="panel-header" style="margin-top:28px">
      <h2>Asignación semanal</h2>
      <span class="td-muted" style="font-size:.85rem">Elige el turno de cada empleado por día. Se guarda al instante.</span>
    </div>
    <div class="ad-card"><div id="grid-horarios-wrap"></div></div>`;

  document.getElementById('btn-nuevo-turno')?.addEventListener('click', () => openTurnoForm());
  await loadTurnos();
  await loadGrid();
}

// ── Cuadrícula de asignación semanal (empleado × día) ──────────────────────
const shiftClass = (n = '') => {
  const s = n.toLowerCase();
  if (s.includes('mañana') || s.includes('matutino')) return 'shift--am';
  if (s.includes('tarde')  || s.includes('vesp'))     return 'shift--pm';
  if (s.includes('noche')  || s.includes('nocturno')) return 'shift--night';
  return '';
};

async function loadGrid() {
  const wrap = document.getElementById('grid-horarios-wrap');
  loading(wrap);
  try {
    const [empleados, turnos, horarios] = await Promise.all([
      api.getEmpleados(), api.getTurnos(), api.getHorarios()
    ]);
    const activos = empleados.filter(e => e.activo);
    if (!activos.length) { wrap.innerHTML = '<div class="ad-empty">No hay empleados activos.</div>'; return; }

    // key "empleado-dia" → turno_id
    const asignado = new Map(horarios.map(h => [`${h.id_empleado}-${h.dia_semana}`, h.turno_id]));
    const optsFor = (sel) => `<option value="">—</option>` + turnos.map(t =>
      `<option value="${t.id}" ${sel === t.id ? 'selected' : ''}>${t.nombre} (${(t.hora_entrada||'').slice(0,5)}-${(t.hora_salida||'').slice(0,5)})</option>`
    ).join('');

    const head = `<tr><th class="grid-emp">Empleado</th>${[1,2,3,4,5,6,7].map(d => `<th>${DIAS[d]}</th>`).join('')}</tr>`;
    const rows = activos.map(e => `
      <tr>
        <td class="grid-emp">${e.nombre}</td>
        ${[1,2,3,4,5,6,7].map(d => {
          const sel = asignado.get(`${e.id}-${d}`) ?? '';
          const t = turnos.find(t => t.id === sel);
          return `<td><select class="grid-sel ${shiftClass(t?.nombre)}" data-emp="${e.id}" data-dia="${d}">${optsFor(sel)}</select></td>`;
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
          sel.className = `grid-sel ${shiftClass(t?.nombre)}`;
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

async function loadTurnos() {
  const wrap = document.getElementById('tbl-turnos-wrap');
  loading(wrap);
  try {
    _allTurnos = await api.getTurnos();
    renderTable(
      wrap,
      [
        { key: 'nombre',    label: 'Nombre' },
        { key: 'plaza',     label: 'Plaza',    render: r => r.plazas?.nombre ?? '–' },
        { key: 'entrada',   label: 'Entrada',  render: r => fmtHora(r.hora_entrada) },
        { key: 'salida',    label: 'Salida',   render: r => fmtHora(r.hora_salida) },
        { key: 'tol_ent',   label: 'Tol. entrada', render: r => `${r.tolerancia_entrada_min} min` },
        { key: 'tol_sal',   label: 'Tol. salida',  render: r => `${r.tolerancia_salida_min} min` },
        { key: 'dias',      label: 'Días',     render: r => (r.dias_semana || []).map(d => DIAS[d]).join(', ') },
        { key: 'activo',    label: 'Estado',   render: r => r.activo
            ? '<span class="abadge abadge--green">Activo</span>'
            : '<span class="abadge abadge--gray">Inactivo</span>' }
      ],
      _allTurnos,
      (r) => `
        <button class="abtn abtn--ghost abtn--icon" title="Editar" onclick="window._editTurno(${r.id})">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        <button class="abtn abtn--danger abtn--icon" title="Eliminar" onclick="window._deleteTurno(${r.id}, '${r.nombre.replace(/'/g, "\\'")}')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/></svg>
        </button>`
    );

    window._editTurno   = (id) => { const t = _allTurnos.find(t => t.id === id); if (t) openTurnoForm(t); };
    window._deleteTurno = async (id, nombre) => {
      if (!confirm(`¿Eliminar turno "${nombre}"?`)) return;
      try { await api.deleteTurno(id); showToast('Turno eliminado.', 'ok'); await loadTurnos(); }
      catch (e) { showToast(e.message, 'error'); }
    };
  } catch (e) {
    document.getElementById('tbl-turnos-wrap').innerHTML = `<div class="ad-empty" style="color:#DC2626">${e.message}</div>`;
  }
}

function openTurnoForm(turno = null) {
  const isEdit = !!turno;
  const plazaOpts = _plazas.map(p => `<option value="${p.id}" ${turno?.plaza_id === p.id ? 'selected' : ''}>${p.nombre}</option>`).join('');
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
