// Página pública de verificación de credencial. El QR del gafete apunta aquí
// con ?c=<uuid>. Llama la RPC verificar_credencial (solo datos públicos) y
// muestra el estado. No expone nada sensible y solo usa la anon key.
import { REST_BASE, SUPABASE_ANON_KEY } from './config.js';

const cont = document.getElementById('vf-contenido');
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ICONO_OK    = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`;
const ICONO_OFF   = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="4.9" y1="4.9" x2="19.1" y2="19.1"/></svg>`;
const ICONO_ERROR = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`;

function pintarMensaje(cls, icono, texto) {
  cont.innerHTML = `<div class="vf-estado vf-estado--${cls}">${icono}<span>${esc(texto)}</span></div>`;
}

function pintarCredencial(emp) {
  const initials = (emp.nombre || '').trim().split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  const foto = emp.foto_url
    ? `<img class="vf-foto" src="${esc(emp.foto_url)}" alt="Foto de ${esc(emp.nombre)}">`
    : `<div class="vf-foto">${esc(initials) || '–'}</div>`;
  const datos = [emp.puesto, emp.plaza_nombre].filter(Boolean).map((d) => `<span>${esc(d)}</span>`).join('');
  const estado = emp.activo
    ? `<div class="vf-estado vf-estado--ok">${ICONO_OK}<span>Empleado activo de EQS</span></div>`
    : `<div class="vf-estado vf-estado--off">${ICONO_OFF}<span>Credencial no vigente</span></div>`;
  cont.innerHTML = `
    ${foto}
    <p class="vf-nombre">${esc(emp.nombre)}</p>
    <div class="vf-datos">${datos}</div>
    ${emp.numero_empleado ? `<span class="vf-num">#${esc(emp.numero_empleado)}</span>` : ''}
    ${estado}`;
}

async function verificar() {
  const codigo = new URLSearchParams(location.search).get('c');
  if (!codigo || !UUID_RE.test(codigo)) {
    pintarMensaje('error', ICONO_ERROR, 'Credencial no válida.');
    return;
  }
  try {
    const r = await fetch(`${REST_BASE}/rpc/verificar_credencial`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
      body: JSON.stringify({ p_codigo: codigo }),
    });
    if (!r.ok) throw new Error('servidor');
    const d = await r.json();
    if (Array.isArray(d) && d.length) pintarCredencial(d[0]);
    else pintarMensaje('error', ICONO_ERROR, 'Credencial no válida.');
  } catch {
    pintarMensaje('error', ICONO_ERROR, 'No se pudo verificar. Revisa tu conexión e inténtalo de nuevo.');
  }
}

verificar();
