// Editor de avisos: lienzo SVG con elementos arrastrables (drag = mover, manija =
// redimensionar) + panel inspector. Reusa elementoASvg() del modelo para pintar
// cada nodo vivo. Exporta a PNG (svg→canvas) y guarda en Supabase.
import * as api from './api.js';
import { showToast } from './utils.js';
import { t } from '../i18n.js';
import {
  LIENZO_W, LIENZO_H, ICONOS, elementoNuevo, elementoASvg, plantilla,
} from './aviso-modelo.mjs';

const SVGNS = 'http://www.w3.org/2000/svg';
const MAX_IMG = 3 * 1024 * 1024;

// bbox aproximado de un elemento (para el recuadro de selección y la manija).
function bbox(el) {
  if (el.tipo === 'texto') {
    const nl = String(el.texto ?? '').split('\n').length;
    return { x: el.x, y: el.y, w: el.w, h: el.fontSize * 1.2 * nl };
  }
  return { x: el.x, y: el.y, w: el.w, h: el.h ?? el.w };
}

export function abrirEditor(panel, { aviso, plazas, onClose }) {
  // Modelo de trabajo: clon del diseño guardado o plantilla por defecto.
  const modelo = aviso?.diseno?.elementos
    ? structuredClone(aviso.diseno)
    : plantilla('informativo');
  let selId = null;

  const plazaOpts = [`<option value="">${t('Todas las plazas')}</option>`]
    .concat(plazas.map((p) => `<option value="${p.id}">${esc(p.nombre)}</option>`)).join('');
  const sel = (v, cur) => v === cur ? ' selected' : '';

  panel.innerHTML = `
    <div class="panel-header">
      <h2>${aviso ? t('Editar aviso') : t('Nuevo aviso')}</h2>
      <div class="panel-header__actions">
        <button id="av-cancelar" class="abtn">${t('Cancelar')}</button>
        <button id="av-guardar" class="abtn abtn--primary">${t('Guardar')}</button>
      </div>
    </div>

    <div class="ave-meta ad-card">
      <label class="ave-field ave-field--grow">
        <span>${t('Título')} *</span>
        <input id="av-titulo" type="text" maxlength="120" value="${esc(aviso?.titulo || '')}" placeholder="${t('Título del aviso')}">
      </label>
      <label class="ave-field">
        <span>${t('Plaza')}</span>
        <select id="av-plaza">${plazaOpts}</select>
      </label>
      <label class="ave-field">
        <span>${t('Desde')}</span>
        <input id="av-desde" type="date" value="${aviso?.inicia_en || ''}">
      </label>
      <label class="ave-field">
        <span>${t('Hasta')}</span>
        <input id="av-hasta" type="date" value="${aviso?.termina_en || ''}">
      </label>
    </div>

    <div class="ave-tools ad-card">
      <button class="abtn abtn--sm" data-add="texto">+ ${t('Texto')}</button>
      <button class="abtn abtn--sm" data-add="forma">+ ${t('Forma')}</button>
      <button class="abtn abtn--sm" data-add="icono">+ ${t('Icono')}</button>
      <label class="abtn abtn--sm ave-filebtn">+ ${t('Imagen')}<input id="av-img" type="file" accept="image/png,image/jpeg" hidden></label>
      <select id="av-plantilla" class="ave-tplsel" title="${t('Aplicar plantilla')}">
        <option value="">${t('Plantilla…')}</option>
        <option value="informativo">${t('Informativo')}</option>
        <option value="urgente">${t('Urgente')}</option>
        <option value="evento">${t('Evento')}</option>
      </select>
      <label class="ave-bg" title="${t('Color de fondo')}">${t('Fondo')}
        <input id="av-fondo" type="color" value="${modelo.fondo || '#ffffff'}">
      </label>
    </div>

    <div class="ave-stage">
      <div class="ave-canvas-wrap">
        <svg id="av-lienzo" class="ave-canvas" viewBox="0 0 ${LIENZO_W} ${LIENZO_H}" xmlns="${SVGNS}" aria-label="${t('Lienzo del aviso')}">
          <rect id="av-fondo-rect" width="${LIENZO_W}" height="${LIENZO_H}"></rect>
          <g id="av-capas"></g>
          <g id="av-overlay"></g>
        </svg>
      </div>
      <aside id="av-inspector" class="ave-inspector ad-card"></aside>
    </div>`;

  const svg     = panel.querySelector('#av-lienzo');
  const capas   = panel.querySelector('#av-capas');
  const overlay = panel.querySelector('#av-overlay');
  const fondoRect = panel.querySelector('#av-fondo-rect');
  const inspector = panel.querySelector('#av-inspector');
  if (aviso?.plaza_id != null) panel.querySelector('#av-plaza').value = String(aviso.plaza_id);

  // ── Render ────────────────────────────────────────────────────────────────
  function renderCapas() {
    fondoRect.setAttribute('fill', modelo.fondo || '#ffffff');
    capas.innerHTML = modelo.elementos
      .map((el) => `<g class="ave-el" data-id="${el.id}">${elementoASvg(el)}</g>`).join('');
    renderOverlay();
  }

  function renderOverlay() {
    const el = modelo.elementos.find((e) => e.id === selId);
    if (!el) { overlay.innerHTML = ''; inspector.innerHTML = inspectorVacio(); return; }
    const b = bbox(el);
    const handle = el.tipo === 'texto' ? '' :
      `<rect class="ave-handle" data-handle="1" x="${b.x + b.w - 28}" y="${b.y + b.h - 28}" width="40" height="40" rx="6"></rect>`;
    overlay.innerHTML =
      `<rect class="ave-sel" x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" fill="none"></rect>${handle}`;
    renderInspector(el);
  }

  function selPlus(el) { return modelo.elementos.find((e) => e.id === selId) || el; }

  // ── Inspector ───────────────────────────────────────────────────────────────
  const inspectorVacio = () =>
    `<p class="ave-hint">${t('Toca un elemento para editarlo, o agrega uno con la barra de arriba.')}</p>`;

  function renderInspector(el) {
    let campos = '';
    if (el.tipo === 'texto') campos = `
      <label class="ave-ifield"><span>${t('Texto')}</span><textarea data-prop="texto" rows="3">${esc(el.texto)}</textarea></label>
      <label class="ave-ifield"><span>${t('Tamaño')} (${el.fontSize})</span><input type="range" min="20" max="180" step="2" data-prop="fontSize" value="${el.fontSize}"></label>
      <label class="ave-ifield"><span>${t('Color')}</span><input type="color" data-prop="color" value="${el.color}"></label>
      <div class="ave-irow">
        <label class="ave-check"><input type="checkbox" data-prop="bold" ${el.bold ? 'checked' : ''}> ${t('Negrita')}</label>
        <select data-prop="align">
          <option value="left"${sel('left', el.align)}>${t('Izquierda')}</option>
          <option value="center"${sel('center', el.align)}>${t('Centro')}</option>
          <option value="right"${sel('right', el.align)}>${t('Derecha')}</option>
        </select>
      </div>`;
    else if (el.tipo === 'forma') campos = `
      <label class="ave-ifield"><span>${t('Color')}</span><input type="color" data-prop="fill" value="${el.fill}"></label>
      <label class="ave-ifield"><span>${t('Esquinas')} (${el.radio})</span><input type="range" min="0" max="120" data-prop="radio" value="${el.radio}"></label>
      <label class="ave-ifield"><span>${t('Opacidad')} (${el.opacidad})</span><input type="range" min="0.1" max="1" step="0.1" data-prop="opacidad" value="${el.opacidad}"></label>`;
    else if (el.tipo === 'icono') campos = `
      <label class="ave-ifield"><span>${t('Icono')}</span><select data-prop="path">
        ${Object.entries(ICONOS).map(([k, v]) => `<option value="${esc(v)}"${sel(v, el.path)}>${t(k[0].toUpperCase() + k.slice(1))}</option>`).join('')}
      </select></label>
      <label class="ave-ifield"><span>${t('Color')}</span><input type="color" data-prop="color" value="${el.color}"></label>`;
    else if (el.tipo === 'imagen') campos = `
      <label class="abtn abtn--sm ave-filebtn">${t('Reemplazar imagen')}<input type="file" accept="image/png,image/jpeg" data-replace hidden></label>`;

    inspector.innerHTML = `
      <h4 class="ave-isub">${t(el.tipo[0].toUpperCase() + el.tipo.slice(1))}</h4>
      ${campos}
      <div class="ave-iorder">
        <button class="abtn abtn--sm" data-z="up">${t('Subir')}</button>
        <button class="abtn abtn--sm" data-z="down">${t('Bajar')}</button>
        <button class="abtn abtn--sm abtn--danger" data-del>${t('Eliminar')}</button>
      </div>`;

    inspector.querySelectorAll('[data-prop]').forEach((inp) => {
      const ev = (inp.type === 'range' || inp.tagName === 'TEXTAREA') ? 'input' : 'change';
      inp.addEventListener(ev, () => {
        const e2 = selPlus(el);
        const p = inp.dataset.prop;
        e2[p] = inp.type === 'checkbox' ? inp.checked
              : (p === 'fontSize' || p === 'radio') ? Number(inp.value)
              : p === 'opacidad' ? Number(inp.value) : inp.value;
        renderCapas();
      });
    });
    const rep = inspector.querySelector('[data-replace]');
    if (rep) rep.addEventListener('change', () => cargarImagen(rep.files[0], selPlus(el)));
    inspector.querySelector('[data-del]').addEventListener('click', () => {
      modelo.elementos = modelo.elementos.filter((e) => e.id !== selId); selId = null; renderCapas();
    });
    inspector.querySelectorAll('[data-z]').forEach((b) => b.addEventListener('click', () => {
      const i = modelo.elementos.findIndex((e) => e.id === selId);
      const j = b.dataset.z === 'up' ? i + 1 : i - 1;
      if (j < 0 || j >= modelo.elementos.length) return;
      [modelo.elementos[i], modelo.elementos[j]] = [modelo.elementos[j], modelo.elementos[i]];
      renderCapas();
    }));
  }

  // ── Drag + resize (pointer events) ───────────────────────────────────────────
  let drag = null;
  const escala = () => svg.getBoundingClientRect().width / LIENZO_W;

  svg.addEventListener('pointerdown', (e) => {
    const handle = e.target.closest('[data-handle]');
    const g = e.target.closest('.ave-el');
    if (handle && selId) {
      const el = modelo.elementos.find((x) => x.id === selId);
      drag = { modo: 'resize', el, x0: e.clientX, y0: e.clientY, w0: el.w, h0: el.h ?? el.w };
    } else if (g) {
      selId = g.dataset.id; renderOverlay();
      const el = modelo.elementos.find((x) => x.id === selId);
      drag = { modo: 'mover', el, x0: e.clientX, y0: e.clientY, ex: el.x, ey: el.y };
    } else {
      selId = null; renderOverlay(); return;
    }
    svg.setPointerCapture(e.pointerId);
  });

  svg.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const k = escala();
    const dx = (e.clientX - drag.x0) / k, dy = (e.clientY - drag.y0) / k;
    if (drag.modo === 'mover') { drag.el.x = Math.round(drag.ex + dx); drag.el.y = Math.round(drag.ey + dy); }
    else {
      const nw = Math.max(40, Math.round(drag.w0 + dx));
      drag.el.w = nw;
      if (drag.el.tipo !== 'forma') drag.el.h = Math.round(nw * (drag.h0 / drag.w0)); // proporción
      else drag.el.h = Math.max(20, Math.round(drag.h0 + dy));
    }
    renderCapas();
  });

  const finDrag = (e) => { if (drag) { drag = null; try { svg.releasePointerCapture(e.pointerId); } catch {} } };
  svg.addEventListener('pointerup', finDrag);
  svg.addEventListener('pointercancel', finDrag);

  // ── Agregar elementos / imagen / plantilla / fondo ───────────────────────────
  panel.querySelectorAll('[data-add]').forEach((b) => b.addEventListener('click', () => {
    const el = elementoNuevo(b.dataset.add);
    modelo.elementos.push(el); selId = el.id; renderCapas();
  }));

  function cargarImagen(file, elExistente) {
    if (!file) return;
    if (!['image/png', 'image/jpeg'].includes(file.type)) { showToast(t('Solo PNG o JPEG.'), 'error'); return; }
    if (file.size > MAX_IMG) { showToast(t('La imagen supera 3 MB.'), 'error'); return; }
    const fr = new FileReader();
    fr.onload = () => {
      const img = new Image();
      img.onload = () => {
        const ratio = img.naturalHeight / img.naturalWidth || 1;
        if (elExistente) { elExistente.dataUrl = fr.result; elExistente.h = Math.round(elExistente.w * ratio); }
        else {
          const w = 500;
          const el = elementoNuevo('imagen', { dataUrl: fr.result, w, h: Math.round(w * ratio), x: 290, y: 425 });
          modelo.elementos.push(el); selId = el.id;
        }
        renderCapas();
      };
      img.src = fr.result;
    };
    fr.readAsDataURL(file);
  }
  panel.querySelector('#av-img').addEventListener('change', (e) => cargarImagen(e.target.files[0], null));

  panel.querySelector('#av-plantilla').addEventListener('change', (e) => {
    const v = e.target.value; e.target.value = '';
    if (!v) return;
    if (modelo.elementos.length && !confirm(t('¿Reemplazar el diseño actual con la plantilla?'))) return;
    const p = plantilla(v); modelo.fondo = p.fondo; modelo.elementos = p.elementos;
    panel.querySelector('#av-fondo').value = modelo.fondo; selId = null; renderCapas();
  });

  panel.querySelector('#av-fondo').addEventListener('input', (e) => { modelo.fondo = e.target.value; renderCapas(); });

  // ── Guardar / cancelar ───────────────────────────────────────────────────────
  panel.querySelector('#av-cancelar').addEventListener('click', () => onClose());

  const btnGuardar = panel.querySelector('#av-guardar');
  btnGuardar.addEventListener('click', async () => {
    const titulo = panel.querySelector('#av-titulo').value.trim();
    if (!titulo) { showToast(t('El título es obligatorio.'), 'error'); panel.querySelector('#av-titulo').focus(); return; }
    const plazaVal = panel.querySelector('#av-plaza').value;
    const payload = {
      titulo,
      plaza_id: plazaVal ? Number(plazaVal) : null,
      inicia_en: panel.querySelector('#av-desde').value || null,
      termina_en: panel.querySelector('#av-hasta').value || null,
      diseno: modelo,
    };
    btnGuardar.disabled = true; const orig = btnGuardar.textContent; btnGuardar.textContent = t('Guardando…');
    try {
      const blob = await renderPng(modelo);
      payload.imagen_url = await api.subirImagenAviso(blob);
      if (aviso?.id) await api.updateAviso(aviso.id, payload);
      else await api.createAviso(payload);
      showToast(t('Aviso guardado.'), 'success');
      onClose();
    } catch (err) {
      showToast(err.message, 'error');
      btnGuardar.disabled = false; btnGuardar.textContent = orig;
    }
  });

  renderCapas();
}

// ── Export SVG → PNG ──────────────────────────────────────────────────────────
import { modeloASvg } from './aviso-modelo.mjs';
async function renderPng(modelo) {
  if (document.fonts?.ready) { try { await document.fonts.ready; } catch {} }
  const svg = modeloASvg(modelo);
  const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  const img = await new Promise((res, rej) => {
    const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('No se pudo renderizar el aviso.')); im.src = url;
  });
  const cv = document.createElement('canvas'); cv.width = LIENZO_W; cv.height = LIENZO_H;
  cv.getContext('2d').drawImage(img, 0, 0, LIENZO_W, LIENZO_H);
  return new Promise((res, rej) => cv.toBlob((b) => b ? res(b) : rej(new Error('No se pudo generar la imagen.')), 'image/png'));
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
