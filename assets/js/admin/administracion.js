import * as api from './api.js';
import { showToast, esc } from './utils.js';
import { t } from '../i18n.js';

// Ajustes del trabajo a nivel empresa. clave → {label, hint, type}.
// ponytail: 3 ajustes KV; añade filas aquí cuando el negocio pida más.
const CAMPOS = [
  ['nombre_empresa',         'Nombre de la empresa',     'Aparece en el panel y los reportes.', 'text'],
  ['empresa_direccion',      'Dirección de la empresa',  'Aparece en el encabezado de los reportes impresos.', 'text'],
  ['empresa_rfc',            'RFC',                       'Aparece en el encabezado de los reportes impresos.', 'text'],
  ['tolerancia_retardo_min', 'Tolerancia de retardo (min)', 'Minutos de gracia antes de marcar retardo.', 'number'],
  ['jornada_horas',          'Jornada estándar (horas)',  'Horas esperadas por turno completo.', 'number'],
];

export async function init(panel) {
  panel.innerHTML = `
    <div class="panel-header"><h2>${t('Administración')}</h2></div>
    <p class="td-muted" style="margin:-4px 0 14px">${t('Ajustes que aplican a todo el trabajo.')}</p>
    <div class="ad-card"><div class="ad-card__body" id="admin-cfg">
      <div class="ad-loading"><div class="ad-spinner"></div> ${t('Cargando…')}</div>
    </div></div>`;

  const wrap = document.getElementById('admin-cfg');
  let cfg = {};
  try {
    cfg = Object.fromEntries((await api.getConfigGlobal()).map(c => [c.clave, c.valor]));
  } catch (e) {
    wrap.innerHTML = `<div class="ad-empty" style="color:#DC2626">${esc(e.message)}</div>`;
    return;
  }

  wrap.innerHTML = CAMPOS.map(([clave, label, hint, type]) => `
    <div class="setting-row">
      <div>
        <label class="setting-row__label" for="cfg-${clave}">${t(label)}</label>
        <div class="setting-row__hint">${t(hint)}</div>
      </div>
      <input id="cfg-${clave}" class="form-input setting-row__input" type="${type}"${type === 'number' ? ' min="0"' : ''} value="${esc(cfg[clave] ?? '')}">
    </div>`).join('') +
    `<div class="setting-row">
      <div>
        <label class="setting-row__label">${t('Logo de la empresa')}</label>
        <div class="setting-row__hint">${t('Aparece en el encabezado de los reportes impresos.')}</div>
      </div>
      <div style="display:flex;align-items:center;gap:10px">
        <img id="cfg-logo-img" src="${esc(cfg.empresa_logo_url ?? '')}" alt="" style="height:44px;width:auto;object-fit:contain;border:1px solid var(--ad-linea);border-radius:6px;background:#fff;padding:2px"${cfg.empresa_logo_url ? '' : ' hidden'}>
        <label class="abtn" style="cursor:pointer;margin:0">${t('Subir logo')}<input type="file" id="cfg-logo-file" accept="image/*" hidden></label>
      </div>
    </div>` +
    `<div class="setting-row" style="justify-content:flex-end">
      <button class="abtn abtn--primary" id="cfg-save">${t('Guardar cambios')}</button>
    </div>`;

  document.getElementById('cfg-logo-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { showToast(t('Sube una imagen.'), 'error'); return; }
    try {
      const url = await api.subirFotoPerfil(file); // reusa el bucket público 'fotos'
      await api.setConfigGlobal('empresa_logo_url', url);
      cfg.empresa_logo_url = url;
      const img = document.getElementById('cfg-logo-img');
      img.src = url; img.hidden = false;
      showToast('Logo guardado.', 'ok');
    } catch (err) { showToast(err.message, 'error'); }
  });

  document.getElementById('cfg-save').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true; btn.textContent = t('Guardando…');
    try {
      // Solo persiste lo que cambió.
      const cambios = CAMPOS
        .map(([clave]) => [clave, document.getElementById(`cfg-${clave}`).value.trim()])
        .filter(([clave, val]) => val !== (cfg[clave] ?? ''));
      await Promise.all(cambios.map(([clave, val]) => api.setConfigGlobal(clave, val)));
      cambios.forEach(([clave, val]) => { cfg[clave] = val; });
      showToast(cambios.length ? 'Ajustes guardados.' : 'Sin cambios.', 'ok');
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      btn.disabled = false; btn.textContent = t('Guardar cambios');
    }
  });
}
