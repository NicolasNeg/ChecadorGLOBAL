import { verificarPin, limpiarSesion } from './api.js';
import { getSession, setSession, clearSession } from './auth.js';
import { BASE } from './config.js';

const sLogin = document.getElementById('s-login');
const sMenu  = document.getElementById('s-menu');

function setError(id, msg) {
  const el = document.getElementById(id);
  el.textContent = msg;
  el.hidden = !msg;
}

const existing = getSession();
if (existing) enterMenu(existing.nombre);
else          enterLogin();

function enterLogin() {
  sLogin.hidden = false;
  sMenu.hidden  = true;

  const form   = document.getElementById('form-pin');
  const input  = document.getElementById('input-pin');
  const btnPin = document.getElementById('btn-continuar-pin');
  input.value = '';
  setTimeout(() => input.focus(), 50);

  form.onsubmit = async (e) => {
    e.preventDefault();
    const pin = input.value.trim();
    if (!pin) { setError('error-pin', 'Ingresa tu PIN.'); return; }
    setError('error-pin', '');
    btnPin.disabled = true;
    btnPin.textContent = 'Verificando…';

    let res;
    try { res = await verificarPin(pin); }
    catch {
      setError('error-pin', 'Error de conexión. Intenta de nuevo.');
      btnPin.disabled = false;
      btnPin.textContent = 'Continuar';
      return;
    }

    if (res?.ok) {
      setSession({ nombre: res.nombre, idEmpleado: res.idEmpleado });
      enterMenu(res.nombre);
    } else {
      setError('error-pin', res?.error || 'PIN incorrecto.');
      btnPin.disabled = false;
      btnPin.textContent = 'Continuar';
    }
  };
}

function enterMenu(nombre) {
  sLogin.hidden = true;
  sMenu.hidden  = false;
  document.getElementById('saludo').textContent = `Hola, ${nombre}`;

  document.getElementById('btn-checar').onclick    = () => { location.href = BASE + '/checador/'; };
  document.getElementById('btn-historial').onclick = () => { location.href = BASE + '/historial/'; };
  document.getElementById('btn-cerrar-sesion').onclick = () => {
    clearSession();
    limpiarSesion();
    enterLogin();
  };
}
