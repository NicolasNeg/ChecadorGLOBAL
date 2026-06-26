// Panel de avisos: lista los avisos con miniatura y vigencia, y abre el editor
// drag-and-drop para crear/editar. El borrado y el activar/desactivar van por la
// API admin (RLS por rol). El render del PNG y el guardado viven en el editor.
import * as api from './api.js';
import { showToast } from './utils.js';
import { t } from '../i18n.js';
import { avisoVigente } from './aviso-modelo.mjs';
import { abrirEditor } from './aviso-editor.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const hoy = () => new Date().toISOString().slice(0, 10);
const fmtFecha = (d) => d ? new Date(d + 'T00:00:00').toLocaleDateString('es-MX', { day: '2-digit', month: 'short' }) : null;

function vigencia(a) {
  const ini = fmtFecha(a.inicia_en), fin = fmtFecha(a.termina_en);
  if (ini && fin) return `${ini} – ${fin}`;
  if (ini) return `${t('Desde')} ${ini}`;
  if (fin) return `${t('Hasta')} ${fin}`;
  return t('Permanente');
}

function estado(a) {
  if (!a.activo) return { cls: 'off', txt: t('Inactivo') };
  if (avisoVigente(a, hoy())) return { cls: 'on', txt: t('Vigente') };
  if (a.inicia_en && hoy() < a.inicia_en) return { cls: 'prog', txt: t('Programado') };
  return { cls: 'venc', txt: t('Vencido') };
}

export async function init(panel) {
  panel.innerHTML = `
    <div class="panel-header">
      <h2>${t('Avisos')}</h2>
      <div class="panel-header__actions">
        <button id="av-nuevo" class="abtn abtn--primary">+ ${t('Nuevo aviso')}</button>
      </div>
    </div>
    <p class="td-muted" style="margin:-4px 0 14px">${t('Diseña anuncios y muéstralos a los empleados en su tablón. El móvil los ve como imagen.')}</p>
    <div id="av-lista" class="av-grid"><div class="ad-empty">${t('Cargando…')}</div></div>`;

  const lista = panel.querySelector('#av-lista');
  let plazas = [];

  async function recargar() {
    let avisos;
    try { [avisos, plazas] = await Promise.all([api.getAvisos(), plazas.length ? Promise.resolve(plazas) : api.getPlazas()]); }
    catch (e) { lista.innerHTML = `<div class="ad-empty" style="color:#DC2626">${esc(e.message)}</div>`; return; }
    if (!Array.isArray(avisos)) avisos = [];
    if (!avisos.length) { lista.innerHTML = `<div class="ad-empty">${t('Aún no hay avisos. Crea el primero.')}</div>`; return; }

    lista.innerHTML = avisos.map((a) => {
      const e = estado(a);
      const thumb = a.imagen_url
        ? `<img class="av-card__img" src="${esc(a.imagen_url)}" alt="${esc(a.titulo)}" loading="lazy">`
        : `<div class="av-card__img av-card__img--vacio">${t('Sin imagen')}</div>`;
      return `<article class="av-card" data-id="${a.id}">
        ${thumb}
        <div class="av-card__body">
          <div class="av-card__head">
            <h4 class="av-card__titulo">${esc(a.titulo)}</h4>
            <span class="av-badge av-badge--${e.cls}">${e.txt}</span>
          </div>
          <p class="av-card__meta">${esc(a.plazas?.nombre || t('Todas las plazas'))} · ${vigencia(a)}</p>
          <div class="av-card__acc">
            <button class="abtn abtn--sm" data-acc="editar">${t('Editar')}</button>
            <button class="abtn abtn--sm" data-acc="toggle">${a.activo ? t('Desactivar') : t('Activar')}</button>
            <button class="abtn abtn--sm abtn--danger" data-acc="borrar">${t('Eliminar')}</button>
          </div>
        </div>
      </article>`;
    }).join('');

    lista.querySelectorAll('.av-card').forEach((card) => {
      const a = avisos.find((x) => x.id === card.dataset.id);
      card.querySelector('[data-acc="editar"]').onclick = () =>
        abrirEditor(panel, { aviso: a, plazas, onClose: () => init(panel) });
      card.querySelector('[data-acc="toggle"]').onclick = async () => {
        try { await api.updateAviso(a.id, { activo: !a.activo }); recargar(); }
        catch (e) { showToast(e.message, 'error'); }
      };
      card.querySelector('[data-acc="borrar"]').onclick = async () => {
        if (!confirm(t('¿Eliminar este aviso?'))) return;
        try { await api.deleteAviso(a.id); recargar(); }
        catch (e) { showToast(e.message, 'error'); }
      };
    });
  }

  panel.querySelector('#av-nuevo').onclick = async () => {
    if (!plazas.length) { try { plazas = await api.getPlazas(); } catch { plazas = []; } }
    abrirEditor(panel, { aviso: null, plazas, onClose: () => init(panel) });
  };

  await recargar();
}
