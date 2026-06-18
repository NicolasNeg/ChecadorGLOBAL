const KEY = 'eqs_session';

export const getSession  = () => { try { return JSON.parse(sessionStorage.getItem(KEY)); } catch { return null; } };
export const setSession  = (data) => sessionStorage.setItem(KEY, JSON.stringify(data));
export const clearSession = () => sessionStorage.removeItem(KEY);

export function requireSession(redirect = '/') {
  const s = getSession();
  if (!s) { location.replace(redirect); return null; }
  return s;
}
