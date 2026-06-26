// Aplica la marca del producto (nombre + logo) a cualquier página que la marque.
// Uso en HTML:
//   <span data-marca></span>                  → nombre de la empresa
//   <img data-marca-logo>                      → logo (src + alt)
//   <title data-marca-titulo="Historial">      → "Historial · <MARCA>" (o solo MARCA si vacío)
// Cambiar MARCA / MARCA_LOGO en config.js actualiza todo en una línea.
import { MARCA, MARCA_LOGO } from './config.js';

for (const el of document.querySelectorAll('[data-marca]')) el.textContent = MARCA;
for (const img of document.querySelectorAll('img[data-marca-logo]')) { img.src = MARCA_LOGO; img.alt = MARCA; }
const tEl = document.querySelector('title[data-marca-titulo]');
if (tEl) { const base = tEl.dataset.marcaTitulo; document.title = base ? `${base} · ${MARCA}` : MARCA; }
