import { verificarPin, limpiarSesion, obtenerMisTurnos, setIdEmpleado } from './api.js';
import { getSession, setSession, clearSession } from './auth.js';
import { BASE } from './config.js';

const sLogin  = document.getElementById('s-login');
const sMenu   = document.getElementById('s-menu');
const sTurnos = document.getElementById('s-turnos');
const DOW = ['', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

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

  // Mostrar/ocultar PIN (ojo abierto/cerrado)
  const verBtn = document.getElementById('btn-ver-pin');
  verBtn.onclick = () => {
    const shown = input.type === 'text';
    input.type = shown ? 'password' : 'text';
    verBtn.classList.toggle('revealed', !shown);
    verBtn.setAttribute('aria-pressed', String(!shown));
    verBtn.setAttribute('aria-label', shown ? 'Mostrar PIN' : 'Ocultar PIN');
    input.focus();
  };

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
  // restaura el id en el módulo api (la sesión puede venir de sessionStorage)
  if (perfil.idEmpleado) setIdEmpleado(perfil.idEmpleado);
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
  document.getElementById('btn-turnos').onclick    = () => enterTurnos();
  document.getElementById('btn-cerrar-sesion').onclick = () => {
    clearSession();
    limpiarSesion();
    enterLogin();
  };

  switchTo(sLogin, sMenu);
}

// ── Mi turno ───────────────────────────────────────────────────────────────
const hhmm = (t) => t ? t.slice(0, 5) : '';

async function enterTurnos() {
  const lista = document.getElementById('turnos-lista');
  lista.innerHTML = '<p class="turnos-vacio">Cargando…</p>';
  document.getElementById('btn-turnos-volver').onclick = () => switchTo(sTurnos, sMenu);
  switchTo(sMenu, sTurnos);

  const turnos = await obtenerMisTurnos();
  const porDia = new Map(turnos.map(t => [t.dia_semana, t]));

  lista.innerHTML = [1, 2, 3, 4, 5, 6, 7].map(d => {
    const t = porDia.get(d);
    const cuerpo = t
      ? `<span class="turno-dia__turno">${t.turno_nombre}</span>
         <span class="turno-dia__horas">${hhmm(t.hora_entrada)}–${hhmm(t.hora_salida)}${t.pausa_min ? ` · pausa ${t.pausa_min} min` : ''}</span>`
      : `<span class="turno-dia__descanso">Descanso</span>`;
    return `<div class="turno-dia ${t ? '' : 'turno-dia--off'}">
      <span class="turno-dia__nombre">${DOW[d]}</span>
      <div class="turno-dia__det">${cuerpo}</div>
    </div>`;
  }).join('');

  if (!turnos.length) {
    lista.insertAdjacentHTML('afterbegin', '<p class="turnos-vacio">Aún no tienes turnos asignados.</p>');
  }
}
