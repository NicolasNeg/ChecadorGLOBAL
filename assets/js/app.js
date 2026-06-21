import { verificarPin, limpiarSesion, obtenerTurnosPlaza, setIdEmpleado } from './api.js';
import { getSession, setSession, clearSession } from './auth.js';
import { BASE } from './config.js';
import { t, applyI18n, mountLangToggle } from './i18n.js';

const sLogin  = document.getElementById('s-login');
const sMenu   = document.getElementById('s-menu');
const sTurnos = document.getElementById('s-turnos');

mountLangToggle(document.querySelector('.top-actions'));
applyI18n(document);
window.addEventListener('langchange', () => {
  applyI18n(document);
  const sh = document.getElementById('saludo-hora');
  const h = new Date().getHours();
  if (sh && !sMenu.hidden) sh.textContent = h < 12 ? t('Buenos días') : h < 19 ? t('Buenas tardes') : t('Buenas noches');
  if (!sTurnos.hidden) enterTurnos();
});

// ── Animate between two .pantalla screens ───────────────────────────────────
function switchTo(from, to) {
  if (from.hidden) { to.hidden = false; return; }
  from.classList.add('exiting');
  setTimeout(() => {
    from.hidden = true;
    from.classList.remove('exiting');
    to.hidden = false;
  }, 160);
}

// ── Error message ────────────────────────────────────────────────────────────
function setError(id, msg) {
  const el = document.getElementById(id);
  el.textContent = msg;
  el.hidden = !msg;
}

// ── Shake input on error ─────────────────────────────────────────────────────
function shakeInput(id) {
  const el = document.getElementById(id);
  el.classList.remove('input-pin--shake');
  void el.offsetWidth; // restart animation
  el.classList.add('input-pin--shake');
  el.addEventListener('animationend', () => el.classList.remove('input-pin--shake'), { once: true });
}

// ── Switch de tema (sol/luna) — el tema ya se aplicó en el <script> del <head> ──
(function initTheme() {
  const btn = document.getElementById('theme-toggle');
  if (!btn) return;
  const sync = () => btn.setAttribute('aria-checked', document.documentElement.dataset.theme === 'dark');
  sync();
  btn.addEventListener('click', () => {
    const oscuro = document.documentElement.dataset.theme !== 'dark';
    document.documentElement.dataset.theme = oscuro ? 'dark' : 'light';
    try { localStorage.setItem('eqs_theme', oscuro ? 'dark' : 'light'); } catch {}
    sync();
  });
})();

// ── Boot ─────────────────────────────────────────────────────────────────────
let _miId = null; // id del empleado en sesión (lo usa enterTurnos); declarado antes del boot por TDZ
const existing = getSession();
if (existing) enterMenu(existing);
else          enterLogin();

// ── Login screen ─────────────────────────────────────────────────────────────
function enterLogin() {
  const form    = document.getElementById('form-pin');
  const input   = document.getElementById('input-pin');
  const btnPin  = document.getElementById('btn-continuar-pin');
  const label   = document.getElementById('pin-btn-label');
  const spinner = document.getElementById('pin-btn-spinner');

  input.value      = '';
  // PIN: sólo 4 dígitos, no permitir más ni caracteres no numéricos.
  input.oninput = () => { input.value = input.value.replace(/\D/g, '').slice(0, 4); };
  btnPin.disabled  = false;
  label.textContent = t('Continuar');
  spinner.hidden   = true;
  setError('error-pin', '');

  // Mostrar/ocultar PIN (ojo abierto/cerrado)
  const verBtn = document.getElementById('btn-ver-pin');
  verBtn.onclick = () => {
    const shown = input.type === 'text';
    input.type = shown ? 'password' : 'text';
    verBtn.classList.toggle('revealed', !shown);
    verBtn.setAttribute('aria-pressed', String(!shown));
    verBtn.setAttribute('aria-label', shown ? t('Mostrar PIN') : t('Ocultar PIN'));
    input.focus();
  };

  switchTo(sMenu, sLogin);
  setTimeout(() => input.focus(), 380);

  form.onsubmit = async (e) => {
    e.preventDefault();
    const pin = input.value.trim();
    if (!pin) { setError('error-pin', t('Ingresa tu PIN.')); shakeInput('input-pin'); return; }
    setError('error-pin', '');

    btnPin.disabled   = true;
    label.textContent = t('Verificando…');
    spinner.hidden    = false;

    let res;
    try {
      res = await verificarPin(pin);
    } finally {
      btnPin.disabled   = false;
      label.textContent = t('Continuar');
      spinner.hidden    = true;
    }

    if (res?.ok) {
      const { ok, ...perfil } = res;
      setSession(perfil);
      enterMenu(perfil);
    } else {
      setError('error-pin', res?.error || t('PIN incorrecto.'));
      shakeInput('input-pin');
    }
  };
}

// ── Menu / Welcome screen ─────────────────────────────────────────────────────
function enterMenu(perfil) {
  // restaura el id en el módulo api (la sesión puede venir de sessionStorage)
  if (perfil.idEmpleado) setIdEmpleado(perfil.idEmpleado);
  _miId = perfil.idEmpleado ?? null;
  const nombre = perfil.nombre ?? '';

  // Avatar initials (up to 2 chars)
  const initials = nombre.trim().split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
  document.getElementById('saludo-avatar').textContent = initials || '–';

  // Time-of-day greeting
  const h = new Date().getHours();
  const hora = h < 12 ? t('Buenos días') : h < 19 ? t('Buenas tardes') : t('Buenas noches');
  document.getElementById('saludo-hora').textContent = hora;

  document.getElementById('saludo').textContent = nombre;

  // Professional sub-line: puesto · plaza  (and employee number tag)
  const meta = [perfil.puesto, perfil.plazaNombre].filter(Boolean).join(' · ');
  const metaEl = document.getElementById('saludo-meta');
  metaEl.textContent = meta;
  metaEl.hidden = !meta;

  const numEl = document.getElementById('saludo-num');
  numEl.textContent = perfil.numeroEmpleado ? `#${perfil.numeroEmpleado}` : '';
  numEl.hidden = !perfil.numeroEmpleado;

  document.getElementById('btn-checar').onclick    = () => { location.href = BASE + '/checador/'; };
  document.getElementById('btn-historial').onclick = () => { location.href = BASE + '/historial/'; };
  document.getElementById('btn-turnos').onclick    = () => enterTurnos();
  document.getElementById('btn-cerrar-sesion').onclick = () => {
    clearSession();
    limpiarSesion();
    enterLogin();
  };

  switchTo(sLogin, sMenu);
}

// ── Turnos de la plaza ───────────────────────────────────────────────────────
const hhmm = (t) => t ? t.slice(0, 5) : '';
const DIAS_AB = ['', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

async function enterTurnos() {
  const lista = document.getElementById('turnos-lista');
  lista.innerHTML = `<p class="turnos-vacio">${t('Cargando…')}</p>`;
  document.getElementById('btn-turnos-volver').onclick = () => switchTo(sTurnos, sMenu);
  if (sTurnos.hidden) switchTo(sMenu, sTurnos);

  const filas = await obtenerTurnosPlaza();
  if (!filas.length) {
    lista.innerHTML = `<p class="turnos-vacio">${t('Aún no hay turnos asignados en tu plaza.')}</p>`;
    return;
  }

  // Empleados en orden de aparición (el RPC ordena por nombre) + celdas por día.
  const empleados = [];
  const celdas = new Map(); // `${id}-${dia}` → fila
  for (const f of filas) {
    if (!empleados.some(e => e.id === f.empleado_id)) {
      empleados.push({ id: f.empleado_id, nombre: f.empleado });
    }
    celdas.set(`${f.empleado_id}-${f.dia_semana}`, f);
  }

  const head = `<tr><th class="tg-emp">${t('Empleado')}</th>${
    [1,2,3,4,5,6,7].map(d => `<th>${t(DIAS_AB[d])}</th>`).join('')}</tr>`;
  const body = empleados.map(e => `
    <tr class="${e.id === _miId ? 'tg-yo' : ''}">
      <td class="tg-emp">${e.nombre}</td>
      ${[1,2,3,4,5,6,7].map(d => {
        const c = celdas.get(`${e.id}-${d}`);
        return c
          ? `<td><span class="tg-turno">${c.turno_nombre}</span><span class="tg-horas">${hhmm(c.hora_entrada)}–${hhmm(c.hora_salida)}</span></td>`
          : `<td class="tg-off">${t('Descanso')}</td>`;
      }).join('')}
    </tr>`).join('');

  lista.innerHTML = `<div class="turnos-grid-scroll"><table class="turnos-grid"><thead>${head}</thead><tbody>${body}</tbody></table></div>`;
}
