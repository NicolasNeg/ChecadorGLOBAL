import { requireAdminSession, logoutAdmin } from './auth.js';
import { getAuditLog, countEmpleados, getRegistros, getPlazas, getEmpleados, enviarResetPassword } from './api.js';
import { fmtFecha, esc, showToast } from './utils.js';
import { getPlazaScope, setPlazaScope } from './plaza-scope.js';
import { t, applyI18n, mountLangToggle, getLang } from '../i18n.js';
import { cabeceraReporteHTML, CABECERA_CSS } from './reporte-cabecera.js';

const sesion = requireAdminSession();
// auth.js guarda el perfil aplanado en la sesión: rol/nombre están en la raíz.
const esRH   = sesion?.rol === 'rh';
const esAdminGlobal = sesion?.es_admin_global === true; // 3er concepto: super-admin

// ── Role-based UI ─────────────────────────────────────────────────────────────
if (!esRH) {
  document.querySelectorAll('[data-rh-only]').forEach(el => el.remove());
}
if (!esAdminGlobal) {
  document.querySelectorAll('[data-admin-global]').forEach(el => el.remove());
}
const _adminNombre = sesion?.nombre ?? 'Admin';
document.getElementById('admin-nombre-foot').textContent = _adminNombre;
document.getElementById('admin-rol-badge').textContent = t(esRH ? 'Recursos Humanos' : 'Jefe de Plaza');
document.querySelectorAll('.sidebar__avatar').forEach(a => { a.firstChild.textContent = _adminNombre.trim().charAt(0).toUpperCase() || 'A'; });

// ── Sidebar nav + routing ─────────────────────────────────────────────────────
// El <base> de cada página (para GitHub Pages) hace que un href/pushState con solo
// "#id" se resuelva contra la BASE y pierda /admin/dashboard/. Anclamos el hash a
// la ruta actual para que recargar conserve la ruta.
const hashURL = (id) => location.pathname + location.search + '#' + id;
const panels = document.querySelectorAll('.admin-panel');
const navLinks = document.querySelectorAll('.sidebar__link[data-panel]');
const pageTitle = document.getElementById('page-title');
const _loaded = {};
let _current = null;

async function showPanel(id) {
  _current = id;
  panels.forEach(p => p.hidden = true);
  navLinks.forEach(l => l.classList.toggle('active', l.dataset.panel === id));

  const panel = document.getElementById(`panel-${id}`);
  if (!panel) return;
  panel.hidden = false;
  pageTitle.textContent = t(panel.dataset.title ?? id);

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
    case 'puestos':    { const m = await import('./puestos.js');   await m.init(panel); break; }
    case 'empleados':  { const m = await import('./empleados.js'); await m.init(panel); break; }
    case 'turnos':     { const m = await import('./turnos.js');    await m.init(panel); break; }
    case 'asistencia': {
      const m = await import('./asistencia.js');
      await m.init(panel, sesion);
      break;
    }
    case 'cambios':    await loadCambios(panel); break;
    case 'auditoria':  await loadAuditoria(panel); break;
    case 'usuarios':       { const m = await import('./usuarios.js');       await m.init(panel); break; }
    case 'administracion': { const m = await import('./administracion.js'); await m.init(panel); break; }
  }
}

navLinks.forEach(link => {
  link.addEventListener('click', (e) => {
    e.preventDefault();
    const id = link.dataset.panel;
    history.pushState(null, '', hashURL(id));
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

// ── Colapsar sidebar (escritorio) ───────────────────────────────────────────────
const shell = document.getElementById('admin-shell');
const COLLAPSE_KEY = 'eqs_admin_collapsed';
function applyCollapsed() {
  const on = localStorage.getItem(COLLAPSE_KEY) === '1';
  shell.classList.toggle('is-collapsed', on);
  const btn = document.getElementById('btn-collapse');
  if (btn) {
    const lbl = t(on ? 'Expandir menú' : 'Colapsar menú');
    btn.setAttribute('title', lbl);
    btn.setAttribute('aria-label', lbl);
  }
}
document.getElementById('btn-collapse')?.addEventListener('click', () => {
  localStorage.setItem(COLLAPSE_KEY, shell.classList.contains('is-collapsed') ? '0' : '1');
  applyCollapsed();
});
applyCollapsed();

// ── Idioma (ES/EN) ──────────────────────────────────────────────────────────────
mountLangToggle(document.querySelector('.admin-header__right'));
applyI18n(document);
window.addEventListener('langchange', () => {
  applyI18n(document);
  applyCollapsed();
  reloadCurrent(); // re-renderiza el panel activo con los textos en el idioma nuevo
});

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
  document.querySelectorAll('.seg-theme [data-theme-opt]').forEach(b =>
    b.classList.toggle('active', b.dataset.themeOpt === getTheme()));
}
function setTheme(t) { localStorage.setItem(THEME_KEY, t); applyTheme(); }

mq.addEventListener('change', () => { if (getTheme() === 'system') applyTheme(); });
// Botón luna/sol en el header: alterna entre claro y oscuro.
document.getElementById('btn-theme')?.addEventListener('click', () => setTheme(isDark() ? 'light' : 'dark'));
applyTheme();

// ── Selector global de plaza (solo RH; jefe ya está limitado por RLS) ───────────
// Recarga el panel actual descartando su caché para que el filtro se aplique.
function reloadCurrent() {
  if (!_current) return;
  delete _loaded[_current];
  showPanel(_current);
}
// _plazaOpciones a nivel de módulo para que los listeners (enganchados una sola
// vez) lean siempre la lista fresca tras un refresh por polling (ver watchPlazas).
let _plazaOpciones = [];
let _plazaWired = false;
async function initPlazaSelector() {
  const box = document.getElementById('header-plaza');
  if (!box) return;
  const trigger = document.getElementById('hplaza-trigger');
  const labelEl = document.getElementById('hplaza-label');
  const menu = document.getElementById('hplaza-menu');

  let plazas = [];
  try { plazas = await getPlazas(); } catch { /* sin plazas */ }

  // jefe: una sola plaza (ya limitado por RLS). Solo muestra el nombre, sin dropdown.
  if (!esRH) {
    labelEl.textContent = plazas[0]?.nombre ?? 'Mi plaza';
    box.classList.add('hplaza--static');
    return;
  }

  _plazaOpciones = [{ id: null, nombre: 'Todas las plazas' }, ...plazas];
  const nombreDe = (id) => _plazaOpciones.find(o => o.id === id)?.nombre ?? 'Seleccionar Plaza';
  const setLabel = (id) => { labelEl.textContent = id == null ? 'Todas las plazas' : nombreDe(id); };
  setLabel(getPlazaScope());

  menu.innerHTML = _plazaOpciones.map(o => {
    const sel = (getPlazaScope() ?? null) === o.id;
    return `<li role="option" class="hplaza__opt${sel ? ' is-sel' : ''}" data-id="${o.id ?? ''}" aria-selected="${sel}">
      <span>${esc(o.nombre)}</span>
      <svg class="hplaza__check" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
    </li>`;
  }).join('');

  if (_plazaWired) return; // los listeners ya están; este fue solo un refresh de datos
  _plazaWired = true;

  const close = () => {
    if (menu.hidden) return;
    box.classList.remove('open');
    trigger.setAttribute('aria-expanded', 'false');
    // espera a que termine la animación de salida antes de ocultar
    setTimeout(() => { menu.hidden = true; }, 160);
    document.removeEventListener('click', onDocClick, true);
  };
  const open = () => {
    menu.hidden = false;
    requestAnimationFrame(() => box.classList.add('open'));
    trigger.setAttribute('aria-expanded', 'true');
    document.addEventListener('click', onDocClick, true);
  };
  const onDocClick = (e) => { if (!box.contains(e.target)) close(); };

  trigger.addEventListener('click', (e) => { e.stopPropagation(); box.classList.contains('open') ? close() : open(); });

  menu.addEventListener('click', (e) => {
    const li = e.target.closest('.hplaza__opt');
    if (!li) return;
    const id = parseInt(li.dataset.id) || null;
    menu.querySelectorAll('.hplaza__opt').forEach(o => {
      const on = o === li;
      o.classList.toggle('is-sel', on);
      o.setAttribute('aria-selected', on);
    });
    setLabel(id);
    close();
    if (id !== getPlazaScope()) {
      setPlazaScope(id);
      // animación "con vida" al cambiar de plaza
      const content = document.getElementById('admin-content');
      content?.classList.remove('plaza-flash');
      void content?.offsetWidth;            // reinicia la animación
      content?.classList.add('plaza-flash');
      reloadCurrent();
    }
  });
}
initPlazaSelector();

// ── "Tiempo real" para plazas (cambio global que todos deben sentir) ────────────
// ponytail: sin supabase-js, hacemos polling cada 30 s + refresco al volver a la
// pestaña. Si las plazas cambiaron, refrescamos el selector y el panel activo y
// avisamos. Upgrade path: Supabase Realtime (websocket) cuando se integre supabase-js.
let _plazasSnap = null;
async function watchPlazas() {
  let ps;
  try { ps = await getPlazas(); } catch { return; }
  const snap = JSON.stringify(ps.map(p => [p.id, p.nombre, p.activo, p.latitud, p.longitud, p.radio_metros]));
  if (_plazasSnap !== null && snap !== _plazasSnap) {
    await initPlazaSelector();        // re-renderiza el menú (sin re-enganchar listeners)
    reloadCurrent();
    showToast('Las plazas se actualizaron.', 'ok');
  }
  _plazasSnap = snap;
}
watchPlazas();                                    // primer snapshot
setInterval(watchPlazas, 30000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) watchPlazas(); });

// ── Panel Ajustes ───────────────────────────────────────────────────────────────
function loadAjustes(panel) {
  const rolTxt = t(esRH ? 'Recursos Humanos' : 'Jefe de Plaza');
  panel.innerHTML = `
    <div class="panel-header"><h2>${t('Ajustes')}</h2></div>
    <div class="ad-card"><div class="ad-card__header"><h3>${t('Apariencia')}</h3></div>
      <div class="ad-card__body">
        <div class="setting-row">
          <div>
            <div class="setting-row__label">${t('Tema')}</div>
            <div class="setting-row__hint">${t('Elige claro, oscuro o seguir el sistema.')}</div>
          </div>
          <div class="segmented seg-theme">
            <button data-theme-opt="light">${t('Claro')}</button>
            <button data-theme-opt="dark">${t('Oscuro')}</button>
            <button data-theme-opt="system">${t('Sistema')}</button>
          </div>
        </div>
        <div class="setting-row">
          <div>
            <div class="setting-row__label">${t('Ver KPIs fijos')}</div>
            <div class="setting-row__hint">${t('Muestra las estadísticas siempre en el historial, no solo al pulsar el icono.')}</div>
          </div>
          <div class="segmented seg-kpis">
            <button data-kpis-opt="1">${t('Sí')}</button>
            <button data-kpis-opt="0">${t('No')}</button>
          </div>
        </div>
      </div>
    </div>
    <div class="ad-card"><div class="ad-card__header"><h3>${t('Cuenta')}</h3></div>
      <div class="ad-card__body">
        <div class="setting-row"><span class="setting-row__label">${t('Nombre')}</span><span class="setting-row__val">${esc(sesion?.nombre ?? 'Admin')}</span></div>
        <div class="setting-row"><span class="setting-row__label">${t('Rol')}</span><span class="setting-row__val">${rolTxt}</span></div>
        <div class="setting-row"><span class="setting-row__label">${t('Correo')}</span><span class="setting-row__val">${esc(sesion?.email ?? '—')}</span></div>
        <div class="setting-row">
          <div>
            <div class="setting-row__label">${t('Contraseña')}</div>
            <div class="setting-row__hint">${t('Te enviaremos un enlace a tu correo para cambiarla.')}</div>
          </div>
          <button class="abtn" id="ajustes-password">${t('Enviar enlace a mi correo')}</button>
        </div>
      </div>
    </div>
    <div class="ad-card"><div class="ad-card__header"><h3>${t('Sesión')}</h3></div>
      <div class="ad-card__body">
        <div class="setting-row">
          <div>
            <div class="setting-row__label">${t('Cerrar sesión')}</div>
            <div class="setting-row__hint">${t('Saldrás del panel administrativo.')}</div>
          </div>
          <button class="abtn abtn--danger" id="ajustes-logout">${t('Cerrar sesión')}</button>
        </div>
      </div>
    </div>`;

  panel.querySelectorAll('.seg-theme [data-theme-opt]').forEach(b =>
    b.addEventListener('click', () => setTheme(b.dataset.themeOpt)));

  const syncKpis = () => {
    const v = localStorage.getItem('eqs_admin_kpis_fijos') === '1' ? '1' : '0';
    panel.querySelectorAll('.seg-kpis [data-kpis-opt]').forEach(b => b.classList.toggle('active', b.dataset.kpisOpt === v));
  };
  panel.querySelectorAll('.seg-kpis [data-kpis-opt]').forEach(b =>
    b.addEventListener('click', () => { localStorage.setItem('eqs_admin_kpis_fijos', b.dataset.kpisOpt); syncKpis(); }));
  syncKpis();

  panel.querySelector('#ajustes-logout')?.addEventListener('click', logoutAdmin);

  panel.querySelector('#ajustes-password')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    if (!sesion?.email) { showToast(t('No hay correo en tu cuenta.'), 'error'); return; }
    const orig = btn.textContent;
    btn.disabled = true; btn.textContent = t('Enviando…');
    try {
      await enviarResetPassword(sesion.email);
      showToast(t('Enlace enviado a tu correo.'), 'ok');
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      btn.disabled = false; btn.textContent = orig;
    }
  });
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
  const loc = getLang() === 'en' ? 'en-US' : 'es-MX';
  const hoy = new Date().toLocaleDateString(loc, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  panel.innerHTML = `
    <div class="overview-hero">
      <div>
        <p class="overview-hero__hi">${t('Hola')}, ${esc(sesion?.nombre ?? 'Admin')} 👋</p>
        <h2 class="overview-hero__title">${t('Resumen del día')}</h2>
      </div>
      <span class="overview-hero__date">${hoy}</span>
    </div>

    <div class="stat-grid" id="stat-grid">
      ${['empleados','presentes','registros','incidencias'].map(ic => statCard(
          { empleados:'blue', presentes:'green', registros:'orange', incidencias:'red' }[ic],
          ic === 'presentes' ? 'empleados' : ic,
          t({ empleados:'Empleados activos', presentes:'Presentes ahora', registros:'Registros hoy', incidencias:'Incidencias hoy' }[ic]),
          '—')).join('')}
    </div>

    <div class="overview-cols">
      <div class="ad-card">
        <div class="ad-card__header"><h3>${t('Actividad de hoy')}</h3></div>
        <div id="overview-actividad"><div class="ad-loading"><div class="ad-spinner"></div> ${t('Cargando…')}</div></div>
      </div>
      <div class="overview-aside">
        <div class="ad-card">
          <div class="ad-card__header"><h3>${t('Distribución de hoy')}</h3></div>
          <div class="ad-card__body" id="overview-dist"><div class="ad-loading"><div class="ad-spinner"></div> ${t('Cargando…')}</div></div>
        </div>
        <div class="ad-card">
          <div class="ad-card__header"><h3>${t('Accesos rápidos')}</h3></div>
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
    setStat('incidencias', incidencias, t(incidencias ? 'fuera de geocerca' : 'todo en orden'));

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
  card.outerHTML = statCard(STAT_TONOS[key], key === 'presentes' ? 'empleados' : key, t(STAT_LABELS[key]), value, sub);
}

function renderDistribucion({ entradas, salidas, incidencias, total }) {
  const wrap = document.getElementById('overview-dist');
  if (!wrap) return;
  if (!total) { wrap.innerHTML = `<div class="ad-empty">${t('Sin registros hoy.')}</div>`; return; }
  wrap.innerHTML =
    barRow(t('Entradas'), entradas, total, 'green') +
    barRow(t('Salidas'), salidas, total, 'blue') +
    barRow(t('Incidencias'), incidencias, total, 'red');
}

function renderActividad(rows) {
  const wrap = document.getElementById('overview-actividad');
  if (!wrap) return;
  if (!rows.length) { wrap.innerHTML = `<div class="ad-empty">${t('Sin actividad hoy.')}</div>`; return; }
  wrap.innerHTML = `<ul class="activity-list">${rows.map(r => `
    <li class="activity-item">
      <span class="abadge abadge--${r.tipo === 'entrada' ? 'entrada' : 'salida'}">${t(r.tipo === 'entrada' ? 'Entrada' : 'Salida')}</span>
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
    `<button class="quick-link" data-goto="${id}">${t(label)}
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
    </button>`).join('');
  wrap.querySelectorAll('[data-goto]').forEach(b => b.addEventListener('click', () => {
    const id = b.dataset.goto;
    history.pushState(null, '', hashURL(id));
    showPanel(id);
  }));
}

// ── Audit log panel ───────────────────────────────────────────────────────────
// Traduce un renglón del audit_log a lenguaje administrativo (no de programador).
const OP_VERBO = { INSERT: 'Creó', UPDATE: 'Modificó', DELETE: 'Eliminó' };
const TABLA_ENTIDAD = {
  empleados:      'el horario del usuario',  // los cambios de turno_id se registran sobre empleados
  turnos:         'un turno',
  plazas:         'una plaza',
  registros:      'un registro de asistencia',
  incidencias:    'una nota',
  perfiles_admin: 'un administrador',
};
function accionHumana(r) {
  const entidad = t(TABLA_ENTIDAD[r.tabla] ?? `un registro (${r.tabla})`);
  const verbo   = t(OP_VERBO[r.operacion] ?? r.operacion).toLowerCase();
  const d       = r.datos_despues ?? r.datos_antes ?? {};
  const quien   = d.nombre ? ` ${t('de')} ${d.nombre}` : '';
  // ponytail: plantilla "Se {verbo} {entidad}"; la gramática EN es aproximada, basta para auditoría.
  return `${t('Se')} ${verbo} ${entidad}${quien}`.replace(/\s+/g, ' ').trim();
}

// Nombres de campo en español + campos de ruido que no aportan al lector.
const CAMPO_LBL = {
  turno_id: 'Turno', dia_semana: 'Día', hora_entrada: 'Entrada', hora_salida: 'Salida',
  nombre: 'Nombre', numero_empleado: 'N° empleado', puesto: 'Puesto', email: 'Email',
  telefono: 'Teléfono', plaza_id: 'Plaza', turno: 'Turno', activo: 'Activo', rol: 'Rol',
  radio_metros: 'Radio (m)', latitud: 'Latitud', longitud: 'Longitud', direccion: 'Dirección',
  tipo: 'Tipo', descripcion: 'Descripción', fecha: 'Fecha', fecha_ingreso: 'Ingreso',
  fecha_nacimiento: 'Nacimiento', curp: 'CURP', rfc: 'RFC', nss: 'NSS',
  contacto_emergencia: 'Contacto emerg.', telefono_emergencia: 'Tel. emerg.',
};
const CAMPO_IGNORAR = new Set([
  'id', 'created_at', 'updated_at', 'actualizado_en', 'pin_hash',
  'autor_nombre', 'editor_nombre', 'imagen_url',
]);
const fmtVal = (v) =>
  v === null || v === undefined || v === '' ? '∅' : v === true ? 'Sí' : v === false ? 'No' : String(v);

// "Antiguo → nuevo" de los campos que cambiaron (solo los modificados).
function cambiosHTML(r) {
  const a = r.datos_antes ?? {}, b = r.datos_despues ?? {};
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter(k => !CAMPO_IGNORAR.has(k));
  const filas = [];
  for (const k of keys) {
    if (JSON.stringify(a[k]) === JSON.stringify(b[k])) continue;
    const lbl = esc(t(CAMPO_LBL[k] ?? k));
    if (r.operacion === 'INSERT')      filas.push(`<b>${lbl}:</b> ${esc(fmtVal(b[k]))}`);
    else if (r.operacion === 'DELETE') filas.push(`<b>${lbl}:</b> ${esc(fmtVal(a[k]))}`);
    else filas.push(`<b>${lbl}:</b> <span style="color:#DC2626;text-decoration:line-through">${esc(fmtVal(a[k]))}</span> → <span style="color:#15803D">${esc(fmtVal(b[k]))}</span>`);
  }
  return filas.length ? filas.join('<br>') : '<span style="color:var(--ad-tinta-3)">—</span>';
}

// ── Historial de cambios (versión operativa del log, para RH) ───────────────────
// Filtra el audit_log a lo que le importa a coordinación (horarios, descansos,
// incidencias), resuelve a quién afecta y lo muestra sin diffs ni IPs.
const CAMBIO_OPERATIVO = new Set(['turnos_dia', 'horarios_semana', 'incidencias']);
const INCIDENCIA_TITULO = {
  vacaciones: 'Vacaciones', permiso: 'Permiso', falta: 'Falta', festivo: 'Día festivo',
  descanso: 'Descanso asignado', justificacion: 'Justificación', asistencia: 'Asistencia registrada',
};
const CAMBIO_TONO = {
  'Vacaciones': 'blue', 'Permiso': 'orange', 'Falta': 'red', 'Día festivo': 'violet',
  'Descanso asignado': 'gray', 'Justificación': 'blue', 'Asistencia registrada': 'green',
  'Turno asignado': 'green', 'Cambio de horario': 'blue', 'Cambio de horario semanal': 'blue',
};
function tituloCambio(r, d) {
  if (r.tabla === 'incidencias') return INCIDENCIA_TITULO[d.tipo] ?? 'Incidencia';
  if (r.tabla === 'turnos_dia') {
    if (r.operacion === 'DELETE' || d.turno_id == null) return 'Descanso asignado';
    return r.operacion === 'INSERT' ? 'Turno asignado' : 'Cambio de horario';
  }
  return 'Cambio de horario semanal'; // horarios_semana
}

// Filtra los items ya normalizados por buscador (empleado/responsable), tipo y día.
function filtrarCambios(items, { q, tipo, fecha }) {
  const needle = (q || '').trim().toLowerCase();
  return items.filter(i =>
    (!tipo  || i.tipo === tipo) &&
    (!fecha || (i.fecha || '').slice(0, 10) === fecha) &&
    (!needle || `${i.emp} ${i.responsable}`.toLowerCase().includes(needle))
  );
}

function renderCambiosTabla(items, filtros) {
  const wrap = document.getElementById('cambios-wrap');
  const rows = filtrarCambios(items, filtros);
  if (!rows.length) { wrap.innerHTML = `<div class="ad-empty">${t('Sin cambios que coincidan.')}</div>`; return; }
  wrap.innerHTML = `<div class="table-scroll"><table class="data-table">
    <thead><tr>
      <th>${t('Fecha')}</th><th>${t('Tipo de hecho')}</th>
      <th>${t('Empleado')}</th><th>${t('Responsable')}</th>
    </tr></thead><tbody>
    ${rows.map(i => `<tr>
      <td data-label="${t('Fecha')}">${esc(fmtFecha(i.fecha))}</td>
      <td data-label="${t('Tipo de hecho')}"><span class="abadge abadge--${i.tono}">${esc(t(i.tipo))}</span></td>
      <td data-label="${t('Empleado')}">${esc(i.emp || '—')}${i.dia ? ` <span class="td-muted">· ${esc(i.dia)}</span>` : ''}</td>
      <td data-label="${t('Responsable')}">${esc(i.responsable)}</td>
    </tr>`).join('')}
    </tbody></table></div>`;
}

// PDF vía ventana imprimible (mismo patrón que asistencia: sin dependencias).
async function pdfCambios(rows) {
  if (!rows.length) { showToast(t('No hay cambios para exportar.'), 'error'); return; }
  const w = window.open('', '_blank');
  if (!w) { showToast(t('Permite las ventanas emergentes para exportar.'), 'error'); return; }
  const cab = await cabeceraReporteHTML();
  const titulo = `${t('Historial de cambios')} — ${fmtFecha(new Date().toISOString())}`;
  const body = rows.map(i =>
    `<tr><td>${esc(fmtFecha(i.fecha))}</td><td>${esc(t(i.tipo))}</td><td>${esc(i.emp || '—')}${i.dia ? ' · ' + esc(i.dia) : ''}</td><td>${esc(i.responsable)}</td></tr>`).join('');
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(titulo)}</title><style>
    *{-webkit-print-color-adjust:exact;print-color-adjust:exact}
    body{font:12px system-ui,-apple-system,sans-serif;margin:24px;color:#111}
    h1{font-size:16px;margin:0 0 12px}
    table{border-collapse:collapse;width:100%}
    th,td{border:1px solid #cbd5e1;padding:5px 8px;text-align:left}
    th{background:#f1f5f9;font-size:10px}
    @page{margin:14mm}${CABECERA_CSS}
  </style></head><body>${cab}<h1>${esc(titulo)}</h1>
    <table><thead><tr><th>${t('Fecha')}</th><th>${t('Tipo de hecho')}</th><th>${t('Empleado')}</th><th>${t('Responsable')}</th></tr></thead><tbody>${body}</tbody></table>
    <scr` + `ipt>window.onload=function(){window.print()}</scr` + `ipt>
  </body></html>`);
  w.document.close();
}

async function loadCambios(panel) {
  panel.innerHTML = `
    <div class="panel-header">
      <h2>${t('Historial de cambios')}</h2>
      <div class="panel-header__actions">
        <button class="abtn abtn--ghost" id="cambios-pdf">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          ${t('Generar PDF')}
        </button>
      </div>
    </div>
    <div class="ad-card">
      <div class="cambios-bar">
        <input id="cambios-q" class="form-input" type="search" placeholder="${t('Buscar empleado o responsable…')}" aria-label="${t('Buscar')}">
        <select id="cambios-tipo" class="form-input" aria-label="${t('Tipo de hecho')}"></select>
        <input id="cambios-fecha" class="form-input" type="date" aria-label="${t('Fecha')}">
      </div>
      <div id="cambios-wrap">
        <div class="ad-loading"><div class="ad-spinner"></div> ${t('Cargando…')}</div>
      </div>
    </div>`;
  try {
    const [rows, empleados] = await Promise.all([getAuditLog(150), getEmpleados().catch(() => [])]);
    const nombreEmp = new Map(empleados.map(e => [e.id, e.nombre]));
    const items = rows.filter(r => CAMBIO_OPERATIVO.has(r.tabla)).map(r => {
      const d = r.datos_despues ?? r.datos_antes ?? {};
      const titulo = tituloCambio(r, d);
      return {
        fecha: r.created_at, tipo: titulo, tono: CAMBIO_TONO[titulo] ?? 'gray',
        emp: nombreEmp.get(d.id_empleado) ?? '', dia: d.fecha ?? '',
        responsable: r.perfiles_admin?.nombre ?? t('Sistema'),
      };
    });
    if (!items.length) {
      document.getElementById('cambios-wrap').innerHTML = `<div class="ad-empty">${t('Sin cambios recientes.')}</div>`;
      return;
    }

    const q = document.getElementById('cambios-q');
    const tipoSel = document.getElementById('cambios-tipo');
    const fechaInp = document.getElementById('cambios-fecha');
    tipoSel.innerHTML = `<option value="">${t('Todos los tipos')}</option>` +
      [...new Set(items.map(i => i.tipo))].map(tp => `<option value="${esc(tp)}">${esc(t(tp))}</option>`).join('');

    const filtros = () => ({ q: q.value, tipo: tipoSel.value, fecha: fechaInp.value });
    const render = () => renderCambiosTabla(items, filtros());
    [q, tipoSel, fechaInp].forEach(el => el.addEventListener('input', render));
    document.getElementById('cambios-pdf').addEventListener('click', () => pdfCambios(filtrarCambios(items, filtros())));
    render();
  } catch (e) {
    document.getElementById('cambios-wrap').innerHTML =
      `<div class="ad-empty" style="color:#DC2626">${esc(e.message)}</div>`;
  }
}

// Filtra el audit_log por buscador (acción + responsable), operación y día.
function filtrarAudit(rows, { q, op, fecha }) {
  const needle = (q || '').trim().toLowerCase();
  return rows.filter(r =>
    (!op    || r.operacion === op) &&
    (!fecha || (r.created_at || '').slice(0, 10) === fecha) &&
    (!needle || `${accionHumana(r)} ${r.perfiles_admin?.nombre ?? ''}`.toLowerCase().includes(needle))
  );
}

// Celda de detalle: conserva el <details> "Ver detalle" con el diff; la IP se
// vuelve un botón "Ver ubicación" que abre ipinfo.io (geolocalización aproximada).
function detalleHTML(r) {
  const cambios = cambiosHTML(r);
  if (!cambios.includes('<b>')) return `<span class="td-muted">—</span>`;
  const ip = r.ip_address;
  const verUbic = ip
    ? ` <a class="abtn abtn--ghost audit-ip-btn" href="https://ipinfo.io/${encodeURIComponent(ip)}" target="_blank" rel="noopener">${t('Ver ubicación')}</a>`
    : '';
  return `<details class="audit-item__det"><summary>${t('Ver detalle')}</summary>
    <div class="audit-item__cambios">${cambios}</div>
    <span class="audit-item__ip">IP: ${esc(ip ?? '—')}${verUbic}</span>
  </details>`;
}

function renderAuditTabla(rows, filtros) {
  const wrap = document.getElementById('audit-wrap');
  const list = filtrarAudit(rows, filtros);
  if (!list.length) { wrap.innerHTML = `<div class="ad-empty">${t('Sin registros que coincidan.')}</div>`; return; }
  wrap.innerHTML = `<div class="table-scroll"><table class="data-table">
    <thead><tr>
      <th>${t('Fecha')}</th><th>${t('Operación')}</th><th>${t('Acción')}</th>
      <th>${t('Responsable')}</th><th>${t('Detalle')}</th>
    </tr></thead><tbody>
    ${list.map(r => {
      const op = r.operacion;
      return `<tr>
        <td data-label="${t('Fecha')}">${esc(fmtFecha(r.created_at))}</td>
        <td data-label="${t('Operación')}"><span class="abadge abadge--${op === 'DELETE' ? 'red' : op === 'INSERT' ? 'green' : 'blue'}">${t(OP_VERBO[op] ?? op)}</span></td>
        <td data-label="${t('Acción')}">${esc(accionHumana(r))}</td>
        <td data-label="${t('Responsable')}">${esc(r.perfiles_admin?.nombre ?? t('Sistema'))}</td>
        <td data-label="${t('Detalle')}">${detalleHTML(r)}</td>
      </tr>`;
    }).join('')}
    </tbody></table></div>`;
}

async function pdfAuditoria(rows) {
  if (!rows.length) { showToast(t('No hay registros para exportar.'), 'error'); return; }
  const w = window.open('', '_blank');
  if (!w) { showToast(t('Permite las ventanas emergentes para exportar.'), 'error'); return; }
  const cab = await cabeceraReporteHTML();
  const titulo = `${t('Log de Auditoría')} — ${fmtFecha(new Date().toISOString())}`;
  const body = rows.map(r =>
    `<tr><td>${esc(fmtFecha(r.created_at))}</td><td>${esc(t(OP_VERBO[r.operacion] ?? r.operacion))}</td><td>${esc(accionHumana(r))}</td><td>${esc(r.perfiles_admin?.nombre ?? t('Sistema'))}</td></tr>`).join('');
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(titulo)}</title><style>
    *{-webkit-print-color-adjust:exact;print-color-adjust:exact}
    body{font:12px system-ui,-apple-system,sans-serif;margin:24px;color:#111}
    h1{font-size:16px;margin:0 0 12px}
    table{border-collapse:collapse;width:100%}
    th,td{border:1px solid #cbd5e1;padding:5px 8px;text-align:left}
    th{background:#f1f5f9;font-size:10px}
    @page{margin:14mm}${CABECERA_CSS}
  </style></head><body>${cab}<h1>${esc(titulo)}</h1>
    <table><thead><tr><th>${t('Fecha')}</th><th>${t('Operación')}</th><th>${t('Acción')}</th><th>${t('Responsable')}</th></tr></thead><tbody>${body}</tbody></table>
    <scr` + `ipt>window.onload=function(){window.print()}</scr` + `ipt>
  </body></html>`);
  w.document.close();
}

async function loadAuditoria(panel) {
  panel.innerHTML = `
    <div class="panel-header">
      <h2>${t('Log de Auditoría')}</h2>
      <div class="panel-header__actions">
        <button class="abtn abtn--ghost" id="audit-pdf">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          ${t('Generar PDF')}
        </button>
      </div>
    </div>
    <div class="ad-card">
      <div class="cambios-bar">
        <input id="audit-q" class="form-input" type="search" placeholder="${t('Buscar acción o responsable…')}" aria-label="${t('Buscar')}">
        <select id="audit-op" class="form-input" aria-label="${t('Operación')}"></select>
        <input id="audit-fecha" class="form-input" type="date" aria-label="${t('Fecha')}">
      </div>
      <div id="audit-wrap">
        <div class="ad-loading"><div class="ad-spinner"></div> ${t('Cargando…')}</div>
      </div>
    </div>`;
  try {
    const rows = await getAuditLog(100);
    if (!rows.length) {
      document.getElementById('audit-wrap').innerHTML = `<div class="ad-empty">${t('Sin registros.')}</div>`;
      return;
    }
    const q = document.getElementById('audit-q');
    const opSel = document.getElementById('audit-op');
    const fechaInp = document.getElementById('audit-fecha');
    opSel.innerHTML = `<option value="">${t('Todas las operaciones')}</option>` +
      [...new Set(rows.map(r => r.operacion))].map(op => `<option value="${esc(op)}">${esc(t(OP_VERBO[op] ?? op))}</option>`).join('');

    const filtros = () => ({ q: q.value, op: opSel.value, fecha: fechaInp.value });
    const render = () => renderAuditTabla(rows, filtros());
    [q, opSel, fechaInp].forEach(el => el.addEventListener('input', render));
    document.getElementById('audit-pdf').addEventListener('click', () => pdfAuditoria(filtrarAudit(rows, filtros())));
    render();
  } catch (e) {
    document.getElementById('audit-wrap').innerHTML =
      `<div class="ad-empty" style="color:#DC2626">${esc(e.message)}</div>`;
  }
}

// ── Init ──────────────────────────────────────────────────────────────────────
showPanel(location.hash.slice(1) || 'overview');
