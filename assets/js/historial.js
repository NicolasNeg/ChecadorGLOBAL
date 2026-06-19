// Renderiza el historial como lista de tarjetas (mobile-first) + lightbox de
// foto/firma, con la ubicación resuelta a dirección legible (geo.js).

import { direccionDesdeCoords, mapsLink } from './geo.js';

const pinSvg = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>`;

function fmt(iso) {
  const d = new Date(iso);
  return {
    fecha: d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' }),
    hora:  d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }),
  };
}

export function renderHistorial(contenedorEl, registros) {
  if (!registros.length) {
    contenedorEl.innerHTML = '<p class="historial-vacio">Sin registros aún.</p>';
    return;
  }

  const cards = registros.map((r, i) => {
    const { fecha, hora } = fmt(r.hora);
    const tieneCoords = r.latitud != null && r.longitud != null;

    const ubic = tieneCoords
      ? `<a class="hist-ubic" id="ubic-${i}" href="${mapsLink(r.latitud, r.longitud)}" target="_blank" rel="noopener">
           ${pinSvg}<span class="hist-ubic__txt">Cargando ubicación…</span>
         </a>`
      : `<span class="hist-ubic hist-ubic--none">${pinSvg}<span class="hist-ubic__txt">Ubicación no registrada</span></span>`;

    const medios = [];
    if (r.foto)  medios.push(`<button class="hist-medio" data-src="${r.foto}" data-tipo="foto"><img src="${r.foto}" alt="Foto del registro"><span>Foto</span></button>`);
    if (r.firma) medios.push(`<button class="hist-medio hist-medio--firma" data-src="${r.firma}" data-tipo="firma"><img src="${r.firma}" alt="Firma del registro"><span>Firma</span></button>`);
    const mediosHtml = medios.length ? `<div class="hist-medios">${medios.join('')}</div>` : '';

    return `<article class="hist-card">
      <div class="hist-card__top">
        <span class="badge badge--${r.tipo}">${r.tipo}</span>
        <span class="hist-card__fecha">${fecha} · ${hora}</span>
      </div>
      ${ubic}
      ${mediosHtml}
    </article>`;
  }).join('');

  contenedorEl.innerHTML = `<div class="hist-lista">${cards}</div>`;

  contenedorEl.querySelectorAll('.hist-medio').forEach((btn) => {
    btn.addEventListener('click', () => abrirLightbox(btn.dataset.src, btn.dataset.tipo === 'firma'));
  });

  // Direcciones: lazy + deduplicadas por coordenada (geo.js cachea).
  registros.forEach((r, i) => {
    if (r.latitud == null || r.longitud == null) return;
    const span = contenedorEl.querySelector(`#ubic-${i} .hist-ubic__txt`);
    if (!span) return;
    direccionDesdeCoords(r.latitud, r.longitud).then((dir) => {
      span.textContent = dir || `${r.latitud.toFixed(5)}, ${r.longitud.toFixed(5)}`;
    });
  });
}

function abrirLightbox(src, esFirma) {
  const overlay = document.createElement('div');
  overlay.className = 'lightbox';
  overlay.innerHTML = `<div class="lightbox__inner${esFirma ? ' lightbox__inner--firma' : ''}">
    <img src="${src}" alt="${esFirma ? 'Firma ampliada' : 'Foto ampliada'}">
    <button class="lightbox__cerrar" aria-label="Cerrar">✕</button>
  </div>`;
  document.body.appendChild(overlay);

  const cerrar = () => overlay.remove();
  overlay.querySelector('.lightbox__cerrar').addEventListener('click', cerrar);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) cerrar(); });
}
