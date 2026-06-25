// Wrapper de Leaflet para el mapa de plazas del Centro de Operaciones.
// Carga perezosa desde CDN (ESM), igual patrón que SignaturePad/Human.
// Usa divIcons (no los iconos PNG por defecto de Leaflet → sin imágenes rotas).
let L = null;

export async function cargarMapa() {
  if (L) return L;
  // CSS de Leaflet (una sola vez)
  if (!document.getElementById('leaflet-css')) {
    const link = document.createElement('link');
    link.id = 'leaflet-css';
    link.rel = 'stylesheet';
    link.href = 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css';
    document.head.appendChild(link);
  }
  const mod = await import('https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet-src.esm.js');
  L = mod.default ?? mod;
  return L;
}

function iconoPlaza(count, estado) {
  return L.divIcon({
    className: '',
    html: `<span class="mapa-pin mapa-pin--${estado}"><b>${count}</b></span>`,
    iconSize: [34, 34],
    iconAnchor: [17, 17],
  });
}

// Crea el mapa y un marcador por plaza con coordenadas. Devuelve un handle.
// onSelect(plazaId) se invoca al hacer clic en una plaza.
export function montarMapa(contenedor, plazas, onSelect) {
  const conCoords = plazas.filter(p => p.latitud != null && p.longitud != null);
  const map = L.map(contenedor, { zoomControl: true, attributionControl: true });
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap',
  }).addTo(map);

  const markers = new Map();
  for (const p of conCoords) {
    const mk = L.marker([p.latitud, p.longitud], { icon: iconoPlaza(0, 'vacia'), title: p.nombre })
      .addTo(map)
      .on('click', () => seleccionarPlaza(handle, p.id));
    markers.set(p.id, mk);
  }

  if (conCoords.length) {
    const bounds = L.latLngBounds(conCoords.map(p => [p.latitud, p.longitud]));
    map.fitBounds(bounds.pad(0.25), { maxZoom: 15 });
  } else {
    map.setView([23.6345, -102.5528], 5); // México centro (sin plazas con coords)
  }

  const handle = { map, markers, circle: null, plazas: conCoords, onSelect };
  // Leaflet necesita recalcular tamaño cuando el contenedor se hace visible.
  setTimeout(() => map.invalidateSize(), 60);
  return handle;
}

// Actualiza insignias/colores. conteos: Map<plazaId, {count, incidencia}>
export function pintarConteos(handle, conteos) {
  if (!handle) return;
  for (const [id, mk] of handle.markers) {
    const c = conteos.get(id) || { count: 0, incidencia: false };
    const estado = c.incidencia ? 'alerta' : c.count > 0 ? 'activa' : 'vacia';
    mk.setIcon(iconoPlaza(c.count, estado));
  }
}

// Centra una plaza y dibuja su geocerca; notifica vía onSelect.
export function seleccionarPlaza(handle, plazaId) {
  if (!handle) return;
  const p = handle.plazas.find(x => x.id === plazaId);
  if (!p) return;
  handle.map.flyTo([p.latitud, p.longitud], 16, { duration: .6 });
  if (handle.circle) handle.circle.remove();
  handle.circle = L.circle([p.latitud, p.longitud], {
    radius: p.radio_metros ?? 100,
    color: '#2563EB', weight: 2, fillColor: '#3B82F6', fillOpacity: .12,
  }).addTo(handle.map);
  handle.onSelect?.(plazaId);
}

export function destruirMapa(handle) {
  if (handle?.map) handle.map.remove();
}
