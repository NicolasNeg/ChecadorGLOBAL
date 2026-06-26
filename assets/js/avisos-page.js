import { requireSession } from './auth.js';
import { obtenerAvisos } from './api.js';
import { BASE } from './config.js';
import { t, applyI18n, mountLangToggle } from './i18n.js';

const sesion = requireSession();
if (!sesion) throw new Error('sin sesión');

document.getElementById('header-sub').textContent = sesion.nombre;
document.getElementById('btn-atras').addEventListener('click', () => { location.href = BASE + '/'; });

mountLangToggle(document.querySelector('.app-header'));
applyI18n(document);

const cont = document.getElementById('contenedor-avisos');
cont.innerHTML = `<p class="cargando">${t('Cargando…')}</p>`;

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const avisos = await obtenerAvisos(sesion.plazaId);

// Marca todos como vistos (apaga el badge del menú la próxima vez).
try { localStorage.setItem('eqs_avisos_vistos', JSON.stringify(avisos.map((a) => a.id))); } catch {}

if (!Array.isArray(avisos) || !avisos.length) {
  cont.innerHTML = `<p class="historial-vacio">${t('No hay avisos por ahora.')}</p>`;
} else {
  cont.innerHTML = `<div class="avisos-grid">${avisos.map((a) => `
    <button type="button" class="aviso-card" data-img="${esc(a.imagen_url)}">
      <img class="aviso-card__img" src="${esc(a.imagen_url)}" alt="${esc(a.titulo)}" loading="lazy">
      <span class="aviso-card__titulo">${esc(a.titulo)}</span>
    </button>`).join('')}</div>`;

  cont.querySelectorAll('.aviso-card').forEach((b) =>
    b.addEventListener('click', () => abrirLightbox(b.dataset.img, b.querySelector('img').alt)));
}

// Lightbox (reusa las clases de historial.css).
function abrirLightbox(src, alt) {
  if (!src) return;
  const lb = document.createElement('div');
  lb.className = 'lightbox';
  lb.innerHTML = `<div class="lightbox__inner">
      <button class="lightbox__cerrar" aria-label="${t('Cerrar')}">✕</button>
      <img src="${esc(src)}" alt="${esc(alt)}">
    </div>`;
  const cerrar = () => lb.remove();
  lb.addEventListener('click', (e) => { if (e.target === lb || e.target.closest('.lightbox__cerrar')) cerrar(); });
  document.addEventListener('keydown', function onEsc(e) {
    if (e.key === 'Escape') { cerrar(); document.removeEventListener('keydown', onEsc); }
  });
  document.body.appendChild(lb);
}

window.addEventListener('langchange', () => applyI18n(document));
