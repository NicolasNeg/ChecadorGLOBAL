import * as api from './api.js';
import { renderTable, loading, showToast, openModal, closeModal, confirm } from './utils.js';

export async function init(panel) {
  panel.innerHTML = `
    <div class="panel-header">
      <h2>Puestos</h2>
      <div class="panel-header__actions">
        <button class="abtn abtn--primary" id="btn-nuevo-puesto">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Nuevo puesto
        </button>
      </div>
    </div>
    <p class="td-muted" style="margin:-4px 0 14px">Los puestos definidos aquí son las opciones disponibles al crear o editar un empleado.</p>
    <div class="ad-card"><div id="tbl-puestos-wrap"></div></div>`;

  document.getElementById('btn-nuevo-puesto').addEventListener('click', formPuesto);

  window._delPuesto = async (id, nombre) => {
    if (!await confirm(`¿Eliminar el puesto “${nombre}”? Los empleados que ya lo tengan no se modifican.`, { ok: 'Eliminar' })) return;
    try {
      await api.deletePuesto(id);
      showToast('Puesto eliminado.', 'ok');
      await load();
    } catch (e) { showToast(e.message, 'error'); }
  };

  await load();
}

async function load() {
  const wrap = document.getElementById('tbl-puestos-wrap');
  loading(wrap);
  try {
    const puestos = await api.getPuestos();
    renderTable(
      wrap,
      [{ key: 'nombre', label: 'Puesto' }],
      puestos,
      (r) => `
        <button class="abtn abtn--danger abtn--icon" title="Eliminar" onclick="window._delPuesto(${r.id}, '${r.nombre.replace(/'/g, "\\'")}')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/></svg>
        </button>`
    );
  } catch (e) {
    wrap.innerHTML = `<div class="ad-empty" style="color:#DC2626">${e.message}</div>`;
  }
}

function formPuesto() {
  openModal('Nuevo puesto',
    `<div class="form-group">
      <label for="p-nombre">Nombre del puesto *</label>
      <input id="p-nombre" class="form-input" placeholder="Cajero" autocomplete="off">
    </div>
    <p id="p-error" class="error-inline" hidden></p>`,
    async () => {
      const nombre = document.getElementById('p-nombre').value.trim();
      const errEl  = document.getElementById('p-error');
      if (!nombre) { errEl.textContent = 'Escribe un nombre.'; errEl.hidden = false; return; }
      try {
        await api.createPuesto(nombre);
        closeModal();
        showToast('Puesto creado.', 'ok');
        await load();
      } catch (e) {
        errEl.textContent = /duplicate|unique/i.test(e.message) ? 'Ese puesto ya existe.' : e.message;
        errEl.hidden = false;
      }
    },
    'Crear puesto'
  );
}
