import * as api from './api.js';
import { fmtFecha, fmtDistancia } from './utils.js';

let _refreshTimer = null;

export async function init(panel, sesion) {
  const hoy = new Date().toISOString().slice(0, 10);

  panel.innerHTML = `
    <div class="panel-header">
      <h2>Asistencia</h2>
      <div class="panel-header__actions">
        <span id="asist-refresh-badge" class="abadge abadge--blue" style="font-size:.72rem">
          <div class="ad-spinner" style="width:10px;height:10px;border-width:1.5px;margin-right:4px"></div>
          En vivo
        </span>
        <button class="abtn abtn--ghost" id="btn-refrescar">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
          Actualizar
        </button>
      </div>
    </div>
    <div class="ad-card">
      <div class="ad-card__body">
        <div class="filters-bar">
          <div class="form-group">
            <label for="asist-fecha">Fecha</label>
            <input id="asist-fecha" class="form-input" type="date" value="${hoy}" style="height:36px">
          </div>
        </div>
      </div>
      <div id="tbl-asist-wrap"></div>
    </div>`;

  const load = () => loadAsistencia(sesion);
  document.getElementById('btn-refrescar').addEventListener('click', load);
  document.getElementById('asist-fecha').addEventListener('change', load);

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
    const registros = await api.getRegistros({ fecha });

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
        <td>${fmtFecha(r.hora)}</td>
        <td>${empleado?.nombre ?? '–'}</td>
        <td>${plaza}</td>
        <td><span class="abadge abadge--${r.tipo}">${r.tipo}</span></td>
        <td>${geoHTML}</td>
        <td>${mapLink}</td>
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
