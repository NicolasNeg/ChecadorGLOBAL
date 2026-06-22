import * as api from './api.js';
import { renderTable, loading, showToast, openModal, closeModal, confirm } from './utils.js';
import { t } from '../i18n.js';
import { direccionDesdeCoords, buscarDireccion } from '../geo.js';

// Leaflet desde CDN (patrón signature_pad): inyecta CSS+JS una sola vez.
let _leafletP;
function loadLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  if (_leafletP) return _leafletP;
  _leafletP = new Promise((resolve, reject) => {
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css';
    document.head.appendChild(css);
    const js = document.createElement('script');
    js.src = 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js';
    js.onload = () => resolve(window.L);
    js.onerror = () => reject(new Error('No se pudo cargar el mapa.'));
    document.head.appendChild(js);
  });
  return _leafletP;
}

export async function init(panel) {
  panel.innerHTML = `
    <div class="panel-header">
      <h2>${t('Plazas')}</h2>
      <div class="panel-header__actions">
        <button class="abtn abtn--primary" id="btn-nueva-plaza" data-rh-only>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          ${t('Nueva Plaza')}
        </button>
      </div>
    </div>
    <div class="ad-card">
      <div id="tbl-plazas-wrap"></div>
    </div>`;

  document.getElementById('btn-nueva-plaza')?.addEventListener('click', () => openPlazaForm());
  await loadPlazas();
}

async function loadPlazas() {
  const wrap = document.getElementById('tbl-plazas-wrap');
  loading(wrap);
  try {
    const plazas = await api.getPlazas();
    renderTable(
      wrap,
      [
        { key: 'nombre',       label: 'Nombre' },
        { key: 'ciudad',       label: 'Ciudad' },
        { key: 'latitud',      label: 'Latitud',  render: r => `<span class="td-mono">${r.latitud.toFixed(6)}</span>` },
        { key: 'longitud',     label: 'Longitud', render: r => `<span class="td-mono">${r.longitud.toFixed(6)}</span>` },
        { key: 'radio_metros', label: 'Radio',    render: r => `${r.radio_metros} m` },
        { key: 'activo',       label: 'Estado',   render: r => r.activo
            ? `<span class="abadge abadge--green">${t('Activa')}</span>`
            : `<span class="abadge abadge--gray">${t('Inactiva')}</span>` },
        { key: 'id', label: 'Mapa', render: r =>
          `<a href="https://www.google.com/maps?q=${r.latitud},${r.longitud}" target="_blank" rel="noopener" style="font-size:.8rem">${t('Ver mapa')}</a>` }
      ],
      plazas,
      (r) => `
        <button class="abtn abtn--ghost abtn--icon" title="${t('Editar')}" onclick="window._editPlaza(${r.id})">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        <button class="abtn abtn--danger abtn--icon" title="${t('Eliminar')}" onclick="window._deletePlaza(${r.id}, '${r.nombre.replace(/'/g, "\\'")}')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
        </button>`
    );

    // Expose handlers to window (simplest cross-module approach)
    window._editPlaza = async (id) => {
      const plaza = plazas.find(p => p.id === id);
      if (plaza) openPlazaForm(plaza);
    };
    window._deletePlaza = async (id, nombre) => {
      if (!await confirm(`${t('¿Eliminar plaza?')} "${nombre}" — ${t('Esta acción no se puede deshacer.')}`, { ok: 'Eliminar' })) return;
      try {
        await api.deletePlaza(id);
        showToast(`${t('Plaza eliminada')}: "${nombre}"`, 'ok');
        await loadPlazas();
      } catch (e) {
        showToast(e.message, 'error');
      }
    };
  } catch (e) {
    wrap.innerHTML = `<div class="ad-empty" style="color:#DC2626">${e.message}</div>`;
  }
}

function openPlazaForm(plaza = null) {
  const isEdit = !!plaza;
  openModal(
    isEdit ? `${t('Editar')}: ${plaza.nombre}` : 'Nueva Plaza',
    `<div class="plaza-edit">
      <div class="plaza-grid">
        <section class="plaza-col">
          <h4 class="plaza-col__title">${t('Información general')}</h4>
          <div class="form-row">
            <div class="form-group">
              <label for="pz-nombre">${t('Nombre de la Plaza')} *</label>
              <input id="pz-nombre" class="form-input" value="${plaza?.nombre ?? ''}" placeholder="Ej: Silao GTO">
            </div>
            <div class="form-group">
              <label for="pz-ciudad">${t('Ciudad')} *</label>
              <input id="pz-ciudad" class="form-input" value="${plaza?.ciudad ?? ''}" placeholder="Ej: Silao, Guanajuato">
            </div>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label for="pz-responsable">${t('Responsable')}</label>
              <input id="pz-responsable" class="form-input" value="${plaza?.responsable ?? ''}" placeholder="${t('Nombre del encargado')}">
            </div>
            <div class="form-group">
              <label for="pz-telefono">${t('Teléfono')}</label>
              <input id="pz-telefono" class="form-input" type="tel" value="${plaza?.telefono ?? ''}" placeholder="477 123 4567">
            </div>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label for="pz-lat">${t('Latitud')} *</label>
              <input id="pz-lat" class="form-input" type="number" step="0.000001" value="${plaza?.latitud ?? ''}" placeholder="20.934567">
            </div>
            <div class="form-group">
              <label for="pz-lng">${t('Longitud')} *</label>
              <input id="pz-lng" class="form-input" type="number" step="0.000001" value="${plaza?.longitud ?? ''}" placeholder="-101.445678">
            </div>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label for="pz-radio">${t('Radio de tolerancia (metros)')} *</label>
              <input id="pz-radio" class="form-input" type="number" min="10" max="5000" value="${plaza?.radio_metros ?? 100}">
            </div>
            <div class="form-group">
              <label for="pz-notas">${t('Notas')}</label>
              <textarea id="pz-notas" class="form-input" rows="2" placeholder="${t('Observaciones, horarios especiales, etc.')}">${plaza?.notas ?? ''}</textarea>
            </div>
          </div>
        </section>
        <section class="plaza-col plaza-col--map">
          <div class="form-group">
            <label for="pz-direccion">${t('Dirección (busca en el mapa)')}</label>
            <div class="plaza-search">
              <svg class="plaza-search__ico" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
              <input id="pz-direccion" class="form-input" value="${plaza?.direccion ?? ''}" placeholder="${t('Ej. Av. Paseo de la Reforma 123')}" autocomplete="off">
              <span id="pz-dir-spin" class="plaza-search__spin" hidden></span>
            </div>
          </div>
          <div id="pz-map" class="plaza-map"></div>
        </section>
      </div>
      <label class="plaza-activo">
        <input id="pz-activo" type="checkbox" ${plaza?.activo !== false ? 'checked' : ''}>
        ${t('Plaza activa')}
      </label>
      <p id="pz-error" class="error-inline" hidden></p>
    </div>`,
    async () => {
      const v = (id) => document.getElementById(id).value.trim();
      const nombre   = v('pz-nombre');
      const ciudad   = v('pz-ciudad');
      const latitud  = parseFloat(document.getElementById('pz-lat').value);
      const longitud = parseFloat(document.getElementById('pz-lng').value);
      const radio    = parseInt(document.getElementById('pz-radio').value);
      const activo   = document.getElementById('pz-activo').checked;
      const errEl    = document.getElementById('pz-error');

      if (!nombre || !ciudad || isNaN(latitud) || isNaN(longitud) || isNaN(radio)) {
        errEl.textContent = t('Completa todos los campos obligatorios.');
        errEl.hidden = false;
        return;
      }
      if (latitud < -90 || latitud > 90 || longitud < -180 || longitud > 180) {
        errEl.textContent = t('Coordenadas fuera de rango válido.');
        errEl.hidden = false;
        return;
      }

      errEl.hidden = true;
      const payload = {
        nombre, ciudad, latitud, longitud, radio_metros: radio, activo,
        direccion:   v('pz-direccion') || null,
        telefono:    v('pz-telefono')  || null,
        responsable: v('pz-responsable') || null,
        notas:       v('pz-notas')     || null
      };

      try {
        if (isEdit) await api.updatePlaza(plaza.id, payload);
        else        await api.createPlaza(payload);

        closeModal();
        showToast(isEdit ? 'Plaza actualizada.' : 'Plaza creada.', 'ok');
        await loadPlazas();
      } catch (e) {
        errEl.textContent = e.message;
        errEl.hidden = false;
      }
    }
  );

  initMapaPicker(plaza);
}

// Mapa Leaflet: pin arrastrable + círculo del radio, sincronizado con los
// inputs lat/lng/radio en ambos sentidos. Centro por defecto: México.
async function initMapaPicker(plaza) {
  const elLat = () => document.getElementById('pz-lat');
  const elLng = () => document.getElementById('pz-lng');
  let L;
  try { L = await loadLeaflet(); } catch (e) { showToast(e.message, 'error'); return; }
  if (!document.getElementById('pz-map')) return; // modal cerrado mientras cargaba

  const lat0 = plaza?.latitud ?? 23.6345;
  const lng0 = plaza?.longitud ?? -102.5528;
  const map = L.map('pz-map').setView([lat0, lng0], plaza ? 16 : 5);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap', maxZoom: 19
  }).addTo(map);

  const marker = L.marker([lat0, lng0], { draggable: true }).addTo(map);
  const circle = L.circle([lat0, lng0], {
    radius: plaza?.radio_metros ?? 100, color: '#2563eb', weight: 1, fillOpacity: 0.12
  }).addTo(map);
  setTimeout(() => map.invalidateSize(), 120); // el modal recién se mostró

  const elDir = () => document.getElementById('pz-direccion');
  const spin  = (on) => { const s = document.getElementById('pz-dir-spin'); if (s) s.hidden = !on; };

  // Mapa → dirección: al soltar el pin / hacer clic, geocodifica en reverso.
  const aDireccion = async (latlng) => {
    spin(true);
    const txt = await direccionDesdeCoords(latlng.lat, latlng.lng);
    spin(false);
    if (txt && elDir()) elDir().value = txt;
  };
  // Refleja coords sin geocodificar (para arrastres en vivo y teclado).
  const reflejar = (latlng) => { elLat().value = latlng.lat.toFixed(6); elLng().value = latlng.lng.toFixed(6); circle.setLatLng(latlng); };
  const set = (latlng) => { reflejar(latlng); aDireccion(latlng); };

  marker.on('drag',    (e) => reflejar(e.target.getLatLng()));
  marker.on('dragend', (e) => aDireccion(e.target.getLatLng()));
  map.on('click', (e) => { marker.setLatLng(e.latlng); set(e.latlng); });

  // Dirección → mapa: al pulsar Enter o salir del campo, busca y centra.
  const buscar = async () => {
    const q = elDir().value.trim();
    if (!q) return;
    spin(true);
    const r = await buscarDireccion(q);
    spin(false);
    if (!r) { showToast('No se encontró esa dirección.', 'warn'); return; }
    const ll = L.latLng(r.lat, r.lon);
    marker.setLatLng(ll); circle.setLatLng(ll); map.setView(ll, 16);
    elLat().value = r.lat.toFixed(6); elLng().value = r.lon.toFixed(6);
  };
  elDir().addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); buscar(); } });
  elDir().addEventListener('change', buscar);

  const fromInputs = () => {
    const la = parseFloat(elLat().value), ln = parseFloat(elLng().value);
    if (!isNaN(la) && !isNaN(ln)) { const ll = L.latLng(la, ln); marker.setLatLng(ll); map.panTo(ll); set(ll); }
  };
  elLat().addEventListener('change', fromInputs);
  elLng().addEventListener('change', fromInputs);
  document.getElementById('pz-radio').addEventListener('input', (e) => {
    const r = parseInt(e.target.value); if (!isNaN(r)) circle.setRadius(r);
  });
}
