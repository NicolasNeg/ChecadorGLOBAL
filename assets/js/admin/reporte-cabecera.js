import * as api from './api.js';
import { esc } from './utils.js';

// Encabezado de identidad de empresa para los PDF (turnos, historial, cambios).
// Lee nombre/dirección/RFC/logo de config_global una sola vez por carga.
// ponytail: cache de módulo; recarga la página si cambias la identidad y quieres verla al instante.
let _cache = null;

export async function cabeceraReporteHTML() {
  if (!_cache) {
    try { _cache = Object.fromEntries((await api.getConfigGlobal()).map(c => [c.clave, c.valor])); }
    catch { _cache = {}; }
  }
  const nombre = _cache.nombre_empresa || '';
  const dir    = _cache.empresa_direccion || '';
  const rfc    = _cache.empresa_rfc || '';
  const logo   = _cache.empresa_logo_url || '';
  if (!nombre && !dir && !rfc && !logo) return ''; // sin identidad configurada → sin encabezado
  return `<header class="rpt-cab">
    ${logo ? `<img class="rpt-logo" src="${esc(logo)}" alt="">` : ''}
    <div class="rpt-empresa">
      ${nombre ? `<strong>${esc(nombre)}</strong>` : ''}
      ${dir ? `<span>${esc(dir)}</span>` : ''}
      ${rfc ? `<span>RFC: ${esc(rfc)}</span>` : ''}
    </div>
  </header>`;
}

export const CABECERA_CSS = `
  .rpt-cab{display:flex;align-items:center;gap:14px;border-bottom:2px solid #0f172a;padding-bottom:10px;margin:0 0 14px}
  .rpt-logo{height:46px;width:auto;object-fit:contain}
  .rpt-empresa{display:flex;flex-direction:column;line-height:1.35}
  .rpt-empresa strong{font-size:14px;color:#0f172a}
  .rpt-empresa span{font-size:10px;color:#64748b}`;
