import { requireAdminSession, logoutAdmin } from './auth.js';
import { getAuditLog, countEmpleados, getRegistros } from './api.js';
import { fmtFecha, esc } from './utils.js';

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

  if (id === 'ajustes') { loadAjustes(panel); return; }

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

// ── Tema claro/oscuro ───────────────────────────────────────────────────────────
const THEME_KEY = 'eqs_admin_theme';
const mq = matchMedia('(prefers-color-scheme: dark)');
const getTheme = () => localStorage.getItem(THEME_KEY) || 'system';
const isDark = (t = getTheme()) => t === 'dark' || (t === 'system' && mq.matches);

function applyTheme() {
  const dark = isDark();
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  const sw = document.getElementById('theme-switch');
  if (sw) sw.checked = dark;
  document.querySelectorAll('.seg-theme [data-theme-opt]').forEach(b =>
    b.classList.toggle('active', b.dataset.themeOpt === getTheme()));
}
function setTheme(t) { localStorage.setItem(THEME_KEY, t); applyTheme(); }

mq.addEventListener('change', () => { if (getTheme() === 'system') applyTheme(); });
document.getElementById('theme-switch')?.addEventListener('change', e => setTheme(e.target.checked ? 'dark' : 'light'));
applyTheme();

// ── Panel Ajustes ───────────────────────────────────────────────────────────────
function loadAjustes(panel) {
  const rolTxt = esRH ? 'Recursos Humanos' : 'Jefe de Plaza';
  panel.innerHTML = `
    <div class="panel-header"><h2>Ajustes</h2></div>
    <div class="ad-card"><div class="ad-card__header"><h3>Apariencia</h3></div>
      <div class="ad-card__body">
        <div class="setting-row">
          <div>
            <div class="setting-row__label">Tema</div>
            <div class="setting-row__hint">Elige claro, oscuro o seguir el sistema.</div>
          </div>
          <div class="segmented seg-theme">
            <button data-theme-opt="light">Claro</button>
            <button data-theme-opt="dark">Oscuro</button>
            <button data-theme-opt="system">Sistema</button>
          </div>
        </div>
      </div>
    </div>
    <div class="ad-card"><div class="ad-card__header"><h3>Cuenta</h3></div>
      <div class="ad-card__body">
        <div class="setting-row"><span class="setting-row__label">Nombre</span><span class="setting-row__val">${esc(sesion?.nombre ?? 'Admin')}</span></div>
        <div class="setting-row"><span class="setting-row__label">Rol</span><span class="setting-row__val">${rolTxt}</span></div>
        <div class="setting-row"><span class="setting-row__label">Correo</span><span class="setting-row__val">${esc(sesion?.email ?? '—')}</span></div>
      </div>
    </div>
    <div class="ad-card"><div class="ad-card__header"><h3>Sesión</h3></div>
      <div class="ad-card__body">
        <div class="setting-row">
          <div>
            <div class="setting-row__label">Cerrar sesión</div>
            <div class="setting-row__hint">Saldrás del panel administrativo.</div>
          </div>
          <button class="abtn abtn--danger" id="ajustes-logout">Cerrar sesión</button>
        </div>
      </div>
    </div>`;

  panel.querySelectorAll('.seg-theme [data-theme-opt]').forEach(b =>
    b.addEventListener('click', () => setTheme(b.dataset.themeOpt)));
  panel.querySelector('#ajustes-logout')?.addEventListener('click', logoutAdmin);
  applyTheme();
}

// ── Overview stats ────────────────────────────────────────────────────────────
const ICONS = {
  empleados: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  plazas:    '<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>',
  registros: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  incidencias:'<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>'
};

function statCard(tono, icon, label, value, sub) {
  return `
    <div class="stat-card stat-card--${tono}">
      <div class="stat-card__icon">
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[icon]}</svg>
      </div>
      <div class="stat-card__label">${label}</div>
      <div class="stat-card__value">${value}</div>
      ${sub ? `<div class="stat-card__sub">${sub}</div>` : ''}
    </div>`;
}

function barRow(label, value, total, tono) {
  const pct = total ? Math.round((value / total) * 100) : 0;
  return `
    <div class="dist-row">
      <span class="dist-row__label">${label}</span>
      <div class="dist-row__track"><div class="dist-row__fill dist-row__fill--${tono}" style="width:${pct}%"></div></div>
      <span class="dist-row__val">${value}</span>
    </div>`;
}

async function loadOverview(panel) {
  const hoy = new Date().toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  panel.innerHTML = `
    <div class="overview-hero">
      <div>
        <p class="overview-hero__hi">Hola, ${esc(sesion?.nombre ?? 'Admin')} 👋</p>
        <h2 class="overview-hero__title">Resumen del día</h2>
      </div>
      <span class="overview-hero__date">${hoy}</span>
    </div>

    <div class="stat-grid" id="stat-grid">
      ${['empleados','presentes','registros','incidencias'].map(ic => statCard(
          { empleados:'blue', presentes:'green', registros:'orange', incidencias:'red' }[ic],
          ic === 'presentes' ? 'empleados' : ic,
          { empleados:'Empleados activos', presentes:'Presentes ahora', registros:'Registros hoy', incidencias:'Incidencias hoy' }[ic],
          '—')).join('')}
    </div>

    <div class="overview-cols">
      <div class="ad-card">
        <div class="ad-card__header"><h3>Actividad de hoy</h3></div>
        <div id="overview-actividad"><div class="ad-loading"><div class="ad-spinner"></div> Cargando…</div></div>
      </div>
      <div class="overview-aside">
        <div class="ad-card">
          <div class="ad-card__header"><h3>Distribución de hoy</h3></div>
          <div class="ad-card__body" id="overview-dist"><div class="ad-loading"><div class="ad-spinner"></div> Cargando…</div></div>
        </div>
        <div class="ad-card">
          <div class="ad-card__header"><h3>Accesos rápidos</h3></div>
          <div class="ad-card__body quick-links" id="overview-quick"></div>
        </div>
      </div>
    </div>`;

  renderQuickLinks();

  // Empleados activos: cuenta independiente (no viene en los registros del día).
  countEmpleados()
    .then(emp => setStat('empleados', emp?.length ?? 0))
    .catch(() => setStat('empleados', '—'));

  // Una sola consulta del día alimenta stats + distribución + actividad.
  const hoyISO = new Date().toISOString().slice(0, 10);
  try {
    const rows = await getRegistros({ fecha: hoyISO, limit: 300 });
    const entradas    = rows.filter(r => r.tipo === 'entrada').length;
    const salidas     = rows.filter(r => r.tipo === 'salida').length;
    const incidencias = rows.filter(r => r.geocerca_valida === false).length;
    const presentes   = Math.max(entradas - salidas, 0); // ponytail: entradas-salidas; por-empleado si se requiere precisión

    setStat('presentes',   presentes);
    setStat('registros',   rows.length);
    setStat('incidencias', incidencias, incidencias ? 'fuera de geocerca' : 'todo en orden');

    renderDistribucion({ entradas, salidas, incidencias, total: rows.length });
    renderActividad(rows.slice(0, 8));
  } catch (e) {
    ['presentes','registros','incidencias'].forEach(k => setStat(k, '—'));
    const d = document.getElementById('overview-dist');
    const a = document.getElementById('overview-actividad');
    if (d) d.innerHTML = `<div class="ad-empty" style="color:#DC2626">${esc(e.message)}</div>`;
    if (a) a.innerHTML = `<div class="ad-empty" style="color:#DC2626">${esc(e.message)}</div>`;
  }
}

// Reemplaza una stat-card por su clave sin recargar todo el grid.
const STAT_LABELS = { empleados:'Empleados activos', presentes:'Presentes ahora', registros:'Registros hoy', incidencias:'Incidencias hoy' };
const STAT_TONOS  = { empleados:'blue', presentes:'green', registros:'orange', incidencias:'red' };
function setStat(key, value, sub) {
  const grid = document.getElementById('stat-grid');
  if (!grid) return;
  const idx = ['empleados','presentes','registros','incidencias'].indexOf(key);
  const card = grid.children[idx];
  if (!card) return;
  card.outerHTML = statCard(STAT_TONOS[key], key === 'presentes' ? 'empleados' : key, STAT_LABELS[key], value, sub);
}

function renderDistribucion({ entradas, salidas, incidencias, total }) {
  const wrap = document.getElementById('overview-dist');
  if (!wrap) return;
  if (!total) { wrap.innerHTML = '<div class="ad-empty">Sin registros hoy.</div>'; return; }
  wrap.innerHTML =
    barRow('Entradas', entradas, total, 'green') +
    barRow('Salidas', salidas, total, 'blue') +
    barRow('Incidencias', incidencias, total, 'red');
}

function renderActividad(rows) {
  const wrap = document.getElementById('overview-actividad');
  if (!wrap) return;
  if (!rows.length) { wrap.innerHTML = '<div class="ad-empty">Sin actividad hoy.</div>'; return; }
  wrap.innerHTML = `<ul class="activity-list">${rows.map(r => `
    <li class="activity-item">
      <span class="abadge abadge--${r.tipo === 'entrada' ? 'entrada' : 'salida'}">${r.tipo === 'entrada' ? 'Entrada' : 'Salida'}</span>
      <span class="activity-item__name">${esc(r.empleados?.nombre ?? '–')}</span>
      <span class="activity-item__plaza">${esc(r.empleados?.plazas?.nombre ?? '')}</span>
      <span class="activity-item__time">${fmtFecha(r.hora)}</span>
    </li>`).join('')}</ul>`;
}

function renderQuickLinks() {
  const wrap = document.getElementById('overview-quick');
  if (!wrap) return;
  const links = [
    ['asistencia', 'Ver asistencia'],
    ['empleados',  'Empleados'],
    ['historial',  'Historial por empleado'],
    ...(esRH ? [['plazas', 'Plazas'], ['turnos', 'Turnos']] : [])
  ];
  wrap.innerHTML = links.map(([id, label]) =>
    `<button class="quick-link" data-goto="${id}">${label}
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
    </button>`).join('');
  wrap.querySelectorAll('[data-goto]').forEach(b => b.addEventListener('click', () => {
    const id = b.dataset.goto;
    history.pushState(null, '', `#${id}`);
    showPanel(id);
  }));
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
