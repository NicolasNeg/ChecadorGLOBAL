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
      <p class="td-muted" style="margin:0 0 12px">${t('Una hoja Letter con los gafetes de todos los empleados de la plaza.')}</p>
      <div class="gf-row">
        <div id="gf-plaza-pick" class="gf-pick"></div>
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
        iframe.src = doc.output('datauristring');
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
  const btnLote = document.getElementById('gf-lote');
  let plazaSel = '';
  const plazaCbx = combobox({
    placeholder: t('Selecciona una plaza'),
    options: plazas.map((p) => ({ value: p.id, label: p.nombre })),
    onChange: (id) => { plazaSel = id; btnLote.disabled = !id; },
  });
  document.getElementById('gf-plaza-pick').appendChild(plazaCbx.el);

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
  const doc = new jsPDF({ unit: 'mm', format: [CARD_W, CARD_H] });
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
  const W = CARD_W, H = CARD_H, r = 3;
  // Marco
  doc.setFillColor(255, 255, 255); doc.setDrawColor(208, 213, 221); doc.setLineWidth(0.3);
  doc.roundedRect(x, y, W, H, r, r, 'FD');
  // Banda superior con marca (rect redondeado arriba + rect recto debajo)
  doc.setFillColor(3, 105, 161);
  doc.roundedRect(x, y, W, 11, r, r, 'F');
  doc.rect(x, y + 5, W, 6, 'F');
  doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
  doc.text('EQS Checador', x + 5, y + 7.2);

  // Foto (o iniciales) a la izquierda
  const fx = x + 5, fy = y + 15, fs = 23;
  if (foto) {
    doc.addImage(foto, 'JPEG', fx, fy, fs, fs);
    doc.setDrawColor(208, 213, 221); doc.setLineWidth(0.3); doc.rect(fx, fy, fs, fs);
  } else {
    doc.setFillColor(3, 105, 161); doc.roundedRect(fx, fy, fs, fs, 2, 2, 'F');
    doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(15);
    doc.text(iniciales(emp.nombre) || '–', fx + fs / 2, fy + fs / 2 + 2, { align: 'center' });
  }

  // Datos a la derecha
  const tx = fx + fs + 4;
  const maxW = W - (tx - x) - 4;
  doc.setTextColor(17, 24, 39); doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
  const nombreLineas = doc.splitTextToSize(emp.nombre || '', maxW).slice(0, 2);
  doc.text(nombreLineas, tx, y + 18);
  let ty = y + 18 + nombreLineas.length * 4.6 + 1;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(71, 85, 105);
  for (const linea of [emp.puesto, emp.plazas?.nombre].filter(Boolean)) {
    doc.text(doc.splitTextToSize(linea, maxW).slice(0, 1), tx, ty);
    ty += 4.4;
  }

  // Número de empleado (etiqueta inferior izquierda)
  if (emp.numero_empleado) {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(3, 105, 161);
    doc.text(`#${emp.numero_empleado}`, x + 5, y + H - 4);
  }

  // QR de verificación (esquina inferior derecha)
  if (qr) {
    const qs = 17, qx = x + W - qs - 4, qy = y + H - qs - 3;
    doc.addImage(qr, 'PNG', qx, qy, qs, qs);
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
