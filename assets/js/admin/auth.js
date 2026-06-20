import { SUPABASE_URL, SUPABASE_ANON_KEY, BASE } from '../config.js';

const KEY = 'eqs_admin_session';

export const getAdminSession  = () => { try { return JSON.parse(sessionStorage.getItem(KEY)); } catch { return null; } };
export const setAdminSession  = (d) => sessionStorage.setItem(KEY, JSON.stringify(d));
export const clearAdminSession = () => sessionStorage.removeItem(KEY);

export function requireAdminSession(redirect) {
  const s = getAdminSession();
  if (!s) { location.replace(redirect ?? (BASE + '/admin/')); return null; }
  return s;
}

// Supabase Auth: email + password → JWT token
export async function loginAdmin(email, password) {
  let res;
  try {
    res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON_KEY },
      body: JSON.stringify({ email, password })
    });
  } catch {
    return { ok: false, error: 'Sin conexión. Verifica tu red.' };
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    return { ok: false, error: err.error_description || 'Credenciales incorrectas.' };
  }

  const auth = await res.json();

  // Fetch admin profile from perfiles_admin
  const perfRes = await fetch(`${SUPABASE_URL}/rest/v1/perfiles_admin?select=*,plazas(id,nombre,latitud,longitud,radio_metros)`, {
    headers: {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${auth.access_token}`
    }
  });

  if (!perfRes.ok) return { ok: false, error: 'Sin perfil de administrador. Contacta a RH.' };
  const perfiles = await perfRes.json();
  if (!perfiles.length) return { ok: false, error: 'Sin perfil de administrador. Contacta a RH.' };

  const perfil = perfiles[0];
  if (!perfil.activo) return { ok: false, error: 'Tu acceso está inactivo. Contacta a RH.' };

  setAdminSession({
    ...perfil,
    access_token:  auth.access_token,
    refresh_token: auth.refresh_token,
    expires_at:    Date.now() + auth.expires_in * 1000
  });

  return { ok: true };
}

// Renueva el access_token con el refresh_token. Guard de una sola petición en
// vuelo para que N llamadas paralelas con token vencido no disparen N refreshes.
let _refreshing = null;
export function refreshAdminSession() {
  if (_refreshing) return _refreshing;
  const s = getAdminSession();
  if (!s?.refresh_token) return Promise.resolve(false);
  _refreshing = fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON_KEY },
    body: JSON.stringify({ refresh_token: s.refresh_token })
  }).then(async (res) => {
    if (!res.ok) return false;
    const auth = await res.json();
    setAdminSession({ ...s, access_token: auth.access_token, refresh_token: auth.refresh_token, expires_at: Date.now() + auth.expires_in * 1000 });
    return true;
  }).catch(() => false).finally(() => { _refreshing = null; });
  return _refreshing;
}

export async function logoutAdmin() {
  const s = getAdminSession();
  if (s?.access_token) {
    fetch(`${SUPABASE_URL}/auth/v1/logout`, {
      method: 'POST',
      headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${s.access_token}` }
    }).catch(() => {});
  }
  clearAdminSession();
  location.replace(BASE + '/admin/');
}
