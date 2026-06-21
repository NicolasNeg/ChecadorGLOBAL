import { SUPABASE_URL, SUPABASE_ANON_KEY, BASE } from '../config.js';
import { getAdminSession, refreshAdminSession, clearAdminSession } from './auth.js';

function hdrs(extra = {}) {
  const s = getAdminSession();
  return {
    'apikey': SUPABASE_ANON_KEY,
    'Authorization': `Bearer ${s?.access_token}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation',
    ...extra
  };
}

// fetch con token; si vence (401) renueva una vez y reintenta. Si el refresh
// falla, la sesión está muerta → de vuelta al login.
export async function authedFetch(url, opts = {}) {
  let res = await fetch(url, { ...opts, headers: { ...hdrs(), ...opts.headers } });
  if (res.status === 401) {
    if (await refreshAdminSession()) {
      res = await fetch(url, { ...opts, headers: { ...hdrs(), ...opts.headers } });
    } else {
      clearAdminSession();
      location.replace(BASE + '/admin/');
    }
  }
  return res;
}

export async function apiFetch(path, opts = {}) {
  const res = await authedFetch(`${SUPABASE_URL}/rest/v1/${path}`, opts);
  if (res.status === 204) return null;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.message || body.details || body.hint || `Error ${res.status}`);
  return body;
}

// ── RPC helper ────────────────────────────────────────────────────────────
export async function rpc(fn, params = {}) {
  return apiFetch(`rpc/${fn}`, { method: 'POST', body: JSON.stringify(params) });
}

// ── Plazas ────────────────────────────────────────────────────────────────
export const getPlazas       = () => apiFetch('plazas?select=*&order=nombre.asc');
export const createPlaza     = (d) => apiFetch('plazas', { method: 'POST', body: JSON.stringify(d) });
export const updatePlaza     = (id, d) => apiFetch(`plazas?id=eq.${id}`, { method: 'PATCH', body: JSON.stringify(d) });
export const deletePlaza     = (id) => apiFetch(`plazas?id=eq.${id}`, { method: 'DELETE', headers: { 'Prefer': '' } });

// ── Turnos ────────────────────────────────────────────────────────────────
export const getTurnos       = (plazaId) => apiFetch(`turnos?select=*,plazas(nombre)${plazaId ? `&plaza_id=eq.${plazaId}` : ''}&order=nombre.asc`);
export const createTurno     = (d) => apiFetch('turnos', { method: 'POST', body: JSON.stringify(d) });
export const updateTurno     = (id, d) => apiFetch(`turnos?id=eq.${id}`, { method: 'PATCH', body: JSON.stringify(d) });
export const deleteTurno     = (id) => apiFetch(`turnos?id=eq.${id}`, { method: 'DELETE', headers: { 'Prefer': '' } });

// ── Empleados ─────────────────────────────────────────────────────────────
export const getEmpleados    = () => apiFetch('empleados?select=*,plazas(nombre),turnos(nombre)&order=nombre.asc');
export const updateEmpleado  = (id, d) => apiFetch(`empleados?id=eq.${id}`, { method: 'PATCH', body: JSON.stringify(d) });
export const crearEmpleado   = (d) => rpc('crear_empleado', d);
export const actualizarPin   = (id, pin) => rpc('actualizar_pin_empleado', { p_empleado_id: id, p_nuevo_pin: pin });

// Sube una foto de perfil al bucket público 'fotos' con la anon key (las
// políticas de storage permiten insert/read anon). Devuelve la URL pública.
export async function subirFotoPerfil(file) {
  const ext  = (file.name.split('.').pop() || 'jpg').toLowerCase();
  const path = `perfil/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/fotos/${path}`, {
    method: 'POST',
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': file.type },
    body: file
  });
  if (!res.ok) throw new Error('No se pudo subir la foto.');
  return `${SUPABASE_URL}/storage/v1/object/public/fotos/${path}`;
}

// ── Horarios semanales (asignación turno × día) ────────────────────────────
export const getHorarios = () => apiFetch('horarios_semana?select=id_empleado,dia_semana,turno_id');

export const setHorario = (id_empleado, dia_semana, turno_id) =>
  turno_id
    ? apiFetch('horarios_semana?on_conflict=id_empleado,dia_semana', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify({ id_empleado, dia_semana, turno_id })
      })
    : apiFetch(`horarios_semana?id_empleado=eq.${id_empleado}&dia_semana=eq.${dia_semana}`, {
        method: 'DELETE', headers: { Prefer: '' }
      });

// ── Asistencia ────────────────────────────────────────────────────────────
export function getRegistros({ fecha, plaza_id, limit = 100 } = {}) {
  const q = new URLSearchParams({ order: 'hora.desc', limit: limit.toString() });
  if (fecha) {
    q.set('hora', `gte.${fecha}T00:00:00`);
    // upper bound for single-day filter
    const next = new Date(fecha); next.setDate(next.getDate() + 1);
    q.set('hora', `gte.${fecha}T00:00:00`);
  }
  const filter = fecha ? `&hora=gte.${fecha}T00:00:00&hora=lte.${fecha}T23:59:59` : '';
  return apiFetch(`registros?select=id,tipo,hora,latitud,longitud,geocerca_valida,distancia_metros,empleados(id,nombre,plaza_id,plazas(nombre))${filter}&order=hora.desc&limit=${limit}`);
}

// ── Historial por empleado ──────────────────────────────────────────────────
export const getRegistrosEmpleado = (idEmpleado, { desde, hasta }) =>
  apiFetch(`registros?select=id,tipo,hora,latitud,longitud,geocerca_valida,distancia_metros,ruta_foto,ruta_firma` +
    `&id_empleado=eq.${idEmpleado}&hora=gte.${desde}T00:00:00&hora=lte.${hasta}T23:59:59&order=hora.asc`);

export const getEmpleado = (id) =>
  apiFetch(`empleados?select=*,plazas(nombre),turnos(*)&id=eq.${id}`).then((r) => r[0] ?? null);

// ── Incidencias ───────────────────────────────────────────────────────────────
export const getIncidencias = (idEmpleado, { desde, hasta }) =>
  apiFetch(`incidencias?select=*&id_empleado=eq.${idEmpleado}&fecha=gte.${desde}&fecha=lte.${hasta}&order=fecha.desc`);

export const createIncidencia = (d) =>
  apiFetch('incidencias', { method: 'POST', body: JSON.stringify(d) });

export const updateIncidencia = (id, d) =>
  apiFetch(`incidencias?id=eq.${id}`, { method: 'PATCH', body: JSON.stringify(d) });

export const deleteIncidencia = (id) =>
  apiFetch(`incidencias?id=eq.${id}`, { method: 'DELETE', headers: { 'Prefer': '' } });

// Sube una imagen adjunta de nota al bucket público 'fotos' (carpeta notas/).
export async function subirImagenNota(file) {
  const ext  = (file.name.split('.').pop() || 'jpg').toLowerCase();
  const path = `notas/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/fotos/${path}`, {
    method: 'POST',
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': file.type },
    body: file
  });
  if (!res.ok) throw new Error('No se pudo subir la imagen.');
  return `${SUPABASE_URL}/storage/v1/object/public/fotos/${path}`;
}

// ── Audit log ─────────────────────────────────────────────────────────────
export const getAuditLog = (limit = 50) =>
  apiFetch(`audit_log?select=*,perfiles_admin(nombre)&order=created_at.desc&limit=${limit}`);

// ── Stats ─────────────────────────────────────────────────────────────────
export const countPlazas     = () => apiFetch('plazas?select=id&activo=eq.true', { headers: { 'Prefer': 'count=exact' } });
export const countEmpleados  = () => apiFetch('empleados?select=id&activo=eq.true', { headers: { 'Prefer': 'count=exact' } });

export async function statsHoy() {
  const hoy = new Date().toISOString().slice(0, 10);
  const [total, incid] = await Promise.all([
    authedFetch(`${SUPABASE_URL}/rest/v1/registros?select=id&hora=gte.${hoy}T00:00:00&hora=lte.${hoy}T23:59:59`, {
      headers: { 'Prefer': 'count=exact' }
    }),
    authedFetch(`${SUPABASE_URL}/rest/v1/registros?select=id&geocerca_valida=eq.false&hora=gte.${hoy}T00:00:00`, {
      headers: { 'Prefer': 'count=exact' }
    })
  ]);
  return {
    hoy:        parseInt(total.headers.get('Content-Range')?.split('/')?.[1] ?? '0'),
    incidencias: parseInt(incid.headers.get('Content-Range')?.split('/')?.[1] ?? '0')
  };
}
