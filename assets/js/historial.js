// Renderiza la tabla de historial y el lightbox de fotos.

function formatHora(iso) {
  return new Date(iso).toLocaleString('es-MX', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export function renderHistorial(contenedorEl, registros) {
  if (!registros.length) {
    contenedorEl.innerHTML = '<p class="historial-vacio">Sin registros aún.</p>';
    return;
  }

  const filas = registros.map((r) => {
    const mapLink = (r.latitud != null && r.longitud != null)
      ? `<a href="https://www.google.com/maps?q=${r.latitud},${r.longitud}" target="_blank" rel="noopener">Ver mapa</a>`
      : '—';

    const fotoCell = r.foto
      ? `<img class="hist-thumb" src="${r.foto}" alt="foto" data-src="${r.foto}">`
      : '—';

    const badge = `<span class="badge badge--${r.tipo}">${r.tipo}</span>`;

    return `<tr>
      <td>${formatHora(r.hora)}</td>
      <td>${badge}</td>
      <td>${mapLink}</td>
      <td>${fotoCell}</td>
    </tr>`;
  }).join('');

  contenedorEl.innerHTML = `
    <div class="tabla-scroll">
      <table class="hist-tabla">
        <thead><tr>
          <th>Fecha / Hora</th><th>Tipo</th><th>Ubicación</th><th>Foto</th>
        </tr></thead>
        <tbody>${filas}</tbody>
      </table>
    </div>`;

  // Lightbox
  contenedorEl.querySelectorAll('.hist-thumb').forEach((img) => {
    img.addEventListener('click', () => abrirLightbox(img.dataset.src));
  });
}

function abrirLightbox(src) {
  const overlay = document.createElement('div');
  overlay.className = 'lightbox';
  overlay.innerHTML = `<div class="lightbox__inner">
    <img src="${src}" alt="foto ampliada">
    <button class="lightbox__cerrar" aria-label="Cerrar">✕</button>
  </div>`;
  document.body.appendChild(overlay);

  const cerrar = () => overlay.remove();
  overlay.querySelector('.lightbox__cerrar').addEventListener('click', cerrar);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) cerrar(); });
}
