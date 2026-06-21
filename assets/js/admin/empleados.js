import * as api from './api.js';
import { loading, showToast, openModal, closeModal, esc } from './utils.js';
import { getPlazaScope, filterByPlaza } from './plaza-scope.js';
import { t } from '../i18n.js';

const iniciales = (n) => (n || '?').trim().split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();

// Iconos SVG de las tarjetas (stroke currentColor; un solo juego, mismo grosor).
const IC = {
  plaza: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18"/><path d="M5 21V7l8-4v18"/><path d="M19 21V11l-6-4"/><path d="M9 9v.01M9 12v.01M9 15v.01M9 18v.01"/></svg>',
  turno: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/></svg>',
  estado:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
  hist:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="M18.7 8l-5.1 5.2-2.8-2.7L7 14.3"/></svg>',
  edit:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>',
  pin:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>',
  baja:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
  alta:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
};

let _plazas  = [];
let _puestos = [];

export async function init(panel) {
  [_plazas, _puestos] = await Promise.all([api.getPlazas(), api.getPuestos()]).catch(() => [[], []]);

  panel.innerHTML = `
    <div class="panel-header">
      <h2>${t('Empleados')}</h2>
      <div class="panel-header__actions">
        <input id="emp-search" class="form-input" style="height:36px;min-width:200px" placeholder="${t('Buscar empleado…')}">
        <button class="abtn abtn--primary" id="btn-nuevo-emp">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          ${t('Nuevo Empleado')}
        </button>
      </div>
    </div>
    <div class="ad-card emp-card-shell">
      <div id="emp-grid-wrap"></div>
    </div>`;

  document.getElementById('btn-nuevo-emp').addEventListener('click', () => openEmpForm());
  document.getElementById('emp-search').addEventListener('input', (e) => filterTable(e.target.value));
  await loadEmpleados();
}

let _allEmpleados = [];

async function loadEmpleados() {
  const wrap = document.getElementById('emp-grid-wrap');
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
        showToast(activo ? 'Empleado desactivado.' : 'Empleado reactivado.', 'ok'); // utils traduce
        await loadEmpleados();
      } catch (e) { showToast(e.message, 'error'); }
    };
    window._resetPin = (id, nombre) => {
      openModal(`${t('Resetear PIN')}: ${nombre}`,
        `<div class="form-group">
          <label for="pin-nuevo">${t('Nuevo PIN (solo números)')}</label>
          <input id="pin-nuevo" class="form-input" type="password" inputmode="numeric" pattern="\\d*" maxlength="10" placeholder="••••">
        </div>
        <p id="pin-error" class="error-inline" hidden></p>`,
        async () => {
          const pin = document.getElementById('pin-nuevo').value.trim();
          const errEl = document.getElementById('pin-error');
          if (!pin || !/^\d+$/.test(pin)) {
            errEl.textContent = t('Ingresa un PIN numérico válido.');
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
    document.getElementById('emp-grid-wrap').innerHTML =
      `<div class="ad-empty" style="color:#DC2626">${esc(e.message)}</div>`;
  }
}

function tarjetaEmp(r) {
  const foto = r.foto_url
    ? `<img class="emp-c__img" src="${esc(r.foto_url)}" alt="">`
    : `<span class="emp-c__img emp-c__img--ph">${esc(iniciales(r.nombre))}</span>`;
  const nombreJs = r.nombre.replace(/'/g, "\\'");
  return `
    <article class="emp-c">
      <div class="emp-c__photo">${foto}</div>
      <div class="emp-c__body">
        <h3 class="emp-c__name" title="${esc(r.nombre)}">${esc(r.nombre)}</h3>
        <p class="emp-c__role">${esc(r.puesto || t('Sin puesto'))}</p>
        <div class="emp-c__stats">
          <div class="emp-c__stat" title="${t('Plaza')}">${IC.plaza}<span>${esc(r.plazas?.nombre || t('Sin plaza'))}</span></div>
          <div class="emp-c__stat" title="${t('Estado')}">${IC.estado}<span class="abadge ${r.activo ? 'abadge--green' : 'abadge--gray'}">${t(r.activo ? 'Activo' : 'Inactivo')}</span></div>
        </div>
      </div>
      <div class="emp-c__actions">
        <button class="emp-c__act" title="${t('Editar')}" aria-label="${t('Editar')}" onclick="window._editEmp(${r.id})">${IC.edit}</button>
        <button class="emp-c__act" title="${t('Ver historial')}" aria-label="${t('Ver historial')}" onclick="window._verHistorial(${r.id})">${IC.hist}</button>
        <button class="emp-c__act" title="${t('Resetear PIN')}" aria-label="${t('Resetear PIN')}" onclick="window._resetPin(${r.id}, '${nombreJs}')">${IC.pin}</button>
        <button class="emp-c__act ${r.activo ? 'emp-c__act--danger' : 'emp-c__act--ok'}"
          title="${t(r.activo ? 'Desactivar' : 'Reactivar')}" aria-label="${t(r.activo ? 'Desactivar' : 'Reactivar')}"
          onclick="window._toggleEmp(${r.id}, ${r.activo})">${r.activo ? IC.baja : IC.alta}</button>
      </div>
    </article>`;
}

function renderEmpleados(empleados) {
  const wrap = document.getElementById('emp-grid-wrap');
  if (!wrap) return;
  empleados = filterByPlaza(empleados, e => e.plaza_id);
  wrap.innerHTML = empleados.length
    ? `<div class="emp-grid">${empleados.map(tarjetaEmp).join('')}</div>`
    : `<div class="ad-empty">${t('No hay empleados que coincidan.')}</div>`;
}

function filterTable(q) {
  const filtered = q
    ? _allEmpleados.filter(e => e.nombre.toLowerCase().includes(q.toLowerCase()))
    : _allEmpleados;
  renderEmpleados(filtered);
}

const ROLES = ['empleado', 'supervisor', 'gerente'];

// Siguiente N.º empleado: max sufijo numérico existente + 1, formato EQS-00N.
function nextNumeroEmpleado() {
  const max = _allEmpleados.reduce((m, e) => {
    const n = parseInt(String(e.numero_empleado || '').match(/\d+/)?.[0] || 0);
    return n > m ? n : m;
  }, 0);
  return 'EQS-' + String(max + 1).padStart(3, '0');
}

function openEmpForm(emp = null) {
  const isEdit = !!emp;
  const v = (k) => emp?.[k] ?? '';
  const defPlaza  = emp?.plaza_id ?? getPlazaScope();
  const plazaOpts = _plazas.map(p => `<option value="${p.id}" ${defPlaza === p.id ? 'selected' : ''}>${p.nombre}</option>`).join('');
  const puestoOpts = `<option value="">– ${t('Sin puesto')} –</option>` + _puestos.map(p => `<option value="${esc(p.nombre)}" ${emp?.puesto === p.nombre ? 'selected' : ''}>${esc(p.nombre)}</option>`).join('');
  const rolOpts   = ROLES.map(r => `<option value="${r}" ${(emp?.rol ?? 'empleado') === r ? 'selected' : ''}>${r[0].toUpperCase() + r.slice(1)}</option>`).join('');
  const numero    = isEdit ? v('numero_empleado') : nextNumeroEmpleado();

  openModal(
    isEdit ? 'Editar perfil de empleado' : 'Nuevo empleado',
    `<div class="emp-edit">
      <div class="emp-edit__photo">
        <div class="emp-edit__pic">
          <img id="e-foto-prev" src="${esc(v('foto_url'))}" alt="" ${v('foto_url') ? '' : 'hidden'}>
          <span id="e-foto-ph" class="emp-edit__ph" ${v('foto_url') ? 'hidden' : ''}>${esc(iniciales(v('nombre')))}</span>
        </div>
        <label class="emp-edit__cam" for="e-foto" title="${t('Cambiar foto')}" aria-label="${t('Cambiar foto')}">${IC.edit}</label>
        <input id="e-foto" type="file" accept="image/*" hidden>
      </div>

      <div class="emp-edit__grid">
        <div class="form-group">
          <label for="e-nombre">${t('Nombre completo')} *</label>
          <input id="e-nombre" class="form-input" value="${esc(v('nombre'))}" placeholder="Juan Pérez García">
        </div>
        <div class="form-group">
          <label for="e-num">${t('N.º empleado')}</label>
          <input id="e-num" class="form-input" value="${esc(numero)}" readonly title="${t('Se asigna automáticamente')}">
        </div>
        <div class="form-group form-group--full">
          <label for="e-puesto">${t('Puesto')}</label>
          <select id="e-puesto" class="form-input">${puestoOpts}</select>
        </div>
        <div class="form-group">
          <label for="e-email">${t('Correo')}</label>
          <input id="e-email" class="form-input" type="email" value="${esc(v('email'))}" placeholder="correo@empresa.com">
        </div>
        <div class="form-group">
          <label for="e-tel">${t('Teléfono')}</label>
          <input id="e-tel" class="form-input" type="tel" value="${esc(v('telefono'))}" placeholder="55 1234 5678">
        </div>
        <div class="form-group">
          <label for="e-ingreso">${t('Fecha de ingreso')}</label>
          <input id="e-ingreso" class="form-input" type="date" value="${esc(v('fecha_ingreso'))}">
        </div>
        <div class="form-group">
          <label for="e-rol">${t('Rol')}</label>
          <select id="e-rol" class="form-input">${rolOpts}</select>
        </div>
        <div class="form-group">
          <label for="e-plaza">${t('Plaza')} *</label>
          <select id="e-plaza" class="form-input"><option value="">– ${t('Selecciona')} –</option>${plazaOpts}</select>
        </div>
        ${!isEdit ? `<div class="form-group form-group--full">
          <label for="e-pin">${t('PIN inicial (solo números)')} *</label>
          <input id="e-pin" class="form-input" type="password" inputmode="numeric" pattern="\\d*" maxlength="10" placeholder="••••">
        </div>` : ''}
      </div>
    </div>
    <p id="e-error" class="error-inline" hidden></p>`,
    async () => {
      const nombre   = document.getElementById('e-nombre').value.trim();
      const plaza_id = parseInt(document.getElementById('e-plaza').value) || null;
      const errEl    = document.getElementById('e-error');

      if (!nombre || !plaza_id) {
        errEl.textContent = t('Nombre y Plaza son obligatorios.');
        errEl.hidden = false;
        return;
      }

      // campos de perfil (RH). Vacío → null para no machacar con "". turno se asigna en horarios.
      const datos = {
        nombre, plaza_id,
        numero_empleado: document.getElementById('e-num').value.trim()    || null,
        puesto:          document.getElementById('e-puesto').value        || null,
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
            errEl.textContent = t('El PIN debe ser numérico.');
            errEl.hidden = false;
            return;
          }
          const nuevo = await api.crearEmpleado({ p_nombre: nombre, p_pin: pin, p_plaza_id: plaza_id, p_turno_id: null });
          const id = Array.isArray(nuevo) ? nuevo[0]?.id : nuevo?.id;
          // crear_empleado sólo guarda nombre/plaza/pin; el resto va por PATCH.
          const { nombre: _n, plaza_id: _p, ...resto } = datos;
          if (id && Object.values(resto).some(Boolean)) await api.updateEmpleado(id, resto);
        }
        closeModal();
        showToast(isEdit ? 'Empleado actualizado.' : 'Empleado creado.', 'ok');
        await loadEmpleados();
      } catch (e) {
        errEl.textContent = e.message;
        errEl.hidden = false;
      }
    },
    isEdit ? 'Guardar cambios' : 'Crear empleado'
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
