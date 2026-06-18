import { SUPABASE_ANON_KEY, FUNCTIONS_BASE } from './config.js';

let _token = null;

const baseHeaders = () => ({
  'apikey': SUPABASE_ANON_KEY,
  'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
  'Content-Type': 'application/json',
});

const authHeaders = () => ({
  ...baseHeaders(),
  'x-checador-token': _token ?? '',
});

async function post(endpoint, body, headers) {
  const res = await fetch(`${FUNCTIONS_BASE}/${endpoint}`, {
    method: 'POST',
    headers: headers ?? baseHeaders(),
    body: JSON.stringify(body),
  });
  if (!res.ok && res.status !== 200) {
    throw new Error(`HTTP ${res.status}`);
  }
  return res.json();
}


export async function verificarPin(pin) {
  try {
    // Apuntamos directamente a la RPC de Postgres (/rpc/nombre_de_la_funcion)
    const url = `${REST_BASE}/rpc/verificar_pin`;

    const respuesta = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
      },
      body: JSON.stringify({ p_pin: pin }) // Enviamos p_pin tal como lo definimos en el SQL
    });

    if (!respuesta.ok) {
      return { ok: false, error: 'Error de respuesta del servidor.' };
    }

    const datos = await respuesta.json();

    // Si Postgres encuentra al usuario, devolverá un array con sus datos: [{id: 1, nombre: "Nicolas"}]
    if (datos && datos.length > 0) {
      // Guardamos la anon key como token provisional para mantener la lógica de tu app
      _token = SUPABASE_ANON_KEY;

      return {
        ok: true,
        nombre: datos[0].nombre
      };
    } else {
      return { ok: false, error: 'PIN incorrecto o usuario inactivo.' };
    }
  } catch (error) {
    console.error('Error en verificarPin:', error);
    return { ok: false, error: 'Error de conexión a la base de datos.' };
  }
}

export function limpiarSesion() {
  _token = null;
}

export async function guardarRegistro({ tipoChecada, foto, firma, latitud, longitud }) {
  return post('guardar-registro', { tipoChecada, foto, firma, latitud, longitud }, authHeaders());
}

export async function obtenerHistorial() {
  return post('obtener-historial', {}, authHeaders());
}
