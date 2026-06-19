import { requireSession } from './auth.js';
import { setIdEmpleado, guardarRegistro, obtenerUltimaEntrada } from './api.js';
import { BASE } from './config.js';
import { solicitarPermisos, streamCamara, coordenadas } from './permisos.js';
import { iniciarFirma, limpiarFirma, estaVacia, obtenerFirmaPNG } from './firma.js';
import { iniciarPreview, capturarFoto } from './camara.js';
import { direccionDesdeCoords, mapsLink } from './geo.js';

const sesion = requireSession();
if (!sesion) throw new Error('sin sesión');

setIdEmpleado(sesion.idEmpleado);

// ── Elementos ─────────────────────────────────────────────────────────────────
const btnAtras    = document.getElementById('btn-atras');
const headerTitle = document.getElementById('header-title');
const headerTag   = document.getElementById('header-tag');
const dot1 = document.getElementById('dot-1');
const dot2 = document.getElementById('dot-2');
const dot3 = document.getElementById('dot-3');

const sCargando = document.getElementById('s-cargando');
const sTipo     = document.getElementById('s-tipo');
const sFirma    = document.getElementById('s-firma');
const sFoto     = document.getElementById('s-foto');

const btmFirma   = document.getElementById('btm-firma');
const btmFoto    = document.getElementById('btm-foto');
const btmConfirm = document.getElementById('btm-confirm');

const overlayLoad = document.getElementById('overlay-cargando');
const overlayOk   = document.getElementById('overlay-exito');

let firmaCleanup = null;
let current = 'cargando';
const data = { tipo: null, firmaDataURL: null, fotoDataURL: null };

// ── Helpers ───────────────────────────────────────────────────────────────────
function showOnly(...els) {
  [sCargando, sTipo, sFirma, sFoto].forEach(el => el.hidden = true);
  [btmFirma, btmFoto, btmConfirm].forEach(el => el.hidden = true);
  els.forEach(el => { if (el) el.hidden = false; });
}

function setDots(active) {
  [dot1, dot2, dot3].forEach((d, i) => {
    d.className = 'step-dot' +
      (i + 1 < active ? ' step-dot--done' : i + 1 === active ? ' step-dot--active' : '');
  });
}

function setError(id, msg) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = msg;
  el.hidden = !msg;
}

function saludo(nombre) {
  const h = new Date().getHours();
  const s = h < 12 ? 'Buenos días' : h < 19 ? 'Buenas tardes' : 'Buenas noches';
  return `${s}, ${nombre}`;
}

// ── Back button ───────────────────────────────────────────────────────────────
btnAtras.addEventListener('click', () => {
  if (current === 'tipo' || current === 'cargando') location.href = BASE + '/';
  else if (current === 'firma') showTipo();
  else if (current === 'foto')  showFirma();
});

// ── TIPO SCREEN ───────────────────────────────────────────────────────────────
function showTipo() {
  current = 'tipo';
  showOnly(sTipo);
  headerTitle.textContent = 'Registrar asistencia';
  headerTag.hidden = true;
  setDots(1);
  document.getElementById('saludo-nombre').textContent = saludo(sesion.nombre);
}

document.getElementById('btn-entrada').addEventListener('click', () => { data.tipo = 'entrada'; showFirma(); });
document.getElementById('btn-salida').addEventListener('click',  () => { data.tipo = 'salida';  showFirma(); });

// ── FIRMA SCREEN ──────────────────────────────────────────────────────────────
function showFirma() {
  current = 'firma';
  showOnly(sFirma, btmFirma);
  headerTitle.textContent = 'Tu firma';
  headerTag.textContent   = data.tipo === 'entrada' ? 'Entrada' : 'Salida';
  headerTag.className     = `app-header__tag app-header__tag--${data.tipo}`;
  headerTag.hidden        = false;
  setDots(2);
  setError('error-firma', '');

  const canvas = document.getElementById('canvas-firma');
  if (firmaCleanup) firmaCleanup();
  firmaCleanup = iniciarFirma(canvas);
}

document.getElementById('btn-limpiar-firma').addEventListener('click', limpiarFirma);
document.getElementById('btn-continuar-firma').addEventListener('click', () => {
  if (estaVacia()) { setError('error-firma', 'Dibuja tu firma antes de continuar.'); return; }
  setError('error-firma', '');
  data.firmaDataURL = obtenerFirmaPNG();
  showFoto();
});

// ── FOTO SCREEN ───────────────────────────────────────────────────────────────
function showFoto() {
  current = 'foto';
  showOnly(sFoto, btmFoto);
  headerTitle.textContent = 'Foto de verificación';
  setDots(3);
  setError('error-camara', '');

  document.getElementById('sec-video').hidden   = false;
  document.getElementById('sec-preview').hidden = true;
  iniciarPreview(document.getElementById('video-preview'), streamCamara);

  // Pre-calienta la dirección (geo.js cachea) para que la pantalla de éxito sea instantánea.
  if (coordenadas.latitud != null && coordenadas.longitud != null) {
    direccionDesdeCoords(coordenadas.latitud, coordenadas.longitud);
  }
}

document.getElementById('btn-tomar-foto').addEventListener('click', () => {
  data.fotoDataURL = capturarFoto(document.getElementById('video-preview'));
  document.getElementById('img-preview').src = data.fotoDataURL;
  document.getElementById('sec-video').hidden   = true;
  document.getElementById('sec-preview').hidden = false;
  btmFoto.hidden    = true;
  btmConfirm.hidden = false;
});

document.getElementById('btn-repetir-foto').addEventListener('click', () => {
  document.getElementById('sec-video').hidden   = false;
  document.getElementById('sec-preview').hidden = true;
  btmFoto.hidden    = false;
  btmConfirm.hidden = true;
});

const btnConfirmar = document.getElementById('btn-confirmar-foto');
btnConfirmar.addEventListener('click', async () => {
  setError('error-camara', '');
  btnConfirmar.disabled     = true;
  btnConfirmar.textContent  = 'Guardando…';
  overlayLoad.hidden        = false;

  const { latitud, longitud } = coordenadas;
  let res;
  try {
    res = await guardarRegistro({ tipoChecada: data.tipo, foto: data.fotoDataURL, firma: data.firmaDataURL, latitud, longitud });
  } catch {
    res = { ok: false, error: 'Error de red. Intenta de nuevo.' };
  }

  overlayLoad.hidden = true;

  if (res.ok) {
    mostrarExito(data.tipo, data.fotoDataURL, coordenadas.latitud, coordenadas.longitud);
  } else {
    setError('error-camara', res.error ?? 'No se pudo guardar. Intenta de nuevo.');
    btnConfirmar.disabled    = false;
    btnConfirmar.innerHTML   = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> Confirmar`;
  }
});

function mostrarExito(tipo, fotoDataURL, lat, lon) {
  const ahora = new Date();
  const horaFmt  = ahora.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
  const fechaFmt = ahora.toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' });

  overlayOk.dataset.tipo = tipo;

  document.getElementById('exito-svg').innerHTML = `
    <circle cx="50" cy="50" r="45" fill="none" stroke="currentColor" stroke-width="6" class="check-circle"/>
    <polyline points="28,52 44,68 72,34" fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" class="check-mark"/>`;
  document.getElementById('exito-titulo').textContent  = tipo === 'entrada' ? '¡Entrada registrada!' : '¡Salida registrada!';
  document.getElementById('exito-hora').textContent   = horaFmt;
  document.getElementById('exito-fecha').textContent  = fechaFmt;

  // Horario de turno asignado (si existe)
  const turnoEl = document.getElementById('exito-turno');
  if (sesion.turnoEntrada && sesion.turnoSalida) {
    const hm = (t) => t.slice(0, 5); // "08:00:00" → "08:00"
    turnoEl.textContent = `Turno ${hm(sesion.turnoEntrada)} – ${hm(sesion.turnoSalida)}`;
    turnoEl.hidden = false;
  } else {
    turnoEl.hidden = true;
  }

  // Ubicación como dirección legible (click → Google Maps). Más confiable que el
  // mapa estático y ya pre-calentada desde showFoto(), así sale al instante.
  const ubicEl  = document.getElementById('exito-ubic');
  const ubicTxt = document.getElementById('exito-ubic-txt');
  if (lat != null && lon != null) {
    ubicEl.href = mapsLink(lat, lon);
    ubicEl.hidden = false;
    direccionDesdeCoords(lat, lon).then((dir) => {
      ubicTxt.textContent = dir || `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
    });
  } else {
    ubicEl.hidden = true;
  }

  const fotoHtml = fotoDataURL
    ? `<img class="exito-foto" src="${fotoDataURL}" alt="Tu foto de registro">`
    : '';

  document.getElementById('exito-media').innerHTML = fotoHtml;
  document.getElementById('exito-media').hidden = !fotoHtml;

  overlayOk.hidden = false;
  setTimeout(() => { location.href = BASE + '/'; }, 3000);

  // Load shift duration async for salida (non-blocking — updates if it arrives in time)
  if (tipo === 'salida') {
    obtenerUltimaEntrada().then(horaEntrada => {
      if (!horaEntrada) return;
      const diff = ahora - new Date(horaEntrada);
      if (diff <= 0) return;
      const h = Math.floor(diff / 3_600_000);
      const m = Math.floor((diff % 3_600_000) / 60_000);
      const str = h > 0 ? `${h}h ${m}min` : `${m} min`;
      const el = document.getElementById('exito-duracion');
      el.textContent = `Turno de ${str}`;
      el.hidden = false;
    });
  }
}

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  const estado = await solicitarPermisos(() => {});
  if (estado.camara === 'bloqueada' || estado.ubicacion === 'bloqueada') {
    location.replace(BASE + '/sin-permisos.html');
    return;
  }
  showTipo();
}

init();
