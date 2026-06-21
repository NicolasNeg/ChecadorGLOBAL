import * as api from './api.js';
import { renderTable, loading, showToast, openModal, closeModal, confirm } from './utils.js';
import { getPlazaScope, filterByPlaza } from './plaza-scope.js';

let _plazas  = [];
let _turnos  = [];

export async function init(panel) {
  [_plazas, _turnos] = await Promise.all([api.getPlazas(), api.getTurnos()]).catch(() => [[], []]);

  panel.innerHTML = `
    <div class="panel-header">
      <h2>Empleados</h2>
      <div class="panel-header__actions">
        <input id="emp-search" class="form-input" style="height:36px;min-width:200px" placeholder="Buscar empleado…">
        <button class="abtn abtn--primary" id="btn-nuevo-emp">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Nuevo Empleado
        </button>
      </div>
    </div>
    <div class="ad-card">
      <div id="tbl-emp-wrap"></div>
    </div>`;

  document.getElementById('btn-nuevo-emp').addEventListener('click', () => openEmpForm());
  document.getElementById('emp-search').addEventListener('input', (e) => filterTable(e.target.value));
  await loadEmpleados();
}

let _allEmpleados = [];

async function loadEmpleados() {
  const wrap = document.getElementById('tbl-emp-wrap');
  loading(wrap);
  try {
    _allEmpleados = await api.getEmpleados();
    renderEmpleados(_allEmpleados);

    window._editEmp = (id) => {
      const emp = _allEmpleados.find(e => e.id === id);
      if (emp) openEmpForm(emp);
    };
    window._verHistorial = async (id) => {
      const m = await import('./historial-empleado.js');
      m.preseleccionar(id);
      document.querySelector('.sidebar__link[data-panel="historial"]').click();
    };
    window._toggleEmp = async (id, activo) => {
      try {
        await api.updateEmpleado(id, { activo: !activo });
        showToast(activo ? 'Empleado desactivado.' : 'Empleado reactivado.', 'ok');
        await loadEmpleados();
      } catch (e) { showToast(e.message, 'error'); }
    };
    window._resetPin = (id, nombre) => {
      openModal(`Resetear PIN: ${nombre}`,
        `<div class="form-group">
          <label for="pin-nuevo">Nuevo PIN (solo números)</label>
          <input id="pin-nuevo" class="form-input" type="password" inputmode="numeric" pattern="\\d*" maxlength="10" placeholder="••••">
        </div>
        <p id="pin-error" class="error-inline" hidden></p>`,
        async () => {
          const pin = document.getElementById('pin-nuevo').value.trim();
          const errEl = document.getElementById('pin-error');
          if (!pin || !/^\d+$/.test(pin)) {
            errEl.textContent = 'Ingresa un PIN numérico válido.';
            errEl.hidden = false;
            return;
          }
          try {
            await api.actualizarPin(id, pin);
            closeModal();
            showToast('PIN actualizado correctamente.', 'ok');
          } catch (e) {
            errEl.textContent = e.message;
            errEl.hidden = false;
          }
        },
        'Guardar PIN'
      );
    };
  } catch (e) {
    document.getElementById('tbl-emp-wrap').innerHTML =
      `<div class="ad-empty" style="color:#DC2626">${e.message}</div>`;
  }
}

function renderEmpleados(empleados) {
  const wrap = document.getElementById('tbl-emp-wrap');
  if (!wrap) return;
  empleados = filterByPlaza(empleados, e => e.plaza_id);
  renderTable(
    wrap,
    [
      { key: 'nombre',   label: 'Nombre', render: r => `<div class="emp-cell">${
        r.foto_url
          ? `<img class="emp-avatar" src="${r.foto_url}" alt="">`
          : `<span class="emp-avatar emp-avatar--ph">${r.nombre.trim().split(/\s+/).map(w=>w[0]).join('').slice(0,2).toUpperCase()}</span>`
      }<span>${r.nombre}${r.puesto ? `<br><span class="td-muted">${r.puesto}</span>` : ''}</span></div>` },
      { key: 'plaza',    label: 'Plaza',  render: r => r.plazas?.nombre  ?? '<span class="td-muted">Sin plaza</span>' },
      { key: 'turno',    label: 'Turno',  render: r => r.turnos?.nombre  ?? '<span class="td-muted">Sin turno</span>' },
      { key: 'activo',   label: 'Estado', render: r => r.activo
          ? '<span class="abadge abadge--green">Activo</span>'
          : '<span class="abadge abadge--gray">Inactivo</span>' }
    ],
    empleados,
    (r) => `
      <button class="abtn abtn--ghost abtn--icon" title="Ver historial" onclick="window._verHistorial(${r.id})">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 3v18h18"/><path d="M18.7 8l-5.1 5.2-2.8-2.7L7 14.3"/></svg>
      </button>
      <button class="abtn abtn--ghost abtn--icon" title="Editar" onclick="window._editEmp(${r.id})">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
      </button>
      <button class="abtn abtn--ghost abtn--icon" title="Resetear PIN" onclick="window._resetPin(${r.id}, '${r.nombre.replace(/'/g, "\\'")}')">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
      </button>
      <button class="abtn abtn--icon" title="${r.activo ? 'Desactivar' : 'Reactivar'}"
        style="background:${r.activo ? '#FEF2F2' : '#DCFCE7'};color:${r.activo ? '#DC2626' : '#16A34A'}"
        onclick="window._toggleEmp(${r.id}, ${r.activo})">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
          ${r.activo
            ? '<path d="M18 6L6 18M6 6l12 12"/>'
            : '<polyline points="20 6 9 17 4 12"/>'}
        </svg>
      </button>`
  );
}

function filterTable(q) {
  const filtered = q
    ? _allEmpleados.filter(e => e.nombre.toLowerCase().includes(q.toLowerCase()))
    : _allEmpleados;
  renderEmpleados(filtered);
}

const ROLES = ['empleado', 'supervisor', 'gerente'];

function openEmpForm(emp = null) {
  const isEdit = !!emp;
  const v = (k) => emp?.[k] ?? '';
  const defPlaza  = emp?.plaza_id ?? getPlazaScope();
  const plazaOpts = _plazas.map(p => `<option value="${p.id}" ${defPlaza === p.id ? 'selected' : ''}>${p.nombre}</option>`).join('');
  const turnoOpts = `<option value="">Sin turno</option>` + _turnos.map(t => `<option value="${t.id}" ${emp?.turno_id === t.id ? 'selected' : ''}>${t.nombre} (${t.plazas?.nombre})</option>`).join('');
  const rolOpts   = ROLES.map(r => `<option value="${r}" ${(emp?.rol ?? 'empleado') === r ? 'selected' : ''}>${r[0].toUpperCase() + r.slice(1)}</option>`).join('');

  openModal(
    isEdit ? `Editar: ${emp.nombre}` : 'Nuevo Empleado',
    `<div class="emp-foto-row">
      <img id="e-foto-prev" class="emp-foto-prev" src="${v('foto_url') || ''}" alt="" ${v('foto_url') ? '' : 'hidden'}>
      <div id="e-foto-ph" class="emp-foto-ph" ${v('foto_url') ? 'hidden' : ''}>Sin foto</div>
      <div class="form-group" style="flex:1;margin:0">
        <label for="e-foto">Foto de perfil</label>
        <input id="e-foto" class="form-input" type="file" accept="image/*">
      </div>
    </div>
    <div class="form-group">
      <label for="e-nombre">Nombre completo *</label>
      <input id="e-nombre" class="form-input" value="${v('nombre')}" placeholder="Juan Pérez García">
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <div class="form-group">
        <label for="e-num">N.º empleado</label>
        <input id="e-num" class="form-input" value="${v('numero_empleado')}" placeholder="EQS-003">
      </div>
      <div class="form-group">
        <label for="e-puesto">Puesto</label>
        <input id="e-puesto" class="form-input" value="${v('puesto')}" placeholder="Cajero">
      </div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <div class="form-group">
        <label for="e-email">Correo</label>
        <input id="e-email" class="form-input" type="email" value="${v('email')}" placeholder="correo@empresa.com">
      </div>
      <div class="form-group">
        <label for="e-tel">Teléfono</label>
        <input id="e-tel" class="form-input" type="tel" value="${v('telefono')}" placeholder="55 1234 5678">
      </div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <div class="form-group">
        <label for="e-ingreso">Fecha de ingreso</label>
        <input id="e-ingreso" class="form-input" type="date" value="${v('fecha_ingreso')}">
      </div>
      <div class="form-group">
        <label for="e-rol">Rol</label>
        <select id="e-rol" class="form-input">${rolOpts}</select>
      </div>
    </div>
    <div class="form-group">
      <label for="e-plaza">Plaza *</label>
      <select id="e-plaza" class="form-input"><option value="">– Selecciona –</option>${plazaOpts}</select>
    </div>
    <div class="form-group">
      <label for="e-turno">Turno</label>
      <select id="e-turno" class="form-input">${turnoOpts}</select>
    </div>
    ${!isEdit ? `<div class="form-group">
      <label for="e-pin">PIN inicial (solo números) *</label>
      <input id="e-pin" class="form-input" type="password" inputmode="numeric" pattern="\\d*" maxlength="10" placeholder="••••">
    </div>` : ''}
    <p id="e-error" class="error-inline" hidden></p>`,
    async () => {
      const nombre   = document.getElementById('e-nombre').value.trim();
      const plaza_id = parseInt(document.getElementById('e-plaza').value) || null;
      const turno_id = parseInt(document.getElementById('e-turno').value) || null;
      const errEl    = document.getElementById('e-error');

      if (!nombre || !plaza_id) {
        errEl.textContent = 'Nombre y Plaza son obligatorios.';
        errEl.hidden = false;
        return;
      }

      // campos de perfil (RH). Vacío → null para no machacar con "".
      const datos = {
        nombre, plaza_id, turno_id,
        numero_empleado: document.getElementById('e-num').value.trim()    || null,
        puesto:          document.getElementById('e-puesto').value.trim() || null,
        email:           document.getElementById('e-email').value.trim()  || null,
        telefono:        document.getElementById('e-tel').value.trim()     || null,
        fecha_ingreso:   document.getElementById('e-ingreso').value        || null,
        rol:             document.getElementById('e-rol').value
      };

      errEl.hidden = true;
      try {
        const file = document.getElementById('e-foto').files[0];
        if (file) datos.foto_url = await api.subirFotoPerfil(file);

        if (isEdit) {
          await api.updateEmpleado(emp.id, datos);
        } else {
          const pin = document.getElementById('e-pin').value.trim();
          if (!pin || !/^\d+$/.test(pin)) {
            errEl.textContent = 'El PIN debe ser numérico.';
            errEl.hidden = false;
            return;
          }
          const nuevo = await api.crearEmpleado({ p_nombre: nombre, p_pin: pin, p_plaza_id: plaza_id, p_turno_id: turno_id });
          const id = Array.isArray(nuevo) ? nuevo[0]?.id : nuevo?.id;
          // crear_empleado sólo guarda nombre/plaza/turno/pin; el resto va por PATCH.
          const { nombre: _n, plaza_id: _p, turno_id: _t, ...resto } = datos;
          if (id && Object.values(resto).some(Boolean)) await api.updateEmpleado(id, resto);
        }
        closeModal();
        showToast(isEdit ? 'Empleado actualizado.' : 'Empleado creado.', 'ok');
        await loadEmpleados();
      } catch (e) {
        errEl.textContent = e.message;
        errEl.hidden = false;
      }
    }
  );

  // preview de la foto al elegir archivo
  document.getElementById('e-foto')?.addEventListener('change', (ev) => {
    const f = ev.target.files[0];
    if (!f) return;
    const prev = document.getElementById('e-foto-prev');
    const ph   = document.getElementById('e-foto-ph');
    prev.src = URL.createObjectURL(f);
    prev.hidden = false;
    if (ph) ph.hidden = true;
  });
}
