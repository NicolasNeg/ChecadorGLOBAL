import * as api from './api.js';
import { loading, showToast, openModal, closeModal, confirm, esc } from './utils.js';
import { t } from '../i18n.js';

export async function init(panel) {
  panel.innerHTML = `
    <div class="panel-header">
      <h2>${t('Puestos')}</h2>
      <div class="panel-header__actions">
        <button class="abtn abtn--primary" id="btn-nuevo-puesto">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          ${t('Nuevo puesto')}
        </button>
      </div>
    </div>
    <p class="td-muted" style="margin:-4px 0 14px">${t('Puesto y rol son el mismo conjunto. Cada puesto muestra los empleados que lo tienen.')}</p>
    <div id="tbl-puestos-wrap"></div>`;

  document.getElementById('btn-nuevo-puesto').addEventListener('click', formPuesto);

  window._delPuesto = async (id, nombre) => {
    if (!await confirm(`${t('¿Eliminar el puesto?')} “${nombre}” — ${t('Los empleados que ya lo tengan no se modifican.')}`, { ok: 'Eliminar' })) return;
    try {
      await api.deletePuesto(id);
      showToast('Puesto eliminado.', 'ok');
      await load();
    } catch (e) { showToast(e.message, 'error'); }
  };

  window._addPuestoCat = async (nombre) => {
    try {
      await api.createPuesto(nombre);
      showToast('Puesto agregado al catálogo.', 'ok');
      await load();
    } catch (e) { showToast(e.message, 'error'); }
  };

  window._editPuesto = (id) => {
    const p = _catalogo.find((x) => x.id === id);
    if (p) formPuesto(p);
  };

  await load();
}

const norm = (s) => (s ?? '').trim();
let _catalogo = []; // catálogo de puestos cacheado para el modal de edición

async function load() {
  const wrap = document.getElementById('tbl-puestos-wrap');
  loading(wrap);
  try {
    const [puestos, empleados] = await Promise.all([api.getPuestos(), api.getEmpleados()]);
    _catalogo = puestos;
    renderDesglose(wrap, puestos, empleados);
  } catch (e) {
    wrap.innerHTML = `<div class="ad-empty" style="color:#DC2626">${esc(e.message)}</div>`;
  }
}

// Une el catálogo de puestos con los puestos presentes en empleados (mismo
// conjunto): cada grupo lista a sus empleados. Los que están en empleados pero
// no en el catálogo se marcan "fuera de catálogo" y se pueden agregar.
function renderDesglose(wrap, puestos, empleados) {
  const SIN = t('Sin puesto');
  const grupos = new Map();
  for (const p of puestos) grupos.set(p.nombre, { ...p, adHoc: false, emps: [] });
  for (const e of empleados) {
    const key = norm(e.puesto) || SIN;
    if (!grupos.has(key)) grupos.set(key, { nombre: key, id: null, adHoc: key !== SIN, sin: key === SIN, emps: [] });
    grupos.get(key).emps.push(e);
  }

  // Orden alfabético; "Sin puesto" siempre al final.
  const filas = [...grupos.values()].sort((a, b) =>
    (a.sin ? 1 : 0) - (b.sin ? 1 : 0) || a.nombre.localeCompare(b.nombre, 'es'));

  if (!filas.length) { wrap.innerHTML = `<div class="ad-empty">${t('Sin puestos.')}</div>`; return; }

  wrap.innerHTML = `<div class="puesto-acc">${filas.map((g) => {
    const activos = g.emps.filter((e) => e.activo).length;
    const safe = g.nombre.replace(/'/g, "\\'");
    const dot = g.color ? `<span class="puesto-row__dot" style="background:${esc(g.color)}"></span>` : '';
    const metas = [
      g.area  ? `<span class="puesto-meta"><span class="puesto-meta__k">${t('Área')}</span>${esc(g.area)}</span>` : '',
      g.nivel ? `<span class="puesto-meta"><span class="puesto-meta__k">${t('Nivel')}</span>${esc(g.nivel)}</span>` : '',
    ].join('');
    return `<details class="ad-card puesto-row">
      <summary class="puesto-row__sum">
        <svg class="puesto-row__chev" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
        ${dot}
        <span class="puesto-row__name">${esc(g.nombre)}</span>
        ${g.area ? `<span class="abadge abadge--gray">${esc(g.area)}</span>` : ''}
        ${g.adHoc ? `<span class="abadge abadge--orange" title="${t('Existe en empleados pero no en el catálogo')}">${t('Fuera de catálogo')}</span>` : ''}
        <span class="abadge abadge--gray puesto-row__count">${g.emps.length} ${t(g.emps.length === 1 ? 'empleado' : 'empleados')}${activos !== g.emps.length ? ` · ${activos} ${t('activos')}` : ''}</span>
        <span class="puesto-row__acts">
          ${g.adHoc ? `<button class="abtn abtn--ghost abtn--icon" title="${t('Agregar al catálogo')}" onclick="event.stopPropagation();window._addPuestoCat('${safe}')">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          </button>` : ''}
          ${g.id ? `<button class="abtn abtn--ghost abtn--icon" title="${t('Editar')}" onclick="event.stopPropagation();window._editPuesto(${g.id})">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
          </button>` : ''}
          ${g.id ? `<button class="abtn abtn--danger abtn--icon" title="${t('Eliminar')}" onclick="event.stopPropagation();window._delPuesto(${g.id}, '${safe}')">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/></svg>
          </button>` : ''}
        </span>
      </summary>
      <div class="puesto-row__body">
        ${g.descripcion ? `<p class="puesto-row__desc">${esc(g.descripcion)}</p>` : ''}
        ${metas ? `<div class="puesto-metas">${metas}</div>` : ''}
        ${g.permisos ? `<div class="puesto-perms"><span class="puesto-meta__k">${t('Permisos')}</span><p>${esc(g.permisos)}</p></div>` : ''}
        ${g.emps.length
          ? `<div class="puesto-chips">${g.emps.map((e) => `<span class="puesto-chip${e.activo ? '' : ' is-inactive'}">${esc(e.nombre)}${e.numero_empleado ? ` <span class="puesto-chip__num">${esc(e.numero_empleado)}</span>` : ''}</span>`).join('')}</div>`
          : `<p class="ad-empty" style="padding:4px 0">${t('Sin empleados con este puesto.')}</p>`}
      </div>
    </details>`;
  }).join('')}</div>`;
}

function formPuesto(p = null) {
  const v = (k) => esc(p?.[k] ?? '');
  openModal(p ? 'Editar puesto' : 'Nuevo puesto',
    `<div class="form-row" style="grid-template-columns:1fr auto">
      <div class="form-group">
        <label for="p-nombre">${t('Nombre del puesto')} *</label>
        <input id="p-nombre" class="form-input" placeholder="${t('Cajero')}" autocomplete="off" value="${v('nombre')}">
      </div>
      <div class="form-group">
        <label for="p-color">${t('Color')}</label>
        <input id="p-color" type="color" class="form-input form-input--color" value="${p?.color || '#2563EB'}">
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label for="p-area">${t('Área')}</label>
        <input id="p-area" class="form-input" placeholder="${t('Operaciones')}" autocomplete="off" value="${v('area')}">
      </div>
      <div class="form-group">
        <label for="p-nivel">${t('Nivel')}</label>
        <input id="p-nivel" class="form-input" placeholder="${t('Junior / Senior / Gerencial')}" autocomplete="off" value="${v('nivel')}">
      </div>
    </div>
    <div class="form-group">
      <label for="p-desc">${t('Descripción')}</label>
      <textarea id="p-desc" class="form-input" rows="2" placeholder="${t('¿Qué hace este puesto?')}">${v('descripcion')}</textarea>
    </div>
    <div class="form-group">
      <label for="p-perms">${t('Permisos / responsabilidades')}</label>
      <textarea id="p-perms" class="form-input" rows="2" placeholder="${t('Ej. aprueba vacaciones, maneja caja…')}">${v('permisos')}</textarea>
      <small class="form-help">${t('Informativo: se muestra en el puesto, no controla accesos.')}</small>
    </div>
    <p id="p-error" class="error-inline" hidden></p>`,
    async () => {
      const datos = {
        nombre:      document.getElementById('p-nombre').value.trim(),
        color:       document.getElementById('p-color').value || null,
        area:        document.getElementById('p-area').value.trim() || null,
        nivel:       document.getElementById('p-nivel').value.trim() || null,
        descripcion: document.getElementById('p-desc').value.trim() || null,
        permisos:    document.getElementById('p-perms').value.trim() || null,
      };
      const errEl = document.getElementById('p-error');
      if (!datos.nombre) { errEl.textContent = t('Escribe un nombre.'); errEl.hidden = false; return; }
      try {
        if (p?.id) await api.updatePuesto(p.id, datos);
        else       await api.createPuesto(datos);
        closeModal();
        showToast(p ? 'Puesto actualizado.' : 'Puesto creado.', 'ok');
        await load();
      } catch (e) {
        errEl.textContent = /duplicate|unique/i.test(e.message) ? t('Ese puesto ya existe.') : e.message;
        errEl.hidden = false;
      }
    },
    p ? 'Guardar cambios' : 'Crear puesto'
  );
}
