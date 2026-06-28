import * as api from './api.js';
import { showToast } from './utils.js';
import { combobox } from './combobox.js';
import { t } from '../i18n.js';
import { BASE } from '../config.js';
import { gridGafetes, urlVerificacion } from './gafetes-layout.mjs';

// jsPDF + qrcode como ESM desde CDN (patrón qrcode/leaflet de plazas.js): se
// cargan una sola vez, al generar. El QR se dibuja localmente.
let _jspdfP, _qrP;
const loadJsPDF = () => (_jspdfP ??= import('https://esm.sh/jspdf@2.5.2').then((m) => m.jsPDF ?? m.default?.jsPDF));
const loadQR    = () => (_qrP ??= import('https://esm.sh/qrcode@1.5.4').then((m) => m.default ?? m));

const CARD_W = 85.6, CARD_H = 54; // CR80 (tarjeta estándar) en mm

let _empleados = [];

export async function init(panel) {
  panel.innerHTML = `
    <div class="panel-header">
      <h2>${t('Gafetes')}</h2>
    </div>
    <p class="td-muted" style="margin:-4px 0 14px">${t('Genera la credencial del empleado en PDF. El QR abre una página que verifica que está activo en EQS.')}</p>

    <div class="ad-card gf-card">
      <h4 class="gf-sub">${t('Gafete individual')}</h4>
      <div class="gf-row">
        <div id="gf-emp-pick" class="gf-pick"></div>
        <button id="gf-descargar" class="abtn abtn--primary" disabled>${t('Descargar PDF')}</button>
      </div>
      <div class="gf-preview-wrap">
        <iframe id="gf-preview" class="gf-preview" title="${t('Vista previa del gafete')}"></iframe>
        <p id="gf-preview-vacio" class="gf-preview-vacio">${t('Elige un empleado para ver su gafete.')}</p>
      </div>
    </div>

    <div class="ad-card gf-card">
      <h4 class="gf-sub">${t('Lote por plaza')}</h4>
      <p class="td-muted">${t('Una hoja Letter con los gafetes de todos los empleados de la plaza.')}</p>
      <div class="gf-row">
        <select id="gf-plaza" class="form-input gf-pick"><option value="">${t('Selecciona una plaza')}</option></select>
        <button id="gf-lote" class="abtn abtn--primary" disabled>${t('Generar lote')}</button>
      </div>
    </div>`;

  const [empleados, plazas] = await Promise.all([api.getEmpleados(), api.getPlazas()]);
  _empleados = empleados;

  // ── Individual ──────────────────────────────────────────────────────────────
  const btnDesc = document.getElementById('gf-descargar');
  const iframe  = document.getElementById('gf-preview');
  const vacio   = document.getElementById('gf-preview-vacio');
  let empSel = null;

  const empCbx = combobox({
    placeholder: t('Selecciona un empleado'),
    options: empleados.map((e) => ({ value: e.id, label: e.nombre, sub: e.numero_empleado || '', img: e.foto_url || undefined, ph: e.foto_url ? undefined : iniciales(e.nombre) })),
    onChange: async (id) => {
      empSel = empleados.find((e) => String(e.id) === String(id)) || null;
      if (!empSel) return;
      btnDesc.disabled = true;
      vacio.textContent = t('Generando vista previa…'); vacio.hidden = false; iframe.hidden = true;
      try {
        const doc = await construirDocIndividual(empSel);
        iframe.src = doc.output('datauristring') + '#toolbar=0&navpanes=0&view=Fit';
        iframe.hidden = false; vacio.hidden = true;
        btnDesc.disabled = false;
      } catch (e) {
        vacio.textContent = `${t('No se pudo generar')}: ${e.message}`;
        showToast(e.message, 'error');
      }
    },
  });
  document.getElementById('gf-emp-pick').appendChild(empCbx.el);

  btnDesc.onclick = async () => {
    if (!empSel) return;
    await conBoton(btnDesc, t('Generando…'), async () => {
      const doc = await construirDocIndividual(empSel);
      doc.save(`gafete_${slug(empSel.numero_empleado || empSel.nombre)}.pdf`);
    });
  };

  // ── Lote por plaza ────────────────────────────────────────────────────────────
  // <select> nativo (no combobox): su menú lo pinta el SO, así nunca queda debajo
  // del iframe de previsualización (capa de composición propia en Chrome).
  const btnLote = document.getElementById('gf-lote');
  const plazaSelEl = document.getElementById('gf-plaza');
  let plazaSel = '';
  plazaSelEl.innerHTML = `<option value="">${t('Selecciona una plaza')}</option>` +
    plazas.map((p) => `<option value="${p.id}">${p.nombre}</option>`).join('');
  plazaSelEl.addEventListener('change', () => { plazaSel = plazaSelEl.value; btnLote.disabled = !plazaSel; });

  btnLote.onclick = async () => {
    const delaPlaza = _empleados.filter((e) => String(e.plaza_id) === String(plazaSel));
    if (!delaPlaza.length) { showToast(t('Esa plaza no tiene empleados.'), 'error'); return; }
    const plazaNombre = plazas.find((p) => String(p.id) === String(plazaSel))?.nombre || 'plaza';
    await conBoton(btnLote, t('Generando…'), async () => {
      const doc = await construirDocLote(delaPlaza);
      doc.save(`gafetes_${slug(plazaNombre)}.pdf`);
    });
  };
}

// ── Construcción de PDFs ────────────────────────────────────────────────────────

// Gafete individual: una página del tamaño exacto de la tarjeta.
async function construirDocIndividual(emp) {
  const jsPDF = await loadJsPDF();
  // landscape: sin esto jsPDF voltea el formato a vertical (54×85.6) y corta la tarjeta.
  const doc = new jsPDF({ unit: 'mm', orientation: 'landscape', format: [CARD_W, CARD_H] });
  await dibujarGafete(doc, emp, 0, 0, await prepararImagenes(emp));
  return doc;
}

// Lote: hojas Letter con la rejilla de gafetes-layout.
async function construirDocLote(emps) {
  const jsPDF = await loadJsPDF();
  const doc = new jsPDF({ unit: 'mm', format: 'letter' });
  const pagW = doc.internal.pageSize.getWidth();
  const pagH = doc.internal.pageSize.getHeight();
  const { porPagina, posiciones } = gridGafetes({ pagW, pagH, cardW: CARD_W, cardH: CARD_H });

  // Pre-resolver imágenes en paralelo (foto + QR de cada empleado).
  const imgs = await Promise.all(emps.map(prepararImagenes));

  for (let i = 0; i < emps.length; i++) {
    if (i > 0 && i % porPagina === 0) doc.addPage();
    const pos = posiciones[i % porPagina];
    await dibujarGafete(doc, emps[i], pos.x, pos.y, imgs[i]);
  }
  return doc;
}

// Carga la foto (a dataURL vía canvas) y el QR de verificación de un empleado.
// Si la foto no se puede usar (sin foto, error de red o CORS-tainted), foto=null
// y el gafete pinta las iniciales.
async function prepararImagenes(emp) {
  const url = urlVerificacion(location.origin, BASE, emp.credencial_codigo);
  const [foto, qr] = await Promise.all([fotoADataUrl(emp.foto_url), qrDataUrl(url)]);
  return { foto, qr };
}

function fotoADataUrl(url) {
  if (!url) return Promise.resolve(null);
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const cv = document.createElement('canvas');
        cv.width = img.naturalWidth; cv.height = img.naturalHeight;
        cv.getContext('2d').drawImage(img, 0, 0);
        resolve(cv.toDataURL('image/jpeg', 0.85));
      } catch { resolve(null); } // tainted por CORS
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

async function qrDataUrl(text) {
  const QR = await loadQR();
  return QR.toDataURL(text, { width: 240, margin: 0 });
}

// Dibuja una tarjeta CR80 en (x,y). doc en mm. Fuente helvetica (estándar PDF;
// ponytail: incrustar Lexend pesaría — innecesario para un gafete).
function dibujarGafete(doc, emp, x, y, { foto, qr }) {
  const W = CARD_W, H = CARD_H, r = 3.2;
  const PRIM = [3, 105, 161];

  // Marco
  doc.setFillColor(255, 255, 255); doc.setDrawColor(203, 213, 225); doc.setLineWidth(0.3);
  doc.roundedRect(x, y, W, H, r, r, 'FD');

  // Banda superior con marca (esquinas sup. redondeadas, base recta)
  const hb = 13;
  doc.setFillColor(...PRIM);
  doc.roundedRect(x, y, W, hb, r, r, 'F');
  doc.rect(x, y + r, W, hb - r, 'F');
  doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
  doc.text('EQS', x + 5, y + 8.6);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(186, 222, 247);
  doc.text('CHECADOR', x + 5 + doc.getTextWidth('EQS') + 1.5, y + 8.6);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(6.5); doc.setTextColor(255, 255, 255);
  doc.text('CREDENCIAL', x + W - 5, y + 8.4, { align: 'right' });

  // Foto vertical (o iniciales) a la izquierda
  const fw = 20, fh = 26, fx = x + 5, fy = y + hb + 3;
  if (foto) {
    doc.addImage(foto, 'JPEG', fx, fy, fw, fh);
  } else {
    doc.setFillColor(...PRIM); doc.roundedRect(fx, fy, fw, fh, 2, 2, 'F');
    doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(14);
    doc.text(iniciales(emp.nombre) || '–', fx + fw / 2, fy + fh / 2 + 1.5, { align: 'center' });
  }
  doc.setDrawColor(203, 213, 225); doc.setLineWidth(0.3); doc.roundedRect(fx, fy, fw, fh, 2, 2, 'S');

  // Datos a la derecha de la foto. maxW acotado: el texto queda a la izquierda
  // del QR (que arranca en ~x+63.6), así nunca se encima ni se corta.
  const tx = fx + fw + 5, maxW = 32;
  doc.setTextColor(15, 23, 42); doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
  const nombreLineas = doc.splitTextToSize(emp.nombre || '', maxW).slice(0, 2);
  doc.text(nombreLineas, tx, y + hb + 6);
  let ty = y + hb + 6 + nombreLineas.length * 4.8 + 1.5;
  if (emp.puesto) {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(71, 85, 105);
    const puestoLineas = doc.splitTextToSize(emp.puesto, maxW).slice(0, 2);
    doc.text(puestoLineas, tx, ty); ty += puestoLineas.length * 4 + 0.5;
  }
  if (emp.plazas?.nombre) {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(100, 116, 139);
    doc.text(doc.splitTextToSize(emp.plazas.nombre, maxW).slice(0, 1), tx, ty);
  }

  // Número de empleado (inferior izquierda)
  if (emp.numero_empleado) {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.setTextColor(...PRIM);
    doc.text(`#${emp.numero_empleado}`, x + 5, y + H - 4);
  }

  // QR de verificación (inferior derecha) con su rótulo
  if (qr) {
    const qs = 18, qx = x + W - qs - 4, qy = y + H - qs - 4;
    doc.addImage(qr, 'PNG', qx, qy, qs, qs);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(5); doc.setTextColor(148, 163, 184);
    doc.text('VERIFICAR', qx + qs / 2, qy - 1.2, { align: 'center' });
  }
}

// ── Utilidades ──────────────────────────────────────────────────────────────
const iniciales = (nombre) => (nombre || '').trim().split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
const slug = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'gafete';

// Desactiva el botón con etiqueta temporal mientras corre la tarea async.
async function conBoton(btn, etiqueta, tarea) {
  const orig = btn.textContent;
  btn.disabled = true; btn.textContent = etiqueta;
  try { await tarea(); }
  catch (e) { showToast(e.message, 'error'); }
  finally { btn.disabled = false; btn.textContent = orig; }
}
