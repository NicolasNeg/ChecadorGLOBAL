import { verificarPin, limpiarSesion, obtenerTurnosPlazaSemana, setIdEmpleado } from './api.js';
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

// ── Límite de intentos de PIN (anti fuerza bruta básico) ───────────────────────
// ponytail: contador en localStorage, por dispositivo — disuasorio, no barrera
// real (se puede limpiar el storage). El control duro debe ir en el RPC
// verificar_pin (rate-limit server-side) — pendiente.
const PIN_MAX_INTENTOS = 5;
const PIN_BLOQUEO_MS = 60_000;
const pinIntentos     = () => parseInt(localStorage.getItem('eqs_pin_intentos') || '0', 10);
const pinBloqueoHasta = () => parseInt(localStorage.getItem('eqs_pin_bloqueo') || '0', 10);
const limpiarIntentosPin = () => { localStorage.removeItem('eqs_pin_intentos'); localStorage.removeItem('eqs_pin_bloqueo'); };

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

  // Bloqueo temporal tras superar el máximo de intentos: deshabilita el botón y
  // muestra una cuenta regresiva; se rehabilita solo al expirar.
  let bloqueoTimer = null;
  function aplicarBloqueo() {
    const restante = () => Math.ceil((pinBloqueoHasta() - Date.now()) / 1000);
    if (restante() <= 0) return;
    shakeInput('input-pin');
    const pintar = () => {
      const s = restante();
      if (s <= 0) {
        clearInterval(bloqueoTimer); bloqueoTimer = null;
        btnPin.disabled = false; label.textContent = t('Continuar'); setError('error-pin', '');
        return;
      }
      btnPin.disabled = true;
      setError('error-pin', `${t('Demasiados intentos. Espera')} ${s}s.`);
    };
    pintar();
    clearInterval(bloqueoTimer);
    bloqueoTimer = setInterval(pintar, 1000);
  }
  if (Date.now() < pinBloqueoHasta()) aplicarBloqueo();

  form.onsubmit = async (e) => {
    e.preventDefault();
    if (Date.now() < pinBloqueoHasta()) { aplicarBloqueo(); return; }
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
      if (!bloqueoTimer) { btnPin.disabled = false; label.textContent = t('Continuar'); }
      spinner.hidden = true;
    }

    if (res?.ok) {
      limpiarIntentosPin();
      const { ok, ...perfil } = res;
      setSession(perfil);
      enterMenu(perfil);
    } else {
      const n = pinIntentos() + 1;
      if (n >= PIN_MAX_INTENTOS) {
        localStorage.setItem('eqs_pin_bloqueo', String(Date.now() + PIN_BLOQUEO_MS));
        localStorage.setItem('eqs_pin_intentos', '0');
        aplicarBloqueo();
      } else {
        localStorage.setItem('eqs_pin_intentos', String(n));
        setError('error-pin', `${res?.error || t('PIN incorrecto.')} ${PIN_MAX_INTENTOS - n} ${t('intentos restantes')}.`);
        shakeInput('input-pin');
      }
    }
  };
}

// ── Menu / Welcome screen ─────────────────────────────────────────────────────
function enterMenu(perfil) {
  // restaura el id en el módulo api (la sesión puede venir de sessionStorage)
  if (perfil.idEmpleado) setIdEmpleado(perfil.idEmpleado);
  _miId = perfil.idEmpleado ?? null;
  const nombre = perfil.nombre ?? '';

  // Avatar: foto de perfil si existe, si no las iniciales (hasta 2 chars).
  const initials = nombre.trim().split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
  const av = document.getElementById('saludo-avatar');
  if (perfil.fotoUrl) {
    av.style.backgroundImage = `url("${perfil.fotoUrl}")`;
    av.classList.add('saludo-avatar--foto');
    av.textContent = '';
  } else {
    av.style.backgroundImage = '';
    av.classList.remove('saludo-avatar--foto');
    av.textContent = initials || '–';
  }

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
  checkProximaSemana(); // fire-and-forget: pinta el punto rojo si ya hay horario nuevo
  document.getElementById('btn-cerrar-sesion').onclick = () => {
    clearSession();
    limpiarSesion();
    enterLogin();
  };

  switchTo(sLogin, sMenu);
}

// ── Turnos de la plaza (distribución semanal por fecha) ──────────────────────
const hhmm = (t) => t ? t.slice(0, 5) : '';
const DIAS_AB = ['', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const lunesDe = (d) => { const x = new Date(d); const dow = (x.getDay() + 6) % 7; x.setDate(x.getDate() - dow); x.setHours(0, 0, 0, 0); return x; };
const ymdT    = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDiasT = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
let _semanaT = lunesDe(new Date()); // lunes de la semana visible en el checador

const proxLunes = () => addDiasT(lunesDe(new Date()), 7); // lunes de la PRÓXIMA semana
const vistoKey  = () => `eqs_turnos_visto_${_miId}`;

// Punto rojo en "Mi turno": hay horario de la próxima semana y aún no lo abriste.
// ponytail: "nuevo" = no has visto la próxima semana; NO reaparece si RH la
// re-edita después (turnos_dia no tiene updated_at). Añade updated_at + comparar
// si se necesita avisar de cambios posteriores.
async function checkProximaSemana() {
  const dot = document.getElementById('turnos-dot');
  if (!dot || !_miId) return;
  const pl = proxLunes();
  const filas = await obtenerTurnosPlazaSemana(ymdT(pl), ymdT(addDiasT(pl, 6)));
  const tengo = filas.some(f => f.empleado_id === _miId);
  const visto = localStorage.getItem(vistoKey()) === ymdT(pl);
  dot.hidden = !(tengo && !visto);
  if (!dot.hidden) dot.setAttribute('aria-label', t('Ya hay horario de la próxima semana'));
}

async function enterTurnos() {
  _semanaT = lunesDe(new Date()); // reabre siempre en la semana actual (sobrevive al cruce de medianoche)
  document.getElementById('btn-turnos-volver').onclick = () => switchTo(sTurnos, sMenu);
  if (sTurnos.hidden) switchTo(sMenu, sTurnos);
  await renderTurnos();
}

async function renderTurnos() {
  const lista = document.getElementById('turnos-lista');
  lista.innerHTML = `<p class="turnos-vacio">${t('Cargando…')}</p>`;

  const fechas = [0, 1, 2, 3, 4, 5, 6].map(i => addDiasT(_semanaT, i));

  // Viste la próxima semana (o más adelante) → marca como visto y apaga el punto.
  if (_miId && ymdT(_semanaT) >= ymdT(proxLunes())) {
    localStorage.setItem(vistoKey(), ymdT(proxLunes()));
    const dot = document.getElementById('turnos-dot'); if (dot) dot.hidden = true;
  }

  const filas = await obtenerTurnosPlazaSemana(ymdT(_semanaT), ymdT(fechas[6]));

  const fechaLabel = (d) => d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' });
  const rango = `${fechaLabel(_semanaT)} – ${fechaLabel(fechas[6])} ${fechas[6].getFullYear()}`;
  const nav = `
    <div class="sem-nav">
      <button class="sem-nav__btn" id="t-prev" aria-label="${t('Semana anterior')}">‹</button>
      <div class="sem-nav__label">${rango}</div>
      <button class="sem-nav__btn" id="t-next" aria-label="${t('Semana siguiente')}">›</button>
      <button class="sem-nav__hoy" id="t-hoy">${t('Hoy')}</button>
    </div>`;

  const bindNav = () => {
    const go = (n) => { _semanaT = n; renderTurnos(); };
    lista.querySelector('#t-prev').onclick = () => go(addDiasT(_semanaT, -7));
    lista.querySelector('#t-next').onclick = () => go(addDiasT(_semanaT, 7));
    lista.querySelector('#t-hoy').onclick  = () => go(lunesDe(new Date()));
  };

  if (!filas.length) {
    lista.innerHTML = nav + `<p class="turnos-vacio">${t('Sin turnos asignados esta semana.')}</p>`;
    bindNav();
    return;
  }

  // Empleados en orden de aparición (el RPC ordena por nombre) + celdas por fecha.
  const empleados = [];
  const celdas = new Map(); // `${id}-${fecha}` → fila
  for (const f of filas) {
    if (!empleados.some(e => e.id === f.empleado_id)) empleados.push({ id: f.empleado_id, nombre: f.empleado });
    celdas.set(`${f.empleado_id}-${f.fecha}`, f);
  }

  // Guía visual: día de hoy resaltado, días ya pasados atenuados.
  const hoyT = ymdT(new Date());
  const colCls = (d) => { const k = ymdT(d); return k === hoyT ? 'tg-col--hoy' : k < hoyT ? 'tg-col--pasado' : ''; };
  const head = `<tr><th class="tg-emp">${t('Empleado')}</th>${fechas.map(d =>
    `<th class="${colCls(d)}">${t(DIAS_AB[((d.getDay() + 6) % 7) + 1])}<span class="tg-fecha">${fechaLabel(d)}</span></th>`).join('')}</tr>`;
  const body = empleados.map(e => `
    <tr class="${e.id === _miId ? 'tg-yo' : ''}">
      <td class="tg-emp">${e.nombre}</td>
      ${fechas.map(d => {
        const c = celdas.get(`${e.id}-${ymdT(d)}`);
        return c
          ? `<td class="${colCls(d)}"><span class="tg-turno">${c.turno_nombre}</span><span class="tg-horas">${hhmm(c.hora_entrada)}–${hhmm(c.hora_salida)}</span></td>`
          : `<td class="tg-off ${colCls(d)}">${t('Descanso')}</td>`;
      }).join('')}
    </tr>`).join('');

  lista.innerHTML = nav + `<div class="turnos-grid-scroll"><table class="turnos-grid"><thead>${head}</thead><tbody>${body}</tbody></table></div>`;
  bindNav();
}
