import * as api from './api.js';
import { fmtFecha, fmtDistancia } from './utils.js';
import { filterByPlaza } from './plaza-scope.js';

let _refreshTimer = null;

const shiftDay = (iso, delta) => {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + delta);
  return d.toISOString().slice(0, 10);
};
const fmtDiaLargo = (iso) =>
  new Date(iso + 'T00:00:00').toLocaleDateString('es-MX',
    { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

export async function init(panel, sesion) {
  const hoy = new Date().toISOString().slice(0, 10);

  panel.innerHTML = `
    <div class="panel-header">
      <h2>Asistencia</h2>
      <button class="abtn abtn--ghost" id="btn-refrescar">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
        Actualizar
      </button>
    </div>

    <div class="day-nav">
      <button class="abtn abtn--ghost abtn--icon" id="dia-prev" aria-label="Día anterior">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
      </button>
      <h3 class="day-nav__title" id="dia-titulo">—</h3>
      <button class="abtn abtn--ghost abtn--icon" id="dia-next" aria-label="Día siguiente">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
      </button>
      <label class="day-nav__cal abtn abtn--ghost abtn--icon" title="Elegir fecha" aria-label="Elegir fecha">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
        <input id="asist-fecha" type="date" value="${hoy}">
      </label>
    </div>

    <div class="ad-card">
      <div id="tbl-asist-wrap"></div>
    </div>`;

  const fechaInput = document.getElementById('asist-fecha');
  const load = () => {
    document.getElementById('dia-titulo').textContent = fmtDiaLargo(fechaInput.value);
    return loadAsistencia(sesion);
  };
  const step = (delta) => { fechaInput.value = shiftDay(fechaInput.value, delta); load(); };

  document.getElementById('btn-refrescar').addEventListener('click', load);
  document.getElementById('dia-prev').addEventListener('click', () => step(-1));
  document.getElementById('dia-next').addEventListener('click', () => step(1));
  fechaInput.addEventListener('change', load);

  await load();

  // Auto-refresh every 30 seconds
  _refreshTimer = setInterval(load, 30_000);
}

export function destroy() {
  clearInterval(_refreshTimer);
}

async function loadAsistencia(sesion) {
  const wrap  = document.getElementById('tbl-asist-wrap');
  const fecha = document.getElementById('asist-fecha')?.value;
  if (!wrap) return;

  wrap.innerHTML = `<div class="ad-loading"><div class="ad-spinner"></div> Cargando registros…</div>`;

  try {
    const registros = filterByPlaza(await api.getRegistros({ fecha }), r => r.empleados?.plaza_id);

    if (!registros.length) {
      wrap.innerHTML = `<div class="ad-empty">Sin registros para esta fecha.</div>`;
      return;
    }

    const filas = registros.map(r => {
      const empleado = r.empleados;
      const plaza    = empleado?.plazas?.nombre ?? '–';
      const geo      = r.geocerca_valida;
      const geoHTML  = geo === true
        ? '<span class="abadge abadge--green">Dentro</span>'
        : geo === false
          ? `<span class="abadge abadge--red">Fuera · ${fmtDistancia(r.distancia_metros)}</span>`
          : '<span class="abadge abadge--gray">Sin geocerca</span>';

      const mapLink = (r.latitud && r.longitud)
        ? `<a href="https://www.google.com/maps?q=${r.latitud},${r.longitud}" target="_blank" rel="noopener" style="font-size:.8rem">Ver</a>`
        : '–';

      return `<tr ${geo === false ? 'style="background:#FFF5F5"' : ''}>
        <td data-label="Fecha / Hora">${fmtFecha(r.hora)}</td>
        <td data-label="Empleado">${empleado?.nombre ?? '–'}</td>
        <td data-label="Plaza">${plaza}</td>
        <td data-label="Tipo"><span class="abadge abadge--${r.tipo}">${r.tipo}</span></td>
        <td data-label="Geocerca">${geoHTML}</td>
        <td data-label="Mapa">${mapLink}</td>
      </tr>`;
    }).join('');

    wrap.innerHTML = `<div class="table-scroll">
      <table class="data-table">
        <thead><tr>
          <th>Fecha / Hora</th>
          <th>Empleado</th>
          <th>Plaza</th>
          <th>Tipo</th>
          <th>Geocerca</th>
          <th>Mapa</th>
        </tr></thead>
        <tbody>${filas}</tbody>
      </table>
    </div>`;
  } catch (e) {
    wrap.innerHTML = `<div class="ad-empty" style="color:#DC2626">${e.message}</div>`;
  }
}
