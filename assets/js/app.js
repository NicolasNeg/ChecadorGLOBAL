import { solicitarPermisos, streamCamara, coordenadas } from './permisos.js';
import { iniciarFirma, limpiarFirma, estaVacia, obtenerFirmaPNG } from './firma.js';
import { iniciarPreview, capturarFoto } from './camara.js';
import { renderHistorial } from './historial.js';
import { verificarPin, guardarRegistro, obtenerHistorial, limpiarSesion } from './api.js';

// ── Estado de sesión ──────────────────────────────────────────────────────────
const sesion = { nombre: '', tipo: null, fotoDataURL: null };

// ── Utilidades de pantalla ───────────────────────────────────────────────────
function mostrar(id) {
  document.querySelectorAll('.pantalla').forEach((el) => el.hidden = true);
  document.getElementById(id).hidden = false;
}

function setError(id, msg) {
  const el = document.getElementById(id);
  if (el) { el.textContent = msg; el.hidden = !msg; }
}

// ── PANTALLA: Permisos ───────────────────────────────────────────────────────
async function iniciarPermisos() {
  mostrar('pantalla-permisos');

  const actualizar = (estado) => {
    ['camara', 'ubicacion'].forEach((p) => {
      const el = document.getElementById(`estado-${p}`);
      if (el) {
        el.textContent = { pendiente: 'Pendiente', activa: 'Activa', bloqueada: 'Bloqueada' }[estado[p]];
        el.className = `permiso-estado permiso-estado--${estado[p]}`;
      }
    });
    if (estado.camara === 'activa' && estado.ubicacion === 'activa') {
      setTimeout(iniciarPin, 400);
    }
  };

  document.getElementById('btn-reintentar').addEventListener('click', () => iniciarPermisos());
  await solicitarPermisos(actualizar);
}

// ── PANTALLA: PIN ────────────────────────────────────────────────────────────
// ── PANTALLA: PIN ────────────────────────────────────────────────────────────
function iniciarPin() {
  mostrar('pantalla-pin');
  setError('error-pin', '');
  const input = document.getElementById('input-pin');
  input.value = '';
  input.focus();
  document.getElementById('btn-continuar-pin').onclick = async () => {
    const pin = input.value.trim();
    setError('error-pin', '');

    console.log("Intentando validar PIN:", pin); // Diagnóstico 1

    try {
      const res = await verificarPin(pin);

      console.log("Respuesta de Supabase:", res); // Diagnóstico 2

      if (res && res.ok) {
        console.log("PIN correcto, iniciando menú para:", res.nombre); // Diagnóstico 3
        sesion.nombre = res.nombre;
        iniciarMenu();
      } else {
        console.log("PIN incorrecto o error:", res.error); // Diagnóstico 4
        setError('error-pin', res?.error || 'PIN incorrecto.');
      }
    } catch (error) {
      console.error("Error crítico:", error);
      setError('error-pin', 'Error de conexión.');
    }
  };
}

// ── PANTALLA: Menú ───────────────────────────────────────────────────────────
function iniciarMenu() {
  mostrar('pantalla-menu');
  document.getElementById('saludo').textContent = `Hola, ${sesion.nombre}`;

  document.getElementById('btn-checar').onclick = () => iniciarTipo();
  document.getElementById('btn-historial').onclick = () => irHistorial();
  document.getElementById('btn-cerrar-sesion').onclick = () => {
    limpiarSesion();
    iniciarPin();
  };
}

// ── PANTALLA: Elegir tipo ────────────────────────────────────────────────────
function iniciarTipo() {
  mostrar('pantalla-tipo');

  document.getElementById('btn-entrada').onclick = () => {
    sesion.tipo = 'entrada';
    iniciarFirmaPantalla();
  };
  document.getElementById('btn-salida').onclick = () => {
    sesion.tipo = 'salida';
    iniciarFirmaPantalla();
  };
  document.getElementById('btn-volver-tipo').onclick = iniciarMenu;
}

// ── PANTALLA: Firma ──────────────────────────────────────────────────────────
let _firmaCleanup = null;
function iniciarFirmaPantalla() {
  mostrar('pantalla-firma');
  const canvas = document.getElementById('canvas-firma');
  if (_firmaCleanup) _firmaCleanup();
  _firmaCleanup = iniciarFirma(canvas);

  document.getElementById('btn-limpiar-firma').onclick = limpiarFirma;
  document.getElementById('btn-continuar-firma').onclick = () => {
    if (estaVacia()) {
      setError('error-firma', 'Dibuja tu firma antes de continuar.');
      return;
    }
    setError('error-firma', '');
    sesion.firmaDataURL = obtenerFirmaPNG();
    iniciarCamaraPantalla();
  };
  document.getElementById('btn-volver-firma').onclick = iniciarTipo;
}

// ── PANTALLA: Cámara ─────────────────────────────────────────────────────────
function iniciarCamaraPantalla() {
  mostrar('pantalla-camara');
  const video = document.getElementById('video-preview');
  const preview = document.getElementById('img-preview');
  const secVid = document.getElementById('sec-video');
  const secPrev = document.getElementById('sec-preview');

  iniciarPreview(video, streamCamara);
  secVid.hidden = false;
  secPrev.hidden = true;
  setError('error-camara', '');

  document.getElementById('btn-tomar-foto').onclick = () => {
    sesion.fotoDataURL = capturarFoto(video);
    preview.src = sesion.fotoDataURL;
    secVid.hidden = true;
    secPrev.hidden = false;
  };

  document.getElementById('btn-repetir-foto').onclick = () => {
    secVid.hidden = false;
    secPrev.hidden = true;
  };

  document.getElementById('btn-confirmar-foto').onclick = async () => {
    setError('error-camara', '');
    const { latitud, longitud } = coordenadas;
    try {
      const res = await guardarRegistro({
        tipoChecada: sesion.tipo,
        foto: sesion.fotoDataURL,
        firma: sesion.firmaDataURL,
        latitud,
        longitud,
      });
      if (res.ok) {
        mostrarExito(sesion.tipo);
      } else {
        setError('error-camara', res.error ?? 'No se pudo guardar. Intenta de nuevo.');
      }
    } catch {
      setError('error-camara', 'Error de conexión. Intenta de nuevo.');
    }
  };

  document.getElementById('btn-volver-camara').onclick = iniciarFirmaPantalla;
}

// ── Overlay de éxito ─────────────────────────────────────────────────────────
function mostrarExito(tipo) {
  const overlay = document.getElementById('overlay-exito');
  const msg = document.getElementById('exito-mensaje');
  const check = document.getElementById('exito-svg');

  msg.textContent = tipo === 'entrada' ? '¡Entrada registrada!' : '¡Salida registrada!';
  overlay.dataset.tipo = tipo;
  overlay.hidden = false;

  // Animación SVG check
  check.innerHTML = `
    <circle cx="50" cy="50" r="45" fill="none" stroke="currentColor" stroke-width="6"
      class="check-circle"/>
    <polyline points="28,52 44,68 72,34" fill="none" stroke="currentColor" stroke-width="6"
      stroke-linecap="round" stroke-linejoin="round" class="check-mark"/>`;

  setTimeout(() => {
    overlay.hidden = true;
    iniciarMenu();
  }, 2500);
}

// ── PANTALLA: Historial ──────────────────────────────────────────────────────
async function irHistorial() {
  mostrar('pantalla-historial');
  const contenedor = document.getElementById('contenedor-historial');
  contenedor.innerHTML = '<p class="cargando">Cargando…</p>';

  try {
    const registros = await obtenerHistorial();
    if (Array.isArray(registros)) {
      renderHistorial(contenedor, registros);
    } else {
      contenedor.innerHTML = '<p class="error-txt">No se pudo cargar el historial.</p>';
    }
  } catch {
    contenedor.innerHTML = '<p class="error-txt">Error de conexión.</p>';
  }

  document.getElementById('btn-volver-historial').onclick = iniciarMenu;
}

// ── Arranque ─────────────────────────────────────────────────────────────────
iniciarPermisos();
