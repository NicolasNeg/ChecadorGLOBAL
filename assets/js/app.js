import { verificarPin, limpiarSesion } from './api.js';
import { getSession, setSession, clearSession } from './auth.js';
import { BASE } from './config.js';

const sLogin = document.getElementById('s-login');
const sMenu  = document.getElementById('s-menu');

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

// ── Boot ─────────────────────────────────────────────────────────────────────
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
  btnPin.disabled  = false;
  label.textContent = 'Continuar';
  spinner.hidden   = true;
  setError('error-pin', '');

  switchTo(sMenu, sLogin);
  setTimeout(() => input.focus(), 380);

  form.onsubmit = async (e) => {
    e.preventDefault();
    const pin = input.value.trim();
    if (!pin) { setError('error-pin', 'Ingresa tu PIN.'); shakeInput('input-pin'); return; }
    setError('error-pin', '');

    btnPin.disabled   = true;
    label.textContent = 'Verificando…';
    spinner.hidden    = false;

    let res;
    try {
      res = await verificarPin(pin);
    } finally {
      btnPin.disabled   = false;
      label.textContent = 'Continuar';
      spinner.hidden    = true;
    }

    if (res?.ok) {
      const { ok, ...perfil } = res;
      setSession(perfil);
      enterMenu(perfil);
    } else {
      setError('error-pin', res?.error || 'PIN incorrecto.');
      shakeInput('input-pin');
    }
  };
}

// ── Menu / Welcome screen ─────────────────────────────────────────────────────
function enterMenu(perfil) {
  const nombre = perfil.nombre ?? '';

  // Avatar initials (up to 2 chars)
  const initials = nombre.trim().split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
  document.getElementById('saludo-avatar').textContent = initials || '–';

  // Time-of-day greeting
  const h = new Date().getHours();
  const hora = h < 12 ? 'Buenos días' : h < 19 ? 'Buenas tardes' : 'Buenas noches';
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
  document.getElementById('btn-cerrar-sesion').onclick = () => {
    clearSession();
    limpiarSesion();
    enterLogin();
  };

  switchTo(sLogin, sMenu);
}
