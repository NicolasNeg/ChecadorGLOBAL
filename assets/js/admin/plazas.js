import * as api from './api.js';
import { renderTable, loading, showToast, openModal, closeModal, confirm, esc } from './utils.js';
import { t } from '../i18n.js';
import { direccionDesdeCoords, buscarDirecciones } from '../geo.js';

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
    <div class="panel-header panel-header--hero">
      <h2>${t('Plazas')}</h2>
      <div class="panel-header__actions">
        <button class="abtn abtn--success" id="btn-nueva-plaza" data-rh-only>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          ${t('Nueva Plaza')}
        </button>
      </div>
    </div>
    <div class="ad-card">
      <div id="tbl-plazas-wrap" class="plazas-tbl"></div>
    </div>`;

  document.getElementById('btn-nueva-plaza')?.addEventListener('click', () => openPlazaForm());
  await loadPlazas();
}

async function loadPlazas() {
  const wrap = document.getElementById('tbl-plazas-wrap');
  loading(wrap);
  try {
    const [plazas, series] = await Promise.all([api.getPlazas(), serie7d()]);
    renderTable(
      wrap,
      [
        { key: 'nombre',   label: 'Nombre' },
        { key: 'ciudad',   label: 'Ciudad' },
        { key: 'metricas', label: 'Métricas', render: r => sparkline(series.get(r.id)) },
        { key: 'activo',   label: 'Estado',   render: r => r.activo
            ? `<span class="abadge abadge--green">${t('Activa')}</span>`
            : `<span class="abadge abadge--gray">${t('Inactiva')}</span>` },
      ],
      plazas,
      (r) => `
        <a class="plaza-act" href="https://www.google.com/maps?q=${r.latitud},${r.longitud}" target="_blank" rel="noopener" title="${t('Ver mapa')}">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
          <span>${t('Ver mapa')}</span>
        </a>
        <button class="plaza-act" title="${t('Editar')}" onclick="window._editPlaza(${r.id})">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          <span>${t('Editar')}</span>
        </button>
        <button class="plaza-act plaza-act--danger" title="${t('Eliminar')}" onclick="window._deletePlaza(${r.id}, '${r.nombre.replace(/'/g, "\\'")}')">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
          <span>${t('Eliminar')}</span>
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

// Checadas por plaza en los últimos 7 días → [c0..c6] por plaza_id.
// ponytail: agrega en cliente uniendo registros con empleados.plaza_id (2
// queries). Upgrade path: una RPC `checadas_por_plaza_7d` si crece el volumen.
async function serie7d() {
  const map = new Map(); // plaza_id → number[7]
  try {
    const hoy = new Date();
    const desde = new Date(hoy); desde.setHours(0, 0, 0, 0); desde.setDate(desde.getDate() - 6);
    const iso = (d) => d.toISOString().slice(0, 10);
    const [emps, regs] = await Promise.all([
      api.getEmpleados(),
      api.getRegistrosRango({ desde: iso(desde), hasta: iso(hoy) }),
    ]);
    const plazaDe = new Map(emps.map((e) => [e.id, e.plaza_id]));
    for (const r of regs) {
      const pid = plazaDe.get(r.id_empleado);
      if (pid == null) continue;
      const i = Math.floor((new Date(r.hora) - desde) / 86400000);
      if (i < 0 || i > 6) continue;
      let arr = map.get(pid); if (!arr) { arr = [0, 0, 0, 0, 0, 0, 0]; map.set(pid, arr); }
      arr[i]++;
    }
  } catch { /* sin permiso/datos: sparkline vacío */ }
  return map;
}

// Mini-gráfico SVG (línea + área) de un arreglo de conteos.
function sparkline(vals) {
  const v = vals ?? [0, 0, 0, 0, 0, 0, 0];
  const total = v.reduce((a, b) => a + b, 0);
  if (!total) return `<span class="spark spark--empty" title="${t('Sin checadas (7 días)')}">—</span>`;
  const W = 76, H = 26, pad = 3, max = Math.max(...v);
  const xy = v.map((n, i) => [pad + (i * (W - 2 * pad)) / (v.length - 1), H - pad - (n / max) * (H - 2 * pad)]);
  const line = xy.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const area = `${pad},${H - pad} ${line} ${W - pad},${H - pad}`;
  const label = `${total} ${t('checadas (7 días)')}`;
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" role="img" aria-label="${label}"><title>${label}</title>` +
    `<polygon class="spark__fill" points="${area}"/><polyline class="spark__line" points="${line}"/></svg>`;
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

  // Dirección → mapa: autocompletado estilo Google Maps. El usuario teclea,
  // mostramos hasta 5 coincidencias en un desplegable y él elige cuál.
  const box = elDir().closest('.plaza-search');
  let dd = null, deb = null, sugs = [], idx = -1;
  const cerrar = () => { dd?.remove(); dd = null; idx = -1; };
  const elegir = (s) => {
    const ll = L.latLng(s.lat, s.lon);
    marker.setLatLng(ll); circle.setLatLng(ll); map.setView(ll, 16);
    elLat().value = s.lat.toFixed(6); elLng().value = s.lon.toFixed(6);
    elDir().value = s.texto;
    cerrar();
  };
  const pintar = () => {
    cerrar();
    if (!sugs.length) return;
    dd = document.createElement('ul');
    dd.className = 'geo-suggest';
    dd.innerHTML = sugs.map((s, i) => `<li class="geo-suggest__item${i === idx ? ' is-active' : ''}" data-i="${i}">${esc(s.texto)}</li>`).join('');
    // mousedown (no click): se dispara antes del blur del input.
    dd.addEventListener('mousedown', (e) => {
      const li = e.target.closest('[data-i]');
      if (li) { e.preventDefault(); elegir(sugs[+li.dataset.i]); }
    });
    box.appendChild(dd);
  };
  elDir().addEventListener('input', () => {
    clearTimeout(deb);
    const q = elDir().value.trim();
    if (q.length < 3) { sugs = []; cerrar(); return; }
    deb = setTimeout(async () => {           // debounce: respeta el ~1 req/s de Nominatim
      spin(true); sugs = await buscarDirecciones(q); spin(false);
      idx = -1; pintar();
    }, 400);
  });
  elDir().addEventListener('keydown', (e) => {
    if (!dd) { if (e.key === 'Enter') e.preventDefault(); return; }
    if (e.key === 'ArrowDown')      { e.preventDefault(); idx = Math.min(idx + 1, sugs.length - 1); pintar(); }
    else if (e.key === 'ArrowUp')   { e.preventDefault(); idx = Math.max(idx - 1, 0); pintar(); }
    else if (e.key === 'Enter')     { e.preventDefault(); elegir(sugs[idx >= 0 ? idx : 0]); }
    else if (e.key === 'Escape')    cerrar();
  });
  elDir().addEventListener('blur', () => setTimeout(cerrar, 150));

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
