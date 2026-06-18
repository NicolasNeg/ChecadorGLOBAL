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
      _token = SUPABASE_ANON_KEY;
      _idEmpleado = datos[0].id;
      return { ok: true, nombre: datos[0].nombre, idEmpleado: datos[0].id };
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
      return { ok: false, error: 'No se pudo guardar la asistencia.' };
    }

    return { ok: true };
  } catch (error) {
    console.error('Error en guardarRegistro:', error);
    return { ok: false, error: 'Error de red al guardar el registro.' };
  }
}

// ── OBTENER HISTORIAL ────────────────────────────────────────────────────────
export async function obtenerHistorial() {
  try {
    // Hace un JOIN automático pidiendo los campos del registro y el nombre de la tabla empleados
    const url = `${REST_BASE}/registros?select=*,empleados(nombre)&order=hora.desc&limit=20`;

    const respuesta = await fetch(url, {
      method: 'GET',
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
      }
    });

    if (!respuesta.ok) return null;

    const datos = await respuesta.json();

    // Mapeamos los datos limpios para que tu app.js y historial.js los rendericen sin problemas
    return datos.map(r => ({
      id: r.id,
      tipo: r.tipo,
      hora: r.hora,
      latitud: r.latitud,
      longitud: r.longitud,
      empleadoNombre: r.empleados?.nombre || 'Empleado'
    }));
  } catch (error) {
    console.error('Error en obtenerHistorial:', error);
    return null;
  }
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