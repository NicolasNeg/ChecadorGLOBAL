// api.js
import { SUPABASE_ANON_KEY, REST_BASE, SUPABASE_URL } from './config.js';

let _token = null;
let _idEmpleado = null; // Guardamos el ID para asociar los registros de asistencia

// ── VERIFICAR PIN ────────────────────────────────────────────────────────────
export async function verificarPin(pin) {
  try {
    const url = `${REST_BASE}/rpc/verificar_pin`;

    const respuesta = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
      },
      body: JSON.stringify({ p_pin: pin })
    });

    if (!respuesta.ok) return { ok: false, error: 'Error de respuesta del servidor.' };

    const datos = await respuesta.json();

    if (datos && datos.length > 0) {
      const e = datos[0];
      _token = SUPABASE_ANON_KEY;
      _idEmpleado = e.id;
      return {
        ok: true,
        idEmpleado:     e.id,
        nombre:         e.nombre,
        numeroEmpleado: e.numero_empleado,
        puesto:         e.puesto,
        email:          e.email,
        telefono:       e.telefono,
        rol:            e.rol,
        plazaId:        e.plaza_id,
        turnoId:        e.turno_id,
        plazaNombre:    e.plaza_nombre,
        turnoNombre:    e.turno_nombre,
        turnoEntrada:   e.turno_entrada,  // "HH:MM:SS" o null
        turnoSalida:    e.turno_salida
      };
    } else {
      return { ok: false, error: 'PIN incorrecto o usuario inactivo.' };
    }
  } catch (error) {
    console.error('Error en verificarPin:', error);
    return { ok: false, error: 'Error de conexión a la base de datos.' };
  }
}

// ── GUARDAR REGISTRO ──────────────────────────────────────────────────────────
export async function guardarRegistro({ tipoChecada, foto, firma, latitud, longitud }) {
  try {
    if (!_idEmpleado) return { ok: false, error: 'Sesión no válida o expirada.' };

    // 1. Subir la Foto en Base64 al Storage de Supabase
    const nombreFoto = `${_idEmpleado}_${Date.now()}_foto.png`;
    const rutaFoto = await subirBase64AStorage('fotos', nombreFoto, foto);

    // 2. Subir la Firma en Base64 al Storage de Supabase
    const nombreFirma = `${_idEmpleado}_${Date.now()}_firma.png`;
    const rutaFirma = await subirBase64AStorage('firmas', nombreFirma, firma);

    // 3. Insertar la fila directo en la tabla 'registros'
    const url = `${REST_BASE}/registros`;
    const respuesta = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Prefer': 'return=minimal' // Optimiza la inserción en Supabase
      },
      body: JSON.stringify({
        id_empleado: _idEmpleado,
        tipo: tipoChecada,
        latitud: latitud || null,
        longitud: longitud || null,
        ruta_foto: rutaFoto,
        ruta_firma: rutaFirma
      })
    });

    if (!respuesta.ok) {
      const errTxt = await respuesta.text();
      console.error('Error al insertar registro:', errTxt);
      let errMsg = 'No se pudo guardar la asistencia.';
      try {
        const parsed = JSON.parse(errTxt);
        const msg = parsed.message || parsed.details || '';
        if (msg.includes('FUERA_GEOCERCA')) {
          errMsg = msg.split('FUERA_GEOCERCA: ')[1] || 'Ubicación fuera del rango permitido.';
        } else if (msg.includes('UBICACION_REQUERIDA')) {
          errMsg = 'Se requiere ubicación GPS para registrar asistencia.';
        } else if (msg) {
          errMsg = msg;
        }
      } catch { /* use default */ }
      return { ok: false, error: errMsg };
    }

    return { ok: true };
  } catch (error) {
    console.error('Error en guardarRegistro:', error);
    return { ok: false, error: 'Error de red al guardar el registro.' };
  }
}

// ── OBTENER HISTORIAL (RPC: separado por empleado en el servidor) ────────────
export async function obtenerHistorial() {
  if (!_idEmpleado) return [];
  try {
    const r = await fetch(`${REST_BASE}/rpc/obtener_historial`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
      },
      body: JSON.stringify({ p_id_empleado: _idEmpleado, p_limit: 50 })
    });
    if (!r.ok) return null;
    const datos = await r.json();
    return datos.map(d => ({
      id: d.id,
      tipo: d.tipo,
      hora: d.hora,
      latitud: d.latitud,
      longitud: d.longitud,
      geocercaValida: d.geocerca_valida,
      foto:  d.ruta_foto  ? `${SUPABASE_URL}/storage/v1/object/public/${d.ruta_foto}`  : null,
      firma: d.ruta_firma ? `${SUPABASE_URL}/storage/v1/object/public/${d.ruta_firma}` : null
    }));
  } catch (error) {
    console.error('Error en obtenerHistorial:', error);
    return null;
  }
}

// ── ÚLTIMA ENTRADA (RPC: para calcular duración del turno) ──────────────────
export async function obtenerUltimaEntrada() {
  if (!_idEmpleado) return null;
  try {
    const r = await fetch(`${REST_BASE}/rpc/ultima_entrada`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
      },
      body: JSON.stringify({ p_id_empleado: _idEmpleado })
    });
    if (!r.ok) return null;
    return await r.json(); // timestamptz o null
  } catch { return null; }
}

// ── MIS TURNOS (RPC: horario semanal asignado por el admin) ─────────────────
export async function obtenerMisTurnos() {
  if (!_idEmpleado) return [];
  try {
    const r = await fetch(`${REST_BASE}/rpc/mis_turnos`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
      },
      body: JSON.stringify({ p_id_empleado: _idEmpleado })
    });
    if (!r.ok) return [];
    return await r.json(); // [{dia_semana, turno_nombre, hora_entrada, hora_salida, pausa_min}]
  } catch { return []; }
}

// ── TURNOS DE LA PLAZA (RPC: cuadrícula semanal de todos los compañeros) ────
export async function obtenerTurnosPlaza() {
  if (!_idEmpleado) return [];
  try {
    const r = await fetch(`${REST_BASE}/rpc/turnos_plaza`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
      },
      body: JSON.stringify({ p_id_empleado: _idEmpleado })
    });
    if (!r.ok) return [];
    return await r.json(); // [{empleado_id, empleado, dia_semana, turno_nombre, hora_entrada, hora_salida}]
  } catch { return []; }
}

// ── SET ID DESDE SESIÓN (para páginas que cargan con sessionStorage) ────────
export function setIdEmpleado(id) { _idEmpleado = id; }

// ── LIMPIAR SESIÓN ───────────────────────────────────────────────────────────
export function limpiarSesion() {
  _token = null;
  _idEmpleado = null;
}

// ── HELPER: Sube archivos Base64 al Storage de Supabase mediante REST ─────────
async function subirBase64AStorage(bucket, nombreArchivo, base64Data) {
  if (!base64Data) return null;

  // Limpiamos el prefijo 'data:image/png;base64,' para obtener el binario puro
  const byteString = atob(base64Data.split(',')[1]);
  const mimeString = base64Data.split(',')[0].split(':')[1].split(';')[0];
  const ab = new ArrayBuffer(byteString.length);
  const ia = new Uint8Array(ab);
  for (let i = 0; i < byteString.length; i++) {
    ia[i] = byteString.charCodeAt(i);
  }
  const blob = new Blob([ab], { type: mimeString });

  const url = `${SUPABASE_URL}/storage/v1/object/${bucket}/${nombreArchivo}`;

  const respuesta = await fetch(url, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': mimeString
    },
    body: blob
  });

  if (!respuesta.ok) {
    console.error(`Error subiendo a bucket ${bucket}:`, await respuesta.text());
    return null;
  }

  return `${bucket}/${nombreArchivo}`; // Devolvemos la ruta relativa guardada
}