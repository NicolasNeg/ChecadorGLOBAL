import * as api from './api.js';
import { loading, showToast, openModal, closeModal, confirm, esc } from './utils.js';
import { t } from '../i18n.js';
import { getAdminSession } from './auth.js';

const ROLES = [['rh', 'Recursos Humanos'], ['jefe', 'Jefe de Plaza']];

let _plazas = [];
let _emailsChecador = new Set(); // emails que también tienen usuario en CHECADOR

export async function init(panel) {
  panel.innerHTML = `
    <div class="panel-header">
      <h2>${t('Usuarios')}</h2>
      <div class="panel-header__actions">
        <button class="abtn abtn--primary" id="btn-nuevo-admin">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          ${t('Nuevo administrador')}
        </button>
      </div>
    </div>
    <p class="td-muted" style="margin:-4px 0 14px">${t('Administra quién puede acceder al panel: rol, plaza, foto y contraseña.')}</p>
    <div class="ad-card"><div id="tbl-usuarios-wrap"></div></div>`;

  document.getElementById('btn-nuevo-admin').addEventListener('click', () => formAdmin(null));
  await load();
}

async function load() {
  const wrap = document.getElementById('tbl-usuarios-wrap');
  loading(wrap);
  try {
    const [perfiles, plazas, empleados] = await Promise.all([
      api.getPerfilesAdmin(), api.getPlazas(), api.getEmpleados().catch(() => [])
    ]);
    _plazas = plazas;
    _emailsChecador = new Set(empleados.filter(e => e.email).map(e => e.email.toLowerCase()));
    renderUsuarios(wrap, perfiles);
  } catch (e) {
    wrap.innerHTML = `<div class="ad-empty" style="color:#DC2626">${esc(e.message)}</div>`;
  }
}

const rolLabel = (r) => t(Object.fromEntries(ROLES)[r] ?? r);

function renderUsuarios(wrap, perfiles) {
  if (!perfiles.length) { wrap.innerHTML = `<div class="ad-empty">${t('Sin administradores.')}</div>`; return; }
  const yo = getAdminSession()?.id;
  wrap.innerHTML = `<div class="table-scroll"><table class="data-table">
    <thead><tr>
      <th>${t('Nombre')}</th><th>${t('Correo')}</th><th>${t('Rol')}</th>
      <th>${t('Plaza')}</th><th>${t('Estado')}</th><th style="width:100px">${t('Acciones')}</th>
    </tr></thead><tbody>
    ${perfiles.map(p => {
      const inicial = (p.nombre?.trim().charAt(0) || 'A').toUpperCase();
      const enChecador = p.email && _emailsChecador.has(p.email.toLowerCase());
      const esYo = p.id === yo;
      return `<tr data-id="${p.id}"${p.activo ? '' : ' class="is-inactive"'}>
        <td data-label="${t('Nombre')}"><div class="u-cell">
          ${p.foto_url ? `<img class="u-avatar" src="${esc(p.foto_url)}" alt="">` : `<span class="u-avatar u-avatar--ph">${esc(inicial)}</span>`}
          <div><div class="u-name">${esc(p.nombre)}${esYo ? ` <span class="abadge abadge--blue">${t('Tú')}</span>` : ''}</div>
            ${p.es_admin_global ? `<span class="abadge abadge--violet">ADMIN_GLOBAL</span>` : ''}
            ${enChecador ? `<span class="abadge abadge--green" title="${t('También usa el checador')}">CHECADOR</span>` : ''}
          </div>
        </div></td>
        <td data-label="${t('Correo')}">${esc(p.email)}</td>
        <td data-label="${t('Rol')}">${rolLabel(p.rol)}</td>
        <td data-label="${t('Plaza')}">${esc(p.plazas?.nombre ?? '—')}</td>
        <td data-label="${t('Estado')}"><span class="abadge abadge--${p.activo ? 'green' : 'red'}">${t(p.activo ? 'Activo' : 'Inactivo')}</span></td>
        <td data-label="${t('Acciones')}"><div class="actions">
          <button class="abtn abtn--ghost abtn--icon" title="${t('Editar')}" onclick="window._editAdmin('${p.id}')">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z"/></svg>
          </button>
          <button class="abtn abtn--ghost abtn--icon" title="${t('Enviar correo de contraseña')}" onclick="window._resetAdmin('${esc(p.email)}')">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 5L2 7"/></svg>
          </button>
        </div></td>
      </tr>`;
    }).join('')}
    </tbody></table></div>`;

  window._editAdmin  = (id) => formAdmin(perfiles.find(p => p.id === id));
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

// Modal único para crear/editar. perfil=null ⇒ crear (incluye cuenta de acceso).
function formAdmin(perfil) {
  const editar = !!perfil;
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
        <select id="u-rol" class="form-input">${ROLES.map(([v, l]) => `<option value="${v}"${perfil?.rol === v ? ' selected' : ''}>${t(l)}</option>`).join('')}</select>
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
    <label class="u-check"><input type="checkbox" id="u-global"${perfil?.es_admin_global ? ' checked' : ''}> ${t('Administrador global (acceso a Usuarios y Administración)')}</label>
    ${editar ? `<label class="u-check"><input type="checkbox" id="u-activo"${perfil?.activo ? ' checked' : ''}> ${t('Cuenta activa')}</label>` : ''}
    <p id="u-error" class="error-inline" hidden></p>`,
    async () => {
      const nombre = document.getElementById('u-nombre').value.trim();
      const email  = document.getElementById('u-email').value.trim();
      const rol    = document.getElementById('u-rol').value;
      const plaza_id = parseInt(document.getElementById('u-plaza').value) || null;
      const es_admin_global = document.getElementById('u-global').checked;
      const errEl  = document.getElementById('u-error');
      const fail = (m) => { errEl.textContent = m; errEl.hidden = false; };

      if (!nombre) return fail(t('Escribe un nombre.'));
      if (!editar && !email) return fail(t('Escribe un correo.'));
      // jefe sin plaza viola el CHECK de perfiles_admin (rol='rh' o plaza_id no nulo).
      if (rol === 'jefe' && !plaza_id) return fail(t('Un jefe de plaza necesita una plaza asignada.'));

      try {
        let foto_url = perfil?.foto_url ?? null;
        const file = document.getElementById('u-foto').files[0];
        if (file) foto_url = await api.subirFotoPerfil(file);

        if (editar) {
          const activo = document.getElementById('u-activo').checked;
          await api.updatePerfilAdmin(perfil.id, { nombre, rol, plaza_id, es_admin_global, activo, foto_url });
          showToast('Administrador actualizado.', 'ok');
        } else {
          const pwTemp = crypto.randomUUID(); // contraseña temporal; el admin la cambia por el correo
          const id = await api.crearCuentaAuth(email, pwTemp);
          await api.createPerfilAdmin({ id, nombre, email, rol, plaza_id, es_admin_global, foto_url });
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
