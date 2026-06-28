// Editor de avisos con dos modos:
//  • Plantilla: formulario (diseño + título/cuerpo/fecha) que autollena un diseño
//    predefinido y muestra una vista previa. Lo rápido para el 90% de los casos.
//  • Lienzo: editor SVG con elementos arrastrables (drag = mover, manija =
//    redimensionar) + inspector, para diseños totalmente a medida.
// Ambos comparten el mismo `modelo` { fondo, elementos } y exportan a PNG.
import * as api from './api.js';
import { showToast } from './utils.js';
import { t } from '../i18n.js';
import {
  LIENZO_W, LIENZO_H, ICONOS, elementoNuevo, elementoASvg, plantilla, modeloASvg,
} from './aviso-modelo.mjs';

const SVGNS = 'http://www.w3.org/2000/svg';
const MAX_IMG = 3 * 1024 * 1024;

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// bbox aproximado de un elemento (para el recuadro de selección y la manija).
function bbox(el) {
  if (el.tipo === 'texto') {
    const nl = String(el.texto ?? '').split('\n').length;
    return { x: el.x, y: el.y, w: el.w, h: el.fontSize * 1.2 * nl };
  }
  return { x: el.x, y: el.y, w: el.w, h: el.h ?? el.w };
}

// SVG del lienzo, compartido por ambos modos (read-only en plantilla).
const lienzoSvg = (ro) => `
  <svg id="av-lienzo" class="ave-canvas${ro ? ' ave-canvas--ro' : ''}" viewBox="0 0 ${LIENZO_W} ${LIENZO_H}" xmlns="${SVGNS}" aria-label="${t('Lienzo del aviso')}">
    <rect id="av-fondo-rect" width="${LIENZO_W}" height="${LIENZO_H}"></rect>
    <g id="av-capas"></g>
    <g id="av-overlay"></g>
  </svg>`;

export function abrirEditor(panel, { aviso, plazas, onClose }) {
  // Modo: avisos existentes abren en Lienzo (respeta su diseño guardado);
  // los nuevos abren en Plantilla (camino rápido).
  let modo = aviso?.diseno?.elementos ? 'lienzo' : 'plantilla';
  // Modelo de trabajo: clon del diseño guardado o plantilla por defecto.
  let modelo = aviso?.diseno?.elementos ? structuredClone(aviso.diseno) : plantilla('informativo');
  // Estado del formulario (modo plantilla). El título vive en el input de meta.
  const campos = { plantilla: 'informativo', cuerpo: '', fecha: '' };
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

    <div class="ave-grid">
      <section class="ave-col ad-card ave-meta">
        <h4 class="ave-coltitle">${t('Datos del aviso')}</h4>
        <label class="ave-field">
          <span>${t('Título')} *</span>
          <input id="av-titulo" type="text" maxlength="120" value="${esc(aviso?.titulo || '')}" placeholder="${t('Título del aviso')}">
        </label>
        <label class="ave-field">
          <span>${t('Plaza')}</span>
          <select id="av-plaza">${plazaOpts}</select>
        </label>
        <div class="ave-field2">
          <label class="ave-field">
            <span>${t('Desde')}</span>
            <input id="av-desde" type="date" value="${aviso?.inicia_en || ''}">
          </label>
          <label class="ave-field">
            <span>${t('Hasta')}</span>
            <input id="av-hasta" type="date" value="${aviso?.termina_en || ''}">
          </label>
        </div>
        <div class="ave-modo" role="tablist">
          <button class="ave-modo__btn" data-modo="plantilla">${t('Plantilla')}</button>
          <button class="ave-modo__btn" data-modo="lienzo">${t('Lienzo')}</button>
        </div>
      </section>

      <section id="av-canvas-host" class="ave-col ave-canvas-col"></section>

      <aside id="av-side" class="ave-col ad-card ave-side"></aside>
    </div>`;

  const canvasHost = panel.querySelector('#av-canvas-host');
  const side = panel.querySelector('#av-side');
  const tituloInput = panel.querySelector('#av-titulo');
  if (aviso?.plaza_id != null) panel.querySelector('#av-plaza').value = String(aviso.plaza_id);

  // Refs del lienzo (se reasignan en cada renderModo porque el HTML se reemplaza).
  let svg, capas, overlay, fondoRect, inspector;

  // ── Render del lienzo (común a ambos modos) ──────────────────────────────────
  function renderCapas() {
    fondoRect.setAttribute('fill', modelo.fondo || '#ffffff');
    capas.innerHTML = modelo.elementos
      .map((el) => `<g class="ave-el" data-id="${el.id}">${elementoASvg(el)}</g>`).join('');
    renderOverlay();
  }

  // Solo dibuja la caja de selección. NO reconstruye el inspector: hacerlo en cada
  // keystroke/drag destruía el <textarea> en edición y robaba el foco.
  function renderOverlay() {
    if (!overlay) return;
    const el = modelo.elementos.find((e) => e.id === selId);
    if (!el) { overlay.innerHTML = ''; return; }
    const b = bbox(el);
    const handle = el.tipo === 'texto' ? '' :
      `<rect class="ave-handle" data-handle="1" x="${b.x + b.w - 28}" y="${b.y + b.h - 28}" width="40" height="40" rx="6"></rect>`;
    overlay.innerHTML =
      `<rect class="ave-sel" x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" fill="none"></rect>${handle}`;
  }

  // Reconstruye el inspector SOLO al cambiar de selección (nunca al escribir/arrastrar).
  function refrescarInspector() {
    if (!inspector) return;
    const el = modelo.elementos.find((e) => e.id === selId);
    if (!el) { inspector.innerHTML = inspectorVacio(); return; }
    renderInspector(el);
  }

  function selPlus(el) { return modelo.elementos.find((e) => e.id === selId) || el; }

  // ── Inspector ─────────────────────────────────────────────────────────────
  const inspectorVacio = () =>
    `<p class="ave-hint">${t('Toca un elemento para editarlo, o agrega uno con la barra de arriba.')}</p>`;

  function renderInspector(el) {
    let campos2 = '';
    if (el.tipo === 'texto') campos2 = `
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
    else if (el.tipo === 'forma') campos2 = `
      <label class="ave-ifield"><span>${t('Color')}</span><input type="color" data-prop="fill" value="${el.fill}"></label>
      <label class="ave-ifield"><span>${t('Esquinas')} (${el.radio})</span><input type="range" min="0" max="120" data-prop="radio" value="${el.radio}"></label>
      <label class="ave-ifield"><span>${t('Opacidad')} (${el.opacidad})</span><input type="range" min="0.1" max="1" step="0.1" data-prop="opacidad" value="${el.opacidad}"></label>`;
    else if (el.tipo === 'icono') campos2 = `
      <label class="ave-ifield"><span>${t('Icono')}</span><select data-prop="path">
        ${Object.entries(ICONOS).map(([k, v]) => `<option value="${esc(v)}"${sel(v, el.path)}>${t(k[0].toUpperCase() + k.slice(1))}</option>`).join('')}
      </select></label>
      <label class="ave-ifield"><span>${t('Color')}</span><input type="color" data-prop="color" value="${el.color}"></label>`;
    else if (el.tipo === 'imagen') campos2 = `
      <label class="abtn abtn--sm ave-filebtn">${t('Reemplazar imagen')}<input type="file" accept="image/png,image/jpeg" data-replace hidden></label>`;

    inspector.innerHTML = `
      <h4 class="ave-isub">${t('Elemento seleccionado')}: ${t(el.tipo[0].toUpperCase() + el.tipo.slice(1))}</h4>
      ${campos2}
      <div class="ave-ialign" role="group" aria-label="${t('Alinear')}">
        <span class="ave-ialign__lbl">${t('Alinear')}</span>
        <div class="ave-ialign__row">
          <button class="ave-abtn" data-align="left"    title="${t('Izquierda')}" aria-label="${t('Izquierda')}">⊢</button>
          <button class="ave-abtn" data-align="hcenter" title="${t('Centro')}" aria-label="${t('Centro')}">⊣⊢</button>
          <button class="ave-abtn" data-align="right"   title="${t('Derecha')}" aria-label="${t('Derecha')}">⊣</button>
          <button class="ave-abtn" data-align="top"     title="${t('Arriba')}" aria-label="${t('Arriba')}">⊤</button>
          <button class="ave-abtn" data-align="vmiddle" title="${t('Medio')}" aria-label="${t('Medio')}">⊥⊤</button>
          <button class="ave-abtn" data-align="bottom"  title="${t('Abajo')}" aria-label="${t('Abajo')}">⊥</button>
        </div>
      </div>
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
      modelo.elementos = modelo.elementos.filter((e) => e.id !== selId); selId = null; renderCapas(); refrescarInspector();
    });
    inspector.querySelectorAll('[data-z]').forEach((b) => b.addEventListener('click', () => {
      const i = modelo.elementos.findIndex((e) => e.id === selId);
      const j = b.dataset.z === 'up' ? i + 1 : i - 1;
      if (j < 0 || j >= modelo.elementos.length) return;
      [modelo.elementos[i], modelo.elementos[j]] = [modelo.elementos[j], modelo.elementos[i]];
      renderCapas();
    }));
    inspector.querySelectorAll('[data-align]').forEach((b) => b.addEventListener('click', () => {
      alinear(selPlus(el), b.dataset.align); renderCapas();
    }));
  }

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
        renderCapas(); refrescarInspector();
      };
      img.src = fr.result;
    };
    fr.readAsDataURL(file);
  }

  // ── Wiring por modo ──────────────────────────────────────────────────────────
  function wireLienzo() {
    // Drag + resize (pointer events).
    let drag = null;
    const escala = () => svg.getBoundingClientRect().width / LIENZO_W;
    svg.addEventListener('pointerdown', (e) => {
      const handle = e.target.closest('[data-handle]');
      const g = e.target.closest('.ave-el');
      if (handle && selId) {
        const el = modelo.elementos.find((x) => x.id === selId);
        drag = { modo: 'resize', el, x0: e.clientX, y0: e.clientY, w0: el.w, h0: el.h ?? el.w };
      } else if (g) {
        selId = g.dataset.id; renderOverlay(); refrescarInspector();
        const el = modelo.elementos.find((x) => x.id === selId);
        drag = { modo: 'mover', el, x0: e.clientX, y0: e.clientY, ex: el.x, ey: el.y };
      } else {
        selId = null; renderOverlay(); refrescarInspector(); return;
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

    // Agregar elementos / imagen / plantilla / fondo.
    side.querySelectorAll('[data-add]').forEach((b) => b.addEventListener('click', () => {
      const el = elementoNuevo(b.dataset.add);
      modelo.elementos.push(el); selId = el.id; renderCapas(); refrescarInspector();
    }));
    side.querySelector('#av-img').addEventListener('change', (e) => cargarImagen(e.target.files[0], null));
    side.querySelector('#av-plantilla').addEventListener('change', (e) => {
      const v = e.target.value; e.target.value = '';
      if (!v) return;
      if (modelo.elementos.length && !confirm(t('¿Reemplazar el diseño actual con la plantilla?'))) return;
      const p = plantilla(v); modelo.fondo = p.fondo; modelo.elementos = p.elementos;
      side.querySelector('#av-fondo').value = modelo.fondo; selId = null; renderCapas(); refrescarInspector();
    });
    side.querySelector('#av-fondo').addEventListener('input', (e) => { modelo.fondo = e.target.value; renderCapas(); });
  }

  // Alinea el elemento seleccionado respecto al lienzo (estilo Photoshop).
  function alinear(el, dir) {
    const b = bbox(el);
    if (dir === 'left')         el.x = 0;
    else if (dir === 'hcenter') el.x = Math.round((LIENZO_W - b.w) / 2);
    else if (dir === 'right')   el.x = LIENZO_W - b.w;
    else if (dir === 'top')     el.y = 0;
    else if (dir === 'vmiddle') el.y = Math.round((LIENZO_H - b.h) / 2);
    else if (dir === 'bottom')  el.y = LIENZO_H - b.h;
  }

  // Regenera el modelo desde el formulario y repinta la vista previa.
  function regenPlantilla() {
    const p = plantilla(campos.plantilla, { titulo: tituloInput.value, cuerpo: campos.cuerpo, fecha: campos.fecha });
    modelo = { fondo: p.fondo, elementos: p.elementos };
    renderCapas();
  }

  function wirePlantilla() {
    side.querySelector('#av-fdiseno').addEventListener('change', (e) => { campos.plantilla = e.target.value; regenPlantilla(); });
    side.querySelector('#av-fcuerpo').addEventListener('input', (e) => { campos.cuerpo = e.target.value; regenPlantilla(); });
    side.querySelector('#av-ffecha').addEventListener('input', (e) => { campos.fecha = e.target.value; regenPlantilla(); });
    regenPlantilla(); // pinta la vista previa inicial con el título actual
  }

  // ── Render del modo activo ───────────────────────────────────────────────────
  function renderModo() {
    // Centro: el lienzo (read-only en plantilla, editable en lienzo).
    canvasHost.innerHTML = `<div class="ave-canvas-wrap">${lienzoSvg(modo === 'plantilla')}</div>`;

    // Derecha: formulario (plantilla) o herramientas + inspector (lienzo).
    side.innerHTML = modo === 'plantilla' ? `
      <h4 class="ave-coltitle">${t('Diseño rápido')}</h4>
      <label class="ave-ifield"><span>${t('Diseño')}</span>
        <select id="av-fdiseno">
          <option value="informativo"${sel('informativo', campos.plantilla)}>${t('Informativo')}</option>
          <option value="urgente"${sel('urgente', campos.plantilla)}>${t('Urgente')}</option>
          <option value="evento"${sel('evento', campos.plantilla)}>${t('Evento')}</option>
        </select></label>
      <label class="ave-ifield"><span>${t('Cuerpo')}</span>
        <textarea id="av-fcuerpo" rows="4" placeholder="${t('Escribe el mensaje del aviso…')}">${esc(campos.cuerpo)}</textarea></label>
      <label class="ave-ifield"><span>${t('Fecha')}</span>
        <input id="av-ffecha" type="text" maxlength="60" value="${esc(campos.fecha)}" placeholder="${t('Ej. Lunes 30 de junio, 9:00 am')}"></label>
      <p class="ave-hint">${t('El título de arriba aparece en el aviso. ¿Necesitas un diseño a medida? Cambia a Lienzo.')}</p>` : `
      <h4 class="ave-coltitle">${t('Herramientas')}</h4>
      <div class="ave-toolgrid">
        <button class="abtn abtn--sm" data-add="texto">+ ${t('Texto')}</button>
        <button class="abtn abtn--sm" data-add="forma">+ ${t('Forma')}</button>
        <button class="abtn abtn--sm" data-add="icono">+ ${t('Icono')}</button>
        <label class="abtn abtn--sm ave-filebtn">+ ${t('Imagen')}<input id="av-img" type="file" accept="image/png,image/jpeg" hidden></label>
      </div>
      <div class="ave-toolrow">
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
      <div id="av-inspector" class="ave-inspector"></div>`;

    svg       = canvasHost.querySelector('#av-lienzo');
    capas     = canvasHost.querySelector('#av-capas');
    overlay   = canvasHost.querySelector('#av-overlay');
    fondoRect = canvasHost.querySelector('#av-fondo-rect');
    inspector = side.querySelector('#av-inspector'); // null en plantilla

    panel.querySelectorAll('.ave-modo__btn').forEach((b) =>
      b.classList.toggle('is-active', b.dataset.modo === modo));

    if (modo === 'lienzo') { wireLienzo(); renderCapas(); refrescarInspector(); }
    else { wirePlantilla(); /* regen() ya pintó */ }
  }

  // Cambio de modo. Lienzo→Plantilla regenera desde el formulario (descarta ajustes
  // libres del lienzo): confirmamos para no perder un diseño a medida sin avisar.
  panel.querySelectorAll('.ave-modo__btn').forEach((b) => b.addEventListener('click', () => {
    const nuevo = b.dataset.modo;
    if (nuevo === modo) return;
    if (nuevo === 'plantilla' && modo === 'lienzo' &&
        !confirm(t('Volver a Plantilla regenerará el diseño desde el formulario. ¿Continuar?'))) return;
    selId = null; modo = nuevo; renderModo();
  }));

  // El título alimenta la vista previa en modo plantilla.
  tituloInput.addEventListener('input', () => { if (modo === 'plantilla') regenPlantilla(); });

  // ── Guardar / cancelar ───────────────────────────────────────────────────────
  panel.querySelector('#av-cancelar').addEventListener('click', () => onClose());

  const btnGuardar = panel.querySelector('#av-guardar');
  btnGuardar.addEventListener('click', async () => {
    const titulo = tituloInput.value.trim();
    if (!titulo) { showToast(t('El título es obligatorio.'), 'error'); tituloInput.focus(); return; }
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

  renderModo();
}

// ── Export SVG → PNG ──────────────────────────────────────────────────────────
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
