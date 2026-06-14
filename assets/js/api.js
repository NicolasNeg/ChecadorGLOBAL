import { SUPABASE_ANON_KEY, FUNCTIONS_BASE } from './config.js';

let _token = null;

const baseHeaders = () => ({
  'apikey':        SUPABASE_ANON_KEY,
  'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
  'Content-Type':  'application/json',
});

const authHeaders = () => ({
  ...baseHeaders(),
  'x-checador-token': _token ?? '',
});

async function post(endpoint, body, headers) {
  const res = await fetch(`${FUNCTIONS_BASE}/${endpoint}`, {
    method:  'POST',
    headers: headers ?? baseHeaders(),
    body:    JSON.stringify(body),
  });
  if (!res.ok && res.status !== 200) {
    throw new Error(`HTTP ${res.status}`);
  }
  return res.json();
}

export async function verificarPin(pin) {
  const data = await post('verificar-pin', { pin });
  if (data.ok) _token = data.token;
  return data;
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
