import * as api from './api.js';
import { loading, showToast, openModal, closeModal, confirm, esc, DEFAULT_PFP } from './utils.js';
import { t } from '../i18n.js';
import { getAdminSession } from './auth.js';
import { puede, miNivel, soyGlobal } from './permisos.js';
import { rolesAsignables, defaultDelRol, estadoEfectivo, accionTriestado } from './permisos-matriz.mjs';

let _plazas = [];
let _roles = [];           // catálogo de roles (clave, nombre, nivel, es_global)
let _permisos = [];        // catálogo de permisos (clave, zona, descripcion)
let _rolPermisos = [];     // defaults por rol
let _emailsChecador = new Set();

const rolNombre = (clave) => _roles.find(r => r.clave === clave)?.nombre ?? clave;
const rolEsGlobal = (clave) => _roles.find(r => r.clave === clave)?.es_global === true;

export async function init(panel) {
  panel.innerHTML = `
    <div class="panel-header">
      <h2>${t('Usuarios')}</h2>
      <div class="panel-header__actions">
        ${puede('usuarios.crear') ? `<button class="abtn abtn--primary" id="btn-nuevo-admin">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          ${t('Nuevo administrador')}
        </button>` : ''}
      </div>
    </div>
    <p class="td-muted" style="margin:-4px 0 14px">${t('Administra quién puede acceder al panel: rol, plaza, permisos y contraseña.')}</p>
    <div class="ad-card"><div id="tbl-usuarios-wrap"></div></div>`;

  document.getElementById('btn-nuevo-admin')?.addEventListener('click', () => formAdmin(null));
  await load();
}

async function load() {
  const wrap = document.getElementById('tbl-usuarios-wrap');
  loading(wrap);
  try {
    const [perfiles, plazas, empleados, roles, permisos, rolPermisos] = await Promise.all([
      api.getPerfilesAdmin(), api.getPlazas(), api.getEmpleados().catch(() => []),
      api.getRoles(), api.getPermisosCat(), api.getRolPermisos(),
    ]);
    _plazas = plazas; _roles = roles; _permisos = permisos; _rolPermisos = rolPermisos;
    _emailsChecador = new Set(empleados.filter(e => e.email).map(e => e.email.toLowerCase()));
    renderUsuarios(wrap, perfiles);
  } catch (e) {
    wrap.innerHTML = `<div class="ad-empty" style="color:#DC2626">${esc(e.message)}</div>`;
  }
}

// ¿Puedo gestionar este perfil? (espejo de puede_gestionar en SQL, para la UI).
function gestionable(p) {
  const yo = getAdminSession()?.id;
  if (p.id === yo) return false;
  const nivelObj = _roles.find(r => r.clave === p.rol)?.nivel ?? 0;
  return nivelObj < miNivel() && (soyGlobal() || p.plaza_id === getAdminSession()?.plaza_id);
}

function renderUsuarios(wrap, perfiles) {
  if (!perfiles.length) { wrap.innerHTML = `<div class="ad-empty">${t('Sin administradores.')}</div>`; return; }
  const yo = getAdminSession()?.id;
  wrap.innerHTML = `<div class="table-scroll"><table class="data-table">
    <thead><tr>
      <th>${t('Nombre')}</th><th>${t('Correo')}</th><th>${t('Rol')}</th>
      <th>${t('Plaza')}</th><th>${t('Estado')}</th><th style="width:120px">${t('Acciones')}</th>
    </tr></thead><tbody>
    ${perfiles.map(p => {
      const enChecador = p.email && _emailsChecador.has(p.email.toLowerCase());
      const esYo = p.id === yo;
      const editable = gestionable(p);
      return `<tr data-id="${p.id}"${p.activo ? '' : ' class="is-inactive"'}>
        <td data-label="${t('Nombre')}"><div class="u-cell">
          <img class="u-avatar" src="${esc(p.foto_url || DEFAULT_PFP)}" alt="">
          <div><div class="u-name">${esc(p.nombre)}${esYo ? ` <span class="abadge abadge--blue">${t('Tú')}</span>` : ''}</div>
            ${enChecador ? `<span class="abadge abadge--green" title="${t('También usa el checador')}">CHECADOR</span>` : ''}
          </div>
        </div></td>
        <td data-label="${t('Correo')}">${esc(p.email)}</td>
        <td data-label="${t('Rol')}">${esc(t(rolNombre(p.rol)))}</td>
        <td data-label="${t('Plaza')}">${esc(p.plazas?.nombre ?? (rolEsGlobal(p.rol) ? t('Global') : '—'))}</td>
        <td data-label="${t('Estado')}"><span class="abadge abadge--${p.activo ? 'green' : 'red'}">${t(p.activo ? 'Activo' : 'Inactivo')}</span></td>
        <td data-label="${t('Acciones')}"><div class="actions">
          ${editable ? `<button class="abtn abtn--ghost abtn--icon" title="${t('Editar')}" onclick="window._editAdmin('${p.id}')">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z"/></svg>
          </button>
          <button class="abtn abtn--ghost abtn--icon" title="${t('Permisos')}" onclick="window._permsAdmin('${p.id}')">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
          </button>` : ''}
          <button class="abtn abtn--ghost abtn--icon" title="${t('Enviar correo de contraseña')}" onclick="window._resetAdmin('${esc(p.email)}')">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 5L2 7"/></svg>
          </button>
        </div></td>
      </tr>`;
    }).join('')}
    </tbody></table></div>`;

  window._editAdmin  = (id) => formAdmin(perfiles.find(p => p.id === id));
  window._permsAdmin = (id) => formPermisos(perfiles.find(p => p.id === id));
  window._resetAdmin = async (email) => {
    if (!await confirm(`${t('Enviar correo de restablecimiento a')} ${email}?`, { ok: t('Enviar'), danger: false })) return;
    try { await api.enviarResetPassword(email); showToast('Correo enviado.', 'ok'); }
    catch (e) { showToast(e.message, 'error'); }
  };
}

function plazaOpts(sel) {
  return [`<option value="">${t('Sin plaza')}</option>`,
    ..._plazas.map(p => `<option value="${p.id}"${p.id === sel ? ' selected' : ''}>${esc(p.nombre)}</option>`)].join('');
}

// Modal crear/editar. Solo ofrece roles de nivel inferior al del gestor.
function formAdmin(perfil) {
  const editar = !!perfil;
  const asignables = rolesAsignables(_roles, miNivel());
  if (!asignables.length) { showToast(t('No tienes nivel para crear o editar usuarios.'), 'error'); return; }
  const rolOpts = asignables.map(r =>
    `<option value="${r.clave}"${perfil?.rol === r.clave ? ' selected' : ''}>${esc(t(r.nombre))}</option>`).join('');

  openModal(editar ? 'Editar administrador' : 'Nuevo administrador',
    `<div class="form-group">
      <label for="u-nombre">${t('Nombre')} *</label>
      <input id="u-nombre" class="form-input" autocomplete="off" value="${esc(perfil?.nombre ?? '')}">
    </div>
    <div class="form-group">
      <label for="u-email">${t('Correo')} *</label>
      <input id="u-email" type="email" class="form-input" autocomplete="off" value="${esc(perfil?.email ?? '')}"${editar ? ' disabled' : ''}>
      ${editar ? '' : `<p class="setting-row__hint">${t('Se enviará un correo para que defina su contraseña.')}</p>`}
    </div>
    <div class="form-row">
      <div class="form-group">
        <label for="u-rol">${t('Rol')} *</label>
        <select id="u-rol" class="form-input">${rolOpts}</select>
      </div>
      <div class="form-group">
        <label for="u-plaza">${t('Plaza')}</label>
        <select id="u-plaza" class="form-input">${plazaOpts(perfil?.plaza_id)}</select>
      </div>
    </div>
    <div class="form-group">
      <label for="u-foto">${t('Foto')}</label>
      <input id="u-foto" type="file" accept="image/*" class="form-input">
    </div>
    ${editar ? `<label class="u-check"><input type="checkbox" id="u-activo"${perfil?.activo ? ' checked' : ''}> ${t('Cuenta activa')}</label>` : ''}
    <p id="u-error" class="error-inline" hidden></p>`,
    async () => {
      const nombre = document.getElementById('u-nombre').value.trim();
      const email  = document.getElementById('u-email').value.trim();
      const rol    = document.getElementById('u-rol').value;
      const plaza_id = parseInt(document.getElementById('u-plaza').value) || null;
      const errEl  = document.getElementById('u-error');
      const fail = (m) => { errEl.textContent = m; errEl.hidden = false; };

      if (!nombre) return fail(t('Escribe un nombre.'));
      if (!editar && !email) return fail(t('Escribe un correo.'));
      // Rol no-global exige plaza (espejo del CHECK jefe_necesita_plaza + scope).
      if (!rolEsGlobal(rol) && !plaza_id) return fail(t('Este rol necesita una plaza asignada.'));

      try {
        let foto_url = perfil?.foto_url ?? null;
        const file = document.getElementById('u-foto').files[0];
        if (file) foto_url = await api.subirFotoPerfil(file);

        if (editar) {
          const activo = document.getElementById('u-activo').checked;
          await api.updatePerfilAdmin(perfil.id, { nombre, rol, plaza_id, activo, foto_url });
          showToast('Administrador actualizado.', 'ok');
        } else {
          const pwTemp = crypto.randomUUID();
          const id = await api.crearCuentaAuth(email, pwTemp);
          await api.createPerfilAdmin({ id, nombre, email, rol, plaza_id, foto_url });
          await api.enviarResetPassword(email);
          showToast('Administrador creado. Se envió el correo de contraseña.', 'ok');
        }
        closeModal();
        await load();
      } catch (e) { fail(e.message); }
    },
    editar ? 'Guardar' : 'Crear administrador'
  );
}

// Editor de permisos por usuario: matriz tri-estado. Solo muestra llaves que el
// gestor posee (no puedes delegar lo que no tienes). Escribe en perfil_permisos.
async function formPermisos(perfil) {
  let perfilPermisos = [];
  try { perfilPermisos = await api.getPerfilPermisos(perfil.id); }
  catch (e) { showToast(e.message, 'error'); return; }

  // Llaves visibles = las que el gestor posee (puede() lee la sesión).
  const visibles = _permisos.filter(pm => puede(pm.clave));
  if (!visibles.length) { showToast(t('No tienes permisos delegables.'), 'error'); return; }

  // Agrupa por zona para una matriz legible.
  const zonas = [...new Set(visibles.map(p => p.zona))];
  const ESTADO_LBL = { hereda: 'Hereda', concedido: 'Concedido', revocado: 'Revocado' };
  const ESTADO_CLS = { hereda: 'gray', concedido: 'green', revocado: 'red' };

  const celda = (pm) => {
    const est = estadoEfectivo(pm.clave, perfil.rol, _rolPermisos, perfilPermisos);
    const def = defaultDelRol(pm.clave, perfil.rol, _rolPermisos);
    return `<button class="pmx-cell" data-clave="${pm.clave}" data-estado="${est}">
      <span class="abadge abadge--${ESTADO_CLS[est]}">${t(ESTADO_LBL[est])}</span>
      <small class="pmx-def">${t('Rol')}: ${def ? t('Sí') : t('No')}</small>
    </button>`;
  };

  openModal(`${t('Permisos de')} ${esc(perfil.nombre)}`,
    `<p class="td-muted" style="margin:0 0 12px">${t('Clic para alternar: hereda del rol → concedido → revocado. Solo puedes ajustar los permisos que tú posees.')}</p>
     <div class="pmx">${zonas.map(z => `
       <div class="pmx-zona"><h4>${esc(t(z))}</h4>
         <div class="pmx-keys">${visibles.filter(p => p.zona === z).map(celda).join('')}</div>
       </div>`).join('')}</div>`,
    closeModal, 'Cerrar');

  // Listener delegado: cada clic avanza el tri-estado y persiste.
  document.querySelector('.pmx')?.addEventListener('click', async (e) => {
    const btn = e.target.closest('.pmx-cell');
    if (!btn || btn.disabled) return;
    const clave = btn.dataset.clave;
    const nuevo = accionTriestado(btn.dataset.estado);
    btn.disabled = true;
    try {
      if (nuevo === 'hereda') await api.deletePerfilPermiso(perfil.id, clave);
      else await api.setPerfilPermiso(perfil.id, clave, nuevo === 'concedido');
      btn.dataset.estado = nuevo;
      const badge = btn.querySelector('.abadge');
      badge.className = `abadge abadge--${ESTADO_CLS[nuevo]}`;
      badge.textContent = t(ESTADO_LBL[nuevo]);
    } catch (err) { showToast(err.message, 'error'); }
    finally { btn.disabled = false; }
  });
}
