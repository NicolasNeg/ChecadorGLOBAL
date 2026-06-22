import { requireSession } from './auth.js';
import { setIdEmpleado, obtenerHistorial } from './api.js';
import { renderHistorial } from './historial.js';
import { BASE } from './config.js';
import { t, applyI18n, mountLangToggle } from './i18n.js';

const sesion = requireSession();
if (!sesion) throw new Error('sin sesión');

setIdEmpleado(sesion.idEmpleado);
document.getElementById('header-sub').textContent = sesion.nombre;
document.getElementById('btn-atras').addEventListener('click', () => { location.href = BASE + '/'; });

mountLangToggle(document.querySelector('.app-header'));
applyI18n(document);

const contenedor = document.getElementById('contenedor-historial');
contenedor.innerHTML = `<p class="cargando">${t('Cargando…')}</p>`;

const registros = await obtenerHistorial().catch(() => null);

// ── Filtros (sobre el array ya descargado; sin tocar el backend) ──────────────
const diaKey = (iso) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const CHIPS = [['todo', 'Todo'], ['hoy', 'Hoy'], ['semana', 'Semana'], ['mes', 'Mes']];
let chip = 'todo';
let dia = ''; // yyyy-mm-dd del date picker; si está, manda sobre el chip

function enRango(iso) {
  if (dia) return diaKey(iso) === dia;
  if (chip === 'todo') return true;
  const d = new Date(iso), now = new Date();
  if (chip === 'hoy') return diaKey(iso) === diaKey(now);
  if (chip === 'mes') return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  if (chip === 'semana') {
    const ini = new Date(now); ini.setHours(0, 0, 0, 0);
    ini.setDate(now.getDate() - ((now.getDay() + 6) % 7)); // semana lunes→domingo
    const fin = new Date(ini); fin.setDate(ini.getDate() + 7);
    return d >= ini && d < fin;
  }
  return true;
}

const calSvg = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`;

function pintar() {
  if (!Array.isArray(registros)) {
    contenedor.innerHTML = `<p class="error-txt" style="text-align:center;padding:32px 16px">${t('Error al cargar el historial.')}</p>`;
    return;
  }
  const lista = registros.filter((r) => enRango(r.hora));
  const chipsHtml = CHIPS.map(([id, lbl]) =>
    `<button type="button" class="hist-chip${!dia && chip === id ? ' is-active' : ''}" data-chip="${id}">${t(lbl)}</button>`).join('');

  contenedor.innerHTML = `
    <div class="hist-filtros">
      <div class="hist-chips" role="group" aria-label="${t('Filtros')}">${chipsHtml}</div>
      <label class="hist-dia-pick${dia ? ' is-active' : ''}" title="${t('Elegir día')}">
        ${calSvg}
        <input type="date" id="hist-dia" value="${dia}" aria-label="${t('Elegir día')}">
      </label>
    </div>
    <p class="hist-conteo">${lista.length} ${t(lista.length === 1 ? 'registro' : 'registros')}</p>
    <div id="hist-body"></div>`;

  contenedor.querySelectorAll('.hist-chip').forEach((b) =>
    b.addEventListener('click', () => { chip = b.dataset.chip; dia = ''; pintar(); }));
  const inp = contenedor.querySelector('#hist-dia');
  inp.addEventListener('change', () => { dia = inp.value; pintar(); });

  const body = contenedor.querySelector('#hist-body');
  if (!lista.length) body.innerHTML = `<p class="historial-vacio">${t('Sin registros en este periodo.')}</p>`;
  else renderHistorial(body, lista);
}

pintar();
window.addEventListener('langchange', () => { applyI18n(document); pintar(); });
