import { requireAdminSession, logoutAdmin } from './auth.js';
import { getAuditLog, getRegistros, getPlazas, getEmpleados, getTurnos, suscribirRegistros, enviarResetPassword } from './api.js';
import { fmtFecha, esc, showToast } from './utils.js';
import { getPlazaScope, setPlazaScope, filterByPlaza } from './plaza-scope.js';
import { presentes, activosPorPlaza, contarAusentes, contarTarde, contarIncidencias } from './operaciones-calc.mjs';
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
  // Al salir del Centro de Operaciones: corta realtime/polling y destruye el mapa.
  if (_current === 'overview' && id !== 'overview') limpiarOps();
  // Animación suave de salida del panel anterior antes de ocultarlo.
  const prevId = _current;
  _current = id;
  const prevPanel = prevId && prevId !== id ? document.getElementById(`panel-${prevId}`) : null;
  if (prevPanel && !prevPanel.hidden) {
    prevPanel.classList.add('panel-exit');
    await new Promise(r => setTimeout(r, 140));
    prevPanel.classList.remove('panel-exit');
  }
  panels.forEach(p => p.hidden = true);
  navLinks.forEach(l => l.classList.toggle('active', l.dataset.panel === id));

  const panel = document.getElementById(`panel-${id}`);
  if (!panel) return;
  panel.hidden = false;
  pageTitle.textContent = t(panel.dataset.title ?? id);

  // Operaciones siempre se re-monta (mapa + realtime con estado fresco), no se cachea.
  if (id === 'overview') { await loadOperaciones(panel); return; }

  if (id === 'historial') {
    const m = await import('./historial-empleado.js');
    await m.init(panel);
    return;
  }

  if (id === 'ajustes') { loadAjustes(panel); return; }

  if (_loaded[id]) return;
  _loaded[id] = true;

  switch (id) {
    case 'plazas':     { const m = await import('./plazas.js');    await m.init(panel); break; }
    case 'puestos':    { const m = await import('./puestos.js');   await m.init(panel); break; }
    case 'empleados':  { const m = await import('./empleados.js'); await m.init(panel); break; }
    case 'gafetes':    { const m = await import('./gafetes.js');   await m.init(panel); break; }
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

// ── Centro de Operaciones (overview en vivo: mapa + métricas + activos) ─────────
const STAT_ICONS = {
  empleados:  '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  ausente:    '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="17" y1="8" x2="22" y2="13"/><line x1="22" y1="8" x2="17" y2="13"/>',
  reloj:      '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  incidencias:'<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>'
};
const STAT_DEFS = {
  presentes:   { tono: 'green',  icon: 'empleados',   label: 'Presentes ahora' },
  ausentes:    { tono: 'blue',   icon: 'ausente',     label: 'Ausentes' },
  tarde:       { tono: 'orange', icon: 'reloj',       label: 'Llegadas tarde' },
  incidencias: { tono: 'red',    icon: 'incidencias', label: 'Incidencias hoy' },
};
const STAT_KEYS = ['presentes', 'ausentes', 'tarde', 'incidencias'];

function statCard(key, value, sub) {
  const d = STAT_DEFS[key];
  return `
    <div class="stat-card stat-card--${d.tono}" data-stat="${key}">
      <div class="stat-card__icon">
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${STAT_ICONS[d.icon]}</svg>
      </div>
      <div class="stat-card__label">${t(d.label)}</div>
      <div class="stat-card__value">${value}</div>
      ${sub ? `<div class="stat-card__sub">${sub}</div>` : ''}
    </div>`;
}

// Estado de la vista en vivo (mapa, suscripción, timers). Se limpia al salir.
let _ops = { handle: null, mapMod: null, unsub: null, fallbackId: null, debounceId: null, live: false };

function limpiarOps() {
  clearInterval(_ops.fallbackId);
  clearTimeout(_ops.debounceId);
  try { _ops.unsub?.(); } catch { /* noop */ }
  if (_ops.handle && _ops.mapMod) _ops.mapMod.destruirMapa(_ops.handle);
  _ops = { handle: null, mapMod: null, unsub: null, fallbackId: null, debounceId: null, live: false };
}

async function loadOperaciones(panel) {
  limpiarOps(); // idempotente: cubre re-entradas y reloadCurrent (idioma/plaza)
  const loc = getLang() === 'en' ? 'en-US' : 'es-MX';
  const hoy = new Date().toLocaleDateString(loc, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  panel.innerHTML = `
    <div class="overview-hero">
      <div>
        <p class="overview-hero__hi">${t('Hola')}, ${esc(sesion?.nombre ?? 'Admin')} 👋</p>
        <h2 class="overview-hero__title">${t('Centro de operaciones')}</h2>
      </div>
      <div class="ops-live">
        <span class="ops-live__dot" id="ops-dot" aria-hidden="true"></span>
        <span id="ops-live-txt">${t('Conectando…')}</span>
        <button class="hicon-btn" id="ops-refresh" title="${t('Actualizar')}" aria-label="${t('Actualizar')}">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
        </button>
      </div>
    </div>

    <div class="stat-grid" id="ops-stats">
      ${STAT_KEYS.map(k => statCard(k, '—')).join('')}
    </div>

    <div class="ops-cols">
      <div class="ad-card ops-map-card">
        <div class="ad-card__header"><h3>${t('Mapa de plazas')}</h3><span class="overview-hero__date">${hoy}</span></div>
        <div id="ops-map" class="ops-map"></div>
      </div>
      <div class="ad-card ops-side">
        <div class="ad-card__header"><h3>${t('Activos ahora')}</h3></div>
        <div class="ad-card__body" id="ops-activos"><div class="ad-loading"><div class="ad-spinner"></div> ${t('Cargando…')}</div></div>
      </div>
    </div>`;

  panel.querySelector('#ops-refresh').addEventListener('click', refrescarOps);

  // Monta el mapa (si Leaflet carga). Si falla, el panel sigue útil sin mapa.
  try {
    _ops.mapMod = await import('./mapa-operaciones.js');
    await _ops.mapMod.cargarMapa();
    const plazas = filterByPlaza(await getPlazas(), p => p.id);
    _ops.handle = _ops.mapMod.montarMapa(panel.querySelector('#ops-map'), plazas, mostrarActivosPlaza);
  } catch (e) {
    console.error('Leaflet no cargó:', e);
    const m = panel.querySelector('#ops-map');
    if (m) m.outerHTML = `<div class="ad-empty">${t('El mapa no está disponible.')}</div>`;
  }

  await refrescarOps();

  // Realtime: cada checada (INSERT) refresca; fallback a polling de 30 s.
  try {
    _ops.unsub = await suscribirRegistros(scheduleRefresh, (status) => setLive(status === 'SUBSCRIBED'));
  } catch (e) {
    console.error('Realtime no conectó:', e);
    setLive(false);
  }
  _ops.fallbackId = setInterval(refrescarOps, 30000);
}

function scheduleRefresh() {
  clearTimeout(_ops.debounceId);
  _ops.debounceId = setTimeout(refrescarOps, 1000); // agrupa ráfagas de checadas
}

async function refrescarOps() {
  const hoyISO = new Date().toISOString().slice(0, 10);
  try {
    let [rows, empleados, turnos] = await Promise.all([
      getRegistros({ fecha: hoyISO, limit: 500 }),
      getEmpleados(),
      getTurnos(),
    ]);
    rows      = filterByPlaza(rows, r => r.empleados?.plaza_id);
    empleados = filterByPlaza(empleados.filter(e => e.activo), e => e.plaza_id);

    const turnoPorId = new Map(turnos.map(tn => [tn.id, tn]));
    const conTurno   = empleados.filter(e => e.turno_id).map(e => ({ id: e.id, turno_id: e.turno_id }));
    const turnoPorEmpleado = new Map(
      empleados.filter(e => e.turno_id && turnoPorId.has(e.turno_id)).map(e => [e.id, turnoPorId.get(e.turno_id)])
    );

    const activos = activosPorPlaza(rows);
    setStat('presentes',   presentes(rows).length);
    setStat('ausentes',    contarAusentes(rows, conTurno));
    setStat('tarde',       contarTarde(rows, turnoPorEmpleado));
    const incid = contarIncidencias(rows);
    setStat('incidencias', incid, t(incid ? 'fuera de geocerca' : 'todo en orden'));

    // Conteos para el mapa (+ marca de incidencia por plaza).
    const incidPorPlaza = new Set(rows.filter(r => r.geocerca_valida === false).map(r => r.empleados?.plaza_id));
    const conteos = new Map();
    for (const [pid, info] of activos) conteos.set(pid, { count: info.activos.length, incidencia: incidPorPlaza.has(pid) });
    for (const pid of incidPorPlaza) if (pid != null && !conteos.has(pid)) conteos.set(pid, { count: 0, incidencia: true });
    if (_ops.handle && _ops.mapMod) _ops.mapMod.pintarConteos(_ops.handle, conteos);

    renderActivos(activos);
    stampHora();
  } catch (e) {
    STAT_KEYS.forEach(k => setStat(k, '—'));
    const a = document.getElementById('ops-activos');
    if (a) a.innerHTML = `<div class="ad-empty" style="color:#DC2626">${esc(e.message)}</div>`;
  }
}

function setStat(key, value, sub) {
  const card = document.querySelector(`#ops-stats [data-stat="${key}"]`);
  if (card) card.outerHTML = statCard(key, value, sub);
}

function renderActivos(activos) {
  const wrap = document.getElementById('ops-activos');
  if (!wrap) return;
  const total = [...activos.values()].reduce((n, p) => n + p.activos.length, 0);
  if (!total) { wrap.innerHTML = `<div class="ad-empty">${t('Nadie activo ahora.')}</div>`; return; }
  wrap.innerHTML = [...activos.entries()].map(([pid, info]) => `
    <div class="ops-grp">
      <button class="ops-grp__head" data-plaza="${pid}">
        <span class="ops-grp__plaza">${esc(info.nombre ?? t('Sin plaza'))}</span>
        <span class="ops-grp__count">${info.activos.length}</span>
      </button>
      <ul class="ops-grp__list">${info.activos.map(a => `
        <li><span class="ops-grp__name">${esc(a.nombre)}</span><span class="ops-grp__time">${fmtFecha(a.hora)}</span></li>
      `).join('')}</ul>
    </div>`).join('');
  wrap.querySelectorAll('[data-plaza]').forEach(b => b.addEventListener('click', () => {
    const pid = parseInt(b.dataset.plaza);
    if (_ops.handle && _ops.mapMod) _ops.mapMod.seleccionarPlaza(_ops.handle, pid);
  }));
}

// Marcador del mapa clicado → resalta su grupo en la lista lateral.
function mostrarActivosPlaza(plazaId) {
  const head = document.querySelector(`#ops-activos [data-plaza="${plazaId}"]`);
  if (!head) return;
  head.closest('.ops-grp')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  head.classList.add('is-flash');
  setTimeout(() => head.classList.remove('is-flash'), 900);
}

function setLive(on) {
  _ops.live = on;
  document.getElementById('ops-dot')?.classList.toggle('is-on', on);
  const txt = document.getElementById('ops-live-txt');
  if (txt && on) txt.textContent = t('En vivo');
}

function stampHora() {
  if (_ops.live) return; // "En vivo" gana sobre la marca de hora
  const txt = document.getElementById('ops-live-txt');
  if (!txt) return;
  const loc = getLang() === 'en' ? 'en-US' : 'es-MX';
  txt.textContent = `${t('Actualizado')} ${new Date().toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit' })}`;
}

// ── Audit log panel ───────────────────────────────────────────────────────────
// Traduce un renglón del audit_log a lenguaje administrativo (no de programador).
const OP_VERBO = { INSERT: 'Creó', UPDATE: 'Modificó', DELETE: 'Eliminó' };
const TABLA_ENTIDAD = {
  empleados:      'un empleado',  // datos del empleado (alta/baja, puesto, plaza, contacto…)
  turnos:         'un turno',
  plazas:         'una plaza',
  puestos:        'un puesto',
  registros:      'un registro de asistencia',
  incidencias:    'una nota',
  perfiles_admin: 'un administrador',
  config_global:  'la configuración',
};
// Etiqueta legible de cada clave de config_global, para nombrar qué se cambió.
const CONFIG_LBL = {
  nombre_empresa: 'el nombre de la empresa', empresa_direccion: 'la dirección de la empresa',
  empresa_rfc: 'el RFC', empresa_logo_url: 'el logo de la empresa',
  tolerancia_retardo_min: 'la tolerancia de retardo', jornada_horas: 'la jornada estándar',
};
function accionHumana(r) {
  const verbo = t(OP_VERBO[r.operacion] ?? r.operacion).toLowerCase();
  const d     = r.datos_despues ?? r.datos_antes ?? {};
  if (r.tabla === 'config_global') {
    const campo = CONFIG_LBL[d.clave] ? t(CONFIG_LBL[d.clave]) : t('la configuración');
    return `${t('Se')} ${verbo} ${campo}`.replace(/\s+/g, ' ').trim();
  }
  const entidad = t(TABLA_ENTIDAD[r.tabla] ?? `un registro (${r.tabla})`);
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

// ── Ruteo de cambios a panel (ÚNICO origen de verdad) ───────────────────────────
// Cada tabla auditada va a EXACTAMENTE un panel, así nunca se duplica:
//   'HC'    = operación diaria → Historial de cambios (horarios, descansos, notas)
//   'AUDIT' = administración general → Log de Auditoría (plazas, empleados, config…)
// Para mandar una tabla nueva a un panel, añádela aquí y solo aquí.
const DESTINO_CAMBIO = {
  turnos_dia: 'HC', horarios_semana: 'HC', incidencias: 'HC',
  empleados: 'AUDIT', turnos: 'AUDIT', plazas: 'AUDIT', puestos: 'AUDIT',
  registros: 'AUDIT', perfiles_admin: 'AUDIT', config_global: 'AUDIT',
};
// Tabla desconocida → Auditoría (administración) por defecto, nunca se pierde.
const destinoCambio = (tabla) => DESTINO_CAMBIO[tabla] ?? 'AUDIT';
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
      <th>${t('Empleado')}</th><th>${t('Responsable')}</th><th>${t('Detalle')}</th>
    </tr></thead><tbody>
    ${rows.map(i => {
      const cambios = cambiosHTML(i._raw);
      const det = cambios.includes('<b>')
        ? `<details class="audit-item__det"><summary>${t('Ver detalle')}</summary><div class="audit-item__cambios">${cambios}</div></details>`
        : `<span class="td-muted">—</span>`;
      return `<tr>
      <td data-label="${t('Fecha')}">${esc(fmtFecha(i.fecha))}</td>
      <td data-label="${t('Tipo de hecho')}"><span class="abadge abadge--${i.tono}">${esc(t(i.tipo))}</span></td>
      <td data-label="${t('Empleado')}">${esc(i.emp || '—')}${i.dia ? ` <span class="td-muted">· ${esc(i.dia)}</span>` : ''}</td>
      <td data-label="${t('Responsable')}">${esc(i.responsable)}</td>
      <td data-label="${t('Detalle')}">${det}</td>
    </tr>`; }).join('')}
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
    const items = rows.filter(r => destinoCambio(r.tabla) === 'HC').map(r => {
      const d = r.datos_despues ?? r.datos_antes ?? {};
      const titulo = tituloCambio(r, d);
      return {
        fecha: r.created_at, tipo: titulo, tono: CAMBIO_TONO[titulo] ?? 'gray',
        emp: nombreEmp.get(d.id_empleado) ?? '', dia: d.fecha ?? '',
        responsable: r.perfiles_admin?.nombre ?? t('Sistema'), _raw: r,
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

// Reverse-geocode "lat,lon" → dirección (Nominatim/OSM, sin API key). Cachea la
// promesa por coordenada para no repetir la petición. Se llama al abrir el
// detalle (no en cada render) para respetar el límite de uso de Nominatim.
const _geoCache = new Map();
function reverseGeocode(loc) {
  if (_geoCache.has(loc)) return _geoCache.get(loc);
  const [lat, lon] = loc.split(',');
  const p = fetch(`https://nominatim.openstreetmap.org/reverse?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&format=json&zoom=18`,
      { headers: { 'Accept-Language': 'es' } })
    .then(r => r.ok ? r.json() : null).then(j => j?.display_name || null).catch(() => null);
  _geoCache.set(loc, p);
  return p;
}

// Celda de detalle: conserva el <details> "Ver detalle" con el diff. En lugar de
// la IP muestra la ubicación GPS del admin (login): enlace al mapa + dirección
// (reverse-geocode al abrir). Si no hay ubicación, cae a la IP.
function detalleHTML(r) {
  const cambios = cambiosHTML(r);
  if (!cambios.includes('<b>')) return `<span class="td-muted">—</span>`;
  const loc = r.admin_ubicacion;
  const ubic = loc
    ? `<span class="audit-item__ip">
        <a class="abtn abtn--ghost audit-ip-btn" href="https://www.google.com/maps?q=${encodeURIComponent(loc)}" target="_blank" rel="noopener">${t('Ver ubicación')}</a>
        <span class="audit-addr" data-loc="${esc(loc)}">${t('Cargando dirección…')}</span>
       </span>`
    : `<span class="audit-item__ip">IP: ${esc(r.ip_address ?? '—')}</span>`;
  return `<details class="audit-item__det"><summary>${t('Ver detalle')}</summary>
    <div class="audit-item__cambios">${cambios}</div>
    ${ubic}
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
    // Auditoría = administración general (ver DESTINO_CAMBIO, único origen de verdad).
    const rows = (await getAuditLog(100)).filter(r => destinoCambio(r.tabla) === 'AUDIT');
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

    // Al abrir un detalle, resuelve la dirección de su ubicación una sola vez.
    // El wrap persiste entre renders (solo cambia su innerHTML) → un listener.
    document.getElementById('audit-wrap').addEventListener('click', (e) => {
      if (!e.target.closest('summary')) return;
      const addr = e.target.closest('details')?.querySelector('.audit-addr[data-loc]');
      if (!addr || addr.dataset.loaded) return;
      addr.dataset.loaded = '1';
      reverseGeocode(addr.dataset.loc).then(name => {
        addr.textContent = name ? `📍 ${name}` : t('Dirección no disponible');
      });
    });
    render();
  } catch (e) {
    document.getElementById('audit-wrap').innerHTML =
      `<div class="ad-empty" style="color:#DC2626">${esc(e.message)}</div>`;
  }
}

// ── Init ──────────────────────────────────────────────────────────────────────
showPanel(location.hash.slice(1) || 'overview');
