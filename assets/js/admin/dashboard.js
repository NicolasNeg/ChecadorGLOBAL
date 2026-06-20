import { requireAdminSession, logoutAdmin } from './auth.js';
import { statsHoy } from './api.js';
import { getAuditLog } from './api.js';
import { fmtFecha } from './utils.js';

const sesion = requireAdminSession();
// auth.js guarda el perfil aplanado en la sesión: rol/nombre están en la raíz.
const esRH   = sesion?.rol === 'rh';

// ── Role-based UI ─────────────────────────────────────────────────────────────
if (!esRH) {
  document.querySelectorAll('[data-rh-only]').forEach(el => el.remove());
}
document.getElementById('admin-nombre').textContent = sesion?.nombre ?? 'Admin';
document.getElementById('admin-rol-badge').textContent = esRH ? 'Recursos Humanos' : 'Jefe de Plaza';

// ── Sidebar nav + routing ─────────────────────────────────────────────────────
const panels = document.querySelectorAll('.admin-panel');
const navLinks = document.querySelectorAll('.sidebar__link[data-panel]');
const pageTitle = document.getElementById('page-title');
const _loaded = {};

async function showPanel(id) {
  panels.forEach(p => p.hidden = true);
  navLinks.forEach(l => l.classList.toggle('active', l.dataset.panel === id));

  const panel = document.getElementById(`panel-${id}`);
  if (!panel) return;
  panel.hidden = false;
  pageTitle.textContent = panel.dataset.title ?? id;

  if (id === 'historial') {
    const m = await import('./historial-empleado.js');
    await m.init(panel);
    return;
  }

  if (_loaded[id]) return;
  _loaded[id] = true;

  switch (id) {
    case 'overview':   await loadOverview(panel); break;
    case 'plazas':     { const m = await import('./plazas.js');    await m.init(panel); break; }
    case 'empleados':  { const m = await import('./empleados.js'); await m.init(panel); break; }
    case 'turnos':     { const m = await import('./turnos.js');    await m.init(panel); break; }
    case 'asistencia': {
      const m = await import('./asistencia.js');
      await m.init(panel, sesion);
      break;
    }
    case 'auditoria':  await loadAuditoria(panel); break;
  }
}

navLinks.forEach(link => {
  link.addEventListener('click', (e) => {
    e.preventDefault();
    const id = link.dataset.panel;
    history.pushState(null, '', `#${id}`);
    showPanel(id);
    closeSidebar();
  });
});

window.addEventListener('popstate', () => {
  showPanel(location.hash.slice(1) || 'overview');
});

// ── Mobile sidebar ────────────────────────────────────────────────────────────
const sidebar  = document.getElementById('sidebar');
const overlay  = document.getElementById('sidebar-overlay');
const hamburger = document.getElementById('btn-hamburger');

hamburger?.addEventListener('click', () => {
  const isOpen = sidebar.classList.toggle('open');
  overlay?.classList.toggle('open', isOpen);
});
overlay?.addEventListener('click', closeSidebar);
function closeSidebar() {
  sidebar.classList.remove('open');
  overlay?.classList.remove('open');
}

// ── Logout ────────────────────────────────────────────────────────────────────
document.getElementById('btn-logout')?.addEventListener('click', logoutAdmin);

// ── Overview stats ────────────────────────────────────────────────────────────
async function loadOverview(panel) {
  panel.innerHTML = `
    <div class="panel-header"><h2>Resumen del día</h2></div>
    <div class="stat-grid" id="stat-grid">
      ${['Empleados activos','Plazas','Registros hoy','Incidencias hoy'].map(l =>
        `<div class="stat-card stat-card--loading"><div class="stat-card__label">${l}</div><div class="stat-card__value">—</div></div>`
      ).join('')}
    </div>`;

  try {
    const [empRes, plazasRes, hoyStats] = await Promise.all([
      import('./api.js').then(a => a.countEmpleados()),
      import('./api.js').then(a => a.countPlazas()),
      statsHoy()
    ]);

    const grid = document.getElementById('stat-grid');
    if (!grid) return;
    const vals = [
      empRes?.length ?? 0,
      plazasRes?.length ?? 0,
      hoyStats.hoy,
      hoyStats.incidencias
    ];
    const labels  = ['Empleados activos','Plazas','Registros hoy','Incidencias hoy'];
    const colors  = ['--ad-primary','#16A34A','#0EA5E9','#DC2626'];

    grid.innerHTML = vals.map((v, i) => `
      <div class="stat-card">
        <div class="stat-card__label">${labels[i]}</div>
        <div class="stat-card__value" style="color:${colors[i]}">${v}</div>
      </div>`).join('');
  } catch {
    document.getElementById('stat-grid').innerHTML =
      `<p style="color:#DC2626;padding:16px">Error cargando estadísticas.</p>`;
  }
}

// ── Audit log panel ───────────────────────────────────────────────────────────
async function loadAuditoria(panel) {
  panel.innerHTML = `
    <div class="panel-header"><h2>Log de Auditoría</h2></div>
    <div class="ad-card"><div id="audit-wrap">
      <div class="ad-loading"><div class="ad-spinner"></div> Cargando…</div>
    </div></div>`;
  try {
    const rows = await getAuditLog(100);
    const wrap = document.getElementById('audit-wrap');
    if (!rows.length) { wrap.innerHTML = '<div class="ad-empty">Sin registros.</div>'; return; }

    wrap.innerHTML = `<div class="table-scroll"><table class="data-table">
      <thead><tr>
        <th>Fecha</th><th>Tabla</th><th>Operación</th><th>Admin</th><th>Detalle</th>
      </tr></thead>
      <tbody>${rows.map(r => `<tr>
        <td>${fmtFecha(r.created_at)}</td>
        <td><code>${r.tabla}</code></td>
        <td><span class="abadge abadge--${r.operacion === 'DELETE' ? 'red' : r.operacion === 'INSERT' ? 'green' : 'blue'}">${r.operacion}</span></td>
        <td>${r.perfiles_admin?.nombre ?? '–'}</td>
        <td style="font-size:.78rem;max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${JSON.stringify(r.datos_despues ?? r.datos_antes).replace(/"/g,'&quot;')}">
          ID ${r.registro_id}
        </td>
      </tr>`).join('')}</tbody>
    </table></div>`;
  } catch (e) {
    document.getElementById('audit-wrap').innerHTML =
      `<div class="ad-empty" style="color:#DC2626">${e.message}</div>`;
  }
}

// ── Init ──────────────────────────────────────────────────────────────────────
showPanel(location.hash.slice(1) || 'overview');
