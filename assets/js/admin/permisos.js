// Gating de UI por permiso. La VERDAD vive en Postgres (RLS); esto solo decide
// qué pinta el panel. La sesión guarda el arreglo `permisos` (ver auth.js).
// ponytail: si la sesión no trae permisos (RPC viejo/caído) → puede() = false,
// el panel oculta de más (falla cerrado). Upgrade: revalidar al cambiar de ruta.
import { getAdminSession } from './auth.js';

export function puede(clave) {
  const s = getAdminSession();
  return Array.isArray(s?.permisos) && s.permisos.includes(clave);
}

export const miNivel = () => getAdminSession()?.nivel ?? 0;
export const soyGlobal = () => getAdminSession()?.es_global === true;
