import { requireSession } from './auth.js';
import { setIdEmpleado, guardarRegistro, obtenerUltimaEntrada, obtenerEstadoJornada, guardarDescriptorFacial } from './api.js';
import { cargarMotor, analizar, similitud, UMBRAL_SIMILITUD, UMBRAL_VIVEZA, UMBRAL_REAL } from './face.js';
import { BASE } from './config.js';
import { solicitarPermisos, streamCamara, coordenadas } from './permisos.js';
import { iniciarFirma, limpiarFirma, estaVacia, obtenerFirmaPNG } from './firma.js';
import { iniciarPreview, capturarFoto } from './camara.js';
import { direccionDesdeCoords, mapsLink } from './geo.js';
import { t, getLang, applyI18n, mountLangToggle } from './i18n.js';

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
const sEnrolar  = document.getElementById('s-enrolar');

const btmFirma   = document.getElementById('btm-firma');

const overlayLoad = document.getElementById('overlay-cargando');
const overlayOk   = document.getElementById('overlay-exito');

let firmaCleanup = null;
let current = 'cargando';
let estado = { dentro: false, horaEntrada: null }; // estado de jornada (fresco del servidor)
let timerId = null;
let timerModo = 'salida'; // 'entrada' = cuenta regresiva al turno; 'salida' = tiempo en turno
let faceLoopId = null;   // intervalo de análisis
let faceEscapeId = null; // timeout de 15s
const data = { tipo: null, firmaDataURL: null, fotoDataURL: null, rostroVerificado: false, viveza: null, similitud: null };

const ICON_ENTRADA = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>`;
const ICON_SALIDA  = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>`;

// ── Helpers ───────────────────────────────────────────────────────────────────
function showOnly(...els) {
  [sCargando, sTipo, sFirma, sFoto, sEnrolar].forEach(el => el.hidden = true);
  btmFirma.hidden = true;
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
  return `${t(s)}, ${nombre}`;
}

// ── Back button ───────────────────────────────────────────────────────────────
btnAtras.addEventListener('click', () => {
  detenerGateFacial();
  if (current === 'tipo' || current === 'cargando') location.href = BASE + '/';
  else if (current === 'firma') showTipo();
  else if (current === 'foto')  showFirma();
});

// ── TIPO SCREEN (auto: entrada si está fuera, salida si tiene jornada abierta) ─
function showTipo() {
  detenerGateFacial();
  current = 'tipo';
  showOnly(sTipo);
  headerTitle.textContent = t('Registrar asistencia');
  headerTag.hidden = true;
  setDots(1);
  document.getElementById('saludo-nombre').textContent = saludo(sesion.nombre);

  const card = document.getElementById('btn-checar');
  const jc   = document.getElementById('jornada-card');

  if (estado.dentro) {
    data.tipo = 'salida';
    card.className = 'tipo-card tipo-card--salida';
    document.getElementById('checar-icon').innerHTML = ICON_SALIDA;
    document.getElementById('checar-label').textContent = t('Registrar salida');
    document.getElementById('checar-sub').textContent   = t('Fin de jornada');
    document.getElementById('tipo-sub').textContent     = t('Tienes un turno abierto');
    jc.hidden = false;
    timerModo = 'salida';
    setTimerLabels(jc, t('En turno'), t('Para terminar'));
    pintarTurno();
    startTimer();
  } else {
    data.tipo = 'entrada';
    card.className = 'tipo-card tipo-card--entrada';
    document.getElementById('checar-icon').innerHTML = ICON_ENTRADA;
    document.getElementById('checar-label').textContent = t('Registrar entrada');
    document.getElementById('checar-sub').textContent   = t('Inicio de jornada');
    document.getElementById('tipo-sub').textContent     = t('¿Listo para iniciar tu jornada?');
    if (sesion.turnoEntrada) {
      jc.hidden = false;
      timerModo = 'entrada';
      setTimerLabels(jc, t('Faltan'), t('Tu entrada'));
      pintarTurno();
      startTimer();
    } else {
      jc.hidden = true;
      stopTimer();
    }
  }
}

// Sobreescribe las dos etiquetas del jornada-card según el modo del timer.
function setTimerLabels(jc, lbl1, lbl2) {
  const lbls = jc.querySelectorAll('.jornada-timer__lbl');
  if (lbls[0]) lbls[0].textContent = lbl1;
  if (lbls[1]) lbls[1].textContent = lbl2;
}

document.getElementById('btn-checar').addEventListener('click', () => { stopTimer(); showFirma(); });

// ── Temporizador de jornada (modo salida) ──────────────────────────────────────
const hm = (s) => s.slice(0, 5); // "08:00:00" → "08:00"

function pintarTurno() {
  const el = document.getElementById('jornada-turno');
  if (sesion.turnoEntrada && sesion.turnoSalida) {
    const nombre = sesion.turnoNombre ? `${sesion.turnoNombre} · ` : '';
    el.textContent = `${nombre}${hm(sesion.turnoEntrada)}–${hm(sesion.turnoSalida)}`;
  } else {
    el.textContent = t('Sin turno asignado');
  }
}

function fmtDur(ms) {
  if (ms < 0) ms = 0;
  const min = Math.floor(ms / 60000);
  const h = Math.floor(min / 60), m = min % 60;
  return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
}

function tick() {
  if (timerModo === 'entrada') return tickEntrada();
  const now = new Date();
  const ent = estado.horaEntrada ? new Date(estado.horaEntrada) : null;
  document.getElementById('timer-elapsed').textContent = ent ? fmtDur(now - ent) : '--';

  const rem = document.getElementById('timer-remaining');
  if (sesion.turnoSalida) {
    // ponytail: fin = hora de salida del turno HOY; turnos que cruzan medianoche
    // mostrarían "cumplido" antes de tiempo — añadir +1 día si turnoSalida<turnoEntrada.
    const [h, m, s] = sesion.turnoSalida.split(':').map(Number);
    const fin = new Date(now); fin.setHours(h, m, s || 0, 0);
    const d = fin - now;
    rem.textContent = d > 0 ? fmtDur(d) : t('Turno cumplido');
  } else {
    rem.textContent = '--';
  }
}

// Cuenta regresiva hasta la hora de entrada del turno (modo 'entrada').
function tickEntrada() {
  const now = new Date();
  const elapsed = document.getElementById('timer-elapsed');
  const rem = document.getElementById('timer-remaining');
  if (!sesion.turnoEntrada) { elapsed.textContent = '--'; rem.textContent = '--'; return; }
  const [h, m, s] = sesion.turnoEntrada.split(':').map(Number);
  const ini = new Date(now); ini.setHours(h, m, s || 0, 0);
  const d = ini - now;
  elapsed.textContent = d > 0 ? fmtDur(d) : t('Es tu hora');
  rem.textContent = hm(sesion.turnoEntrada);
}

function startTimer() { tick(); stopTimer(); timerId = setInterval(tick, 1000); }
function stopTimer()  { if (timerId) { clearInterval(timerId); timerId = null; } }

// ── FIRMA SCREEN ──────────────────────────────────────────────────────────────
function showFirma() {
  detenerGateFacial();
  current = 'firma';
  showOnly(sFirma, btmFirma);
  headerTitle.textContent = t('Tu firma');
  headerTag.textContent   = t(data.tipo === 'entrada' ? 'Entrada' : 'Salida');
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
  if (estaVacia()) { setError('error-firma', t('Dibuja tu firma antes de continuar.')); return; }
  setError('error-firma', '');
  data.firmaDataURL = obtenerFirmaPNG();
  showFoto();
});

// ── Gate facial helpers ────────────────────────────────────────────────────────
const FACE_ICON = {
  cargando:    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M21 12a9 9 0 1 1-6.2-8.5"/></svg>',
  sincara:     '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M9 10h.01M15 10h.01M9 15c1.5 1.2 4.5 1.2 6 0"/></svg>',
  verificando: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M21 12a9 9 0 1 1-6.2-8.5"/></svg>',
  liveness:    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
  enrolando:   '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M21 12a9 9 0 1 1-6.2-8.5"/></svg>',
  match:       '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
  error:       '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>',
};
const FACE_TXT = {
  cargando:    'Cargando verificación…',
  sincara:     'Centra tu rostro en el círculo',
  verificando: 'Verificando…',
  liveness:    'Mira a la cámara, sin fotos',
  enrolando:   'Registrando tu rostro…',
  match:       'Identidad verificada',
  error:       'No se pudo verificar',
};

function setFaceEstado(estado, ring = document.getElementById('face-ring'), chip = document.getElementById('face-chip')) {
  if (ring) ring.dataset.estado = estado;
  if (chip) {
    chip.dataset.estado = estado;
    chip.querySelector('.facescan__status-icon').innerHTML = FACE_ICON[estado] || '';
    chip.querySelector('.facescan__status-txt').textContent = t(FACE_TXT[estado] || '');
  }
}

function detenerGateFacial() {
  if (faceLoopId)   { clearInterval(faceLoopId); faceLoopId = null; }
  if (faceEscapeId) { clearTimeout(faceEscapeId); faceEscapeId = null; }
}

function habilitarTomarFoto() {
  const btn = document.getElementById('btn-tomar-foto');
  btn.disabled = false;
  btn.removeAttribute('aria-disabled');
  btn.classList.add('face-listo');
  if (navigator.vibrate) navigator.vibrate(40);
}

// ── FOTO SCREEN ───────────────────────────────────────────────────────────────
function showFoto() {
  current = 'foto';
  showOnly(sFoto);
  headerTitle.textContent = t('Foto de verificación');
  setDots(3);
  setError('error-camara', '');

  document.getElementById('sec-video').hidden   = false;
  document.getElementById('sec-preview').hidden = true;

  // Reset del gate: botón bloqueado, escape oculto.
  const btnFoto = document.getElementById('btn-tomar-foto');
  btnFoto.disabled = true; btnFoto.setAttribute('aria-disabled', 'true'); btnFoto.classList.remove('face-listo');
  const btnEscape = document.getElementById('btn-continuar-sin-verificar');
  btnEscape.hidden = true;
  data.rostroVerificado = false; data.viveza = null; data.similitud = null;

  const video = document.getElementById('video-preview');
  iniciarPreview(video, streamCamara);

  // Pre-calienta la dirección (geo.js cachea) para que la pantalla de éxito sea instantánea.
  if (coordenadas.latitud != null && coordenadas.longitud != null) {
    direccionDesdeCoords(coordenadas.latitud, coordenadas.longitud);
  }

  iniciarGateFacial(video, btnEscape);
}

async function iniciarGateFacial(video, btnEscape) {
  detenerGateFacial();
  setFaceEstado('cargando');

  // Escape a 15s: permite checar sin verificar (queda rostro_verificado=false).
  faceEscapeId = setTimeout(() => {
    btnEscape.hidden = false;
    btnEscape.onclick = () => { detenerGateFacial(); data.rostroVerificado = false; habilitarTomarFoto(); };
  }, 15000);

  try {
    await cargarMotor();
  } catch (e) {
    console.error('Human no cargó:', e);
    setFaceEstado('error');
    btnEscape.hidden = false;
    btnEscape.onclick = () => { detenerGateFacial(); data.rostroVerificado = false; habilitarTomarFoto(); };
    return;
  }

  // La inscripción es previa (showEnrolar), así que aquí siempre hay referencia.
  // Si faltara, permite checar sin verificar vía el botón de escape.
  const referencia = sesion.faceDescriptor || null;
  if (!referencia) {
    detenerGateFacial();
    setFaceEstado('error');
    btnEscape.hidden = false;
    btnEscape.onclick = () => { detenerGateFacial(); data.rostroVerificado = false; habilitarTomarFoto(); };
    return;
  }

  let ocupado = false;
  faceLoopId = setInterval(async () => {
    if (ocupado || current !== 'foto') return;
    ocupado = true;
    try {
      const cara = await analizar(video);
      if (!cara) { setFaceEstado('sincara'); return; }
      if (cara.real < UMBRAL_REAL || cara.live < UMBRAL_VIVEZA) { setFaceEstado('liveness'); return; }

      const sim = similitud(cara.embedding, referencia);
      if (sim >= UMBRAL_SIMILITUD) {
        data.rostroVerificado = true; data.viveza = cara.live; data.similitud = sim;
        setFaceEstado('match'); detenerGateFacial(); habilitarTomarFoto();
      } else {
        setFaceEstado('verificando');
      }
    } catch (e) {
      console.error('Error en análisis facial:', e);
    } finally {
      ocupado = false;
    }
  }, 400);
}

// ── ENROLAR ROSTRO (primera vez, antes de poder checar) ─────────────────────────
function showEnrolar() {
  detenerGateFacial();
  current = 'enrolar';
  showOnly(sEnrolar);
  headerTitle.textContent = t('Verificar rostro');
  headerTag.hidden = true;
  setDots(1);
  document.getElementById('enrolar-intro').hidden = false;
  document.getElementById('enrolar-stage').hidden = true;
  document.getElementById('enrolar-chip').hidden  = true;
  iniciarPreview(document.getElementById('video-enrolar'), streamCamara);
}

document.getElementById('btn-enrolar-comenzar').addEventListener('click', () => {
  document.getElementById('enrolar-intro').hidden = true;
  document.getElementById('enrolar-stage').hidden = false;
  document.getElementById('enrolar-chip').hidden  = false;
  gateEnrolar(document.getElementById('video-enrolar'));
});

document.getElementById('btn-enrolar-atras').addEventListener('click', () => {
  detenerGateFacial();
  location.href = BASE + '/';
});

async function gateEnrolar(video) {
  detenerGateFacial();
  const ring = document.getElementById('enrolar-ring');
  const chip = document.getElementById('enrolar-chip');
  const set  = (e) => setFaceEstado(e, ring, chip);
  set('cargando');

  try {
    await cargarMotor();
  } catch (e) {
    console.error('Human no cargó:', e);
    set('error');
    // ponytail: degradación — sin motor no hay inscripción; deja checar igual
    // (queda sin rostro de referencia, el checado validará liveness solamente).
    setTimeout(showTipo, 1800);
    return;
  }

  let ocupado = false;
  faceLoopId = setInterval(async () => {
    if (ocupado || current !== 'enrolar') return;
    ocupado = true;
    try {
      const cara = await analizar(video);
      if (!cara) { set('sincara'); return; }
      if (cara.real < UMBRAL_REAL || cara.live < UMBRAL_VIVEZA) { set('liveness'); return; }

      set('enrolando');
      const r = await guardarDescriptorFacial(cara.embedding);
      if (r.ok) {
        sesion.faceDescriptor = cara.embedding;
        set('match'); detenerGateFacial();
        if (navigator.vibrate) navigator.vibrate(40);
        setTimeout(showTipo, 1100);
      } else {
        set('error');
      }
    } catch (e) {
      console.error('Error en inscripción facial:', e);
    } finally {
      ocupado = false;
    }
  }, 400);
}

document.getElementById('btn-tomar-foto').addEventListener('click', () => {
  detenerGateFacial();
  data.fotoDataURL = capturarFoto(document.getElementById('video-preview'));
  document.getElementById('img-preview').src = data.fotoDataURL;
  document.getElementById('sec-video').hidden   = true;
  document.getElementById('sec-preview').hidden = false;
});

document.getElementById('btn-repetir-foto').addEventListener('click', () => {
  document.getElementById('sec-video').hidden   = false;
  document.getElementById('sec-preview').hidden = true;
});

// Botón atrás dentro del escáner (cubre la cabecera a pantalla completa).
document.getElementById('btn-foto-atras').addEventListener('click', () => {
  detenerGateFacial();
  showFirma();
});

const btnConfirmar = document.getElementById('btn-confirmar-foto');
btnConfirmar.addEventListener('click', async () => {
  setError('error-camara', '');
  btnConfirmar.disabled     = true;
  btnConfirmar.textContent  = t('Guardando…');
  overlayLoad.hidden        = false;

  const { latitud, longitud } = coordenadas;
  let res;
  try {
    res = await guardarRegistro({
      tipoChecada: data.tipo, foto: data.fotoDataURL, firma: data.firmaDataURL,
      latitud, longitud,
      rostroVerificado: data.rostroVerificado, viveza: data.viveza, similitud: data.similitud
    });
  } catch {
    res = { ok: false, error: t('Error de red. Intenta de nuevo.') };
  }

  overlayLoad.hidden = true;

  if (res.ok) {
    mostrarExito(data.tipo, data.fotoDataURL, coordenadas.latitud, coordenadas.longitud);
  } else {
    setError('error-camara', res.error ?? t('No se pudo guardar. Intenta de nuevo.'));
    btnConfirmar.disabled    = false;
    btnConfirmar.innerHTML   = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> ${t('Confirmar')}`;
  }
});

function mostrarExito(tipo, fotoDataURL, lat, lon) {
  const ahora = new Date();
  const loc = getLang() === 'en' ? 'en-US' : 'es-MX';
  const horaFmt  = ahora.toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit' });
  const fechaFmt = ahora.toLocaleDateString(loc, { weekday: 'long', day: 'numeric', month: 'long' });

  overlayOk.dataset.tipo = tipo;

  document.getElementById('exito-svg').innerHTML = `
    <circle cx="50" cy="50" r="45" fill="none" stroke="currentColor" stroke-width="6" class="check-circle"/>
    <polyline points="28,52 44,68 72,34" fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" class="check-mark"/>`;
  document.getElementById('exito-titulo').textContent  = t(tipo === 'entrada' ? '¡Entrada registrada!' : '¡Salida registrada!');
  document.getElementById('exito-hora').textContent   = horaFmt;
  document.getElementById('exito-fecha').textContent  = fechaFmt;

  // Horario de turno asignado (si existe)
  const turnoEl = document.getElementById('exito-turno');
  if (sesion.turnoEntrada && sesion.turnoSalida) {
    const hm = (s) => s.slice(0, 5); // "08:00:00" → "08:00"
    turnoEl.textContent = `${t('Turno')} ${hm(sesion.turnoEntrada)} – ${hm(sesion.turnoSalida)}`;
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
    ? `<img class="exito-foto" src="${fotoDataURL}" alt="${t('Tu foto de registro')}">`
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
      el.textContent = `${t('Turno de')} ${str}`;
      el.hidden = false;
    });
  }
}

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  mountLangToggle(document.querySelector('.app-header'));
  applyI18n(document);
  window.addEventListener('langchange', () => { applyI18n(document); if (current === 'tipo') showTipo(); });
  const permisos = await solicitarPermisos(() => {});
  if (permisos.camara === 'bloqueada' || permisos.ubicacion === 'bloqueada') {
    location.replace(BASE + '/sin-permisos.html');
    return;
  }
  // Estado fresco del servidor: la sesión puede estar obsoleta al re-entrar desde el menú.
  estado = await obtenerEstadoJornada();
  // Sin rostro registrado → inscripción obligatoria antes de poder checar.
  if (!sesion.faceDescriptor) showEnrolar();
  else showTipo();
}

init();
