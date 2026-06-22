// geo.js — coordenadas → dirección legible (reverse geocoding), cacheada.
//
// ponytail: usa el endpoint gratuito de Nominatim (OSM), sin API key. Es un
// servicio con límite de ~1 req/s, así que cacheamos por coordenada redondeada
// (en memoria + sessionStorage) y deduplicamos peticiones en vuelo. Como casi
// todos los registros comparten ubicación (el centro de trabajo), en la práctica
// se resuelve con 1-2 llamadas. Upgrade path: guardar la dirección al insertar el
// registro si el throttling de Nominatim llega a estorbar.

const cache = new Map(); // key "lat,lon" → Promise<string|null>

const key = (lat, lon) => `${lat.toFixed(4)},${lon.toFixed(4)}`;

export const mapsLink = (lat, lon) => `https://www.google.com/maps?q=${lat},${lon}`;

export function direccionDesdeCoords(lat, lon) {
  if (lat == null || lon == null) return Promise.resolve(null);
  const k = key(lat, lon);
  if (cache.has(k)) return cache.get(k);

  const p = (async () => {
    const guardada = sessionStorage.getItem('dir_' + k);
    if (guardada) return guardada;
    try {
      const r = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}&zoom=18&addressdetails=1`,
        { headers: { Accept: 'application/json' } }
      );
      if (!r.ok) return null;
      const d = await r.json();
      const a = d.address || {};
      const calle = [a.road, a.house_number].filter(Boolean).join(' ');
      const texto = [
        calle || a.neighbourhood || a.suburb,
        a.city || a.town || a.village || a.municipality || a.county,
        a.state,
      ].filter(Boolean).join(', ') || d.display_name || null;
      if (texto) sessionStorage.setItem('dir_' + k, texto);
      return texto;
    } catch {
      return null;
    }
  })();

  cache.set(k, p);
  return p;
}

// Dirección escrita → lista de coincidencias (forward geocoding, Nominatim).
// Devuelve hasta `limit` opciones para un autocompletado estilo Google Maps;
// quien llama hace el debounce (ver plazas.js) para respetar el ~1 req/s.
export async function buscarDirecciones(texto, limit = 5) {
  const q = (texto || '').trim();
  if (q.length < 3) return [];
  try {
    const r = await fetch(
      `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=${limit}&addressdetails=1&countrycodes=mx&q=${encodeURIComponent(q)}`,
      { headers: { Accept: 'application/json' } }
    );
    if (!r.ok) return [];
    const arr = await r.json();
    return arr.map((d) => ({ lat: parseFloat(d.lat), lon: parseFloat(d.lon), texto: d.display_name }));
  } catch {
    return [];
  }
}
