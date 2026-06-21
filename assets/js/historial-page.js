import { requireSession } from './auth.js';
import { setIdEmpleado, obtenerHistorial } from './api.js';
import { renderHistorial } from './historial.js';
import { BASE } from './config.js';
import { t, applyI18n, mountLangToggle } from './i18n.js';

const sesion = requireSession();
if (!sesion) throw new Error('sin sesión');

setIdEmpleado(sesion.idEmpleado);
document.getElementById('header-sub').textContent = sesion.nombre;
document.getElementById('btn-atras').addEventListener('click', () => { location.href = BASE + '/'; });

mountLangToggle(document.querySelector('.app-header'));
applyI18n(document);

const contenedor = document.getElementById('contenedor-historial');
contenedor.innerHTML = `<p class="cargando">${t('Cargando…')}</p>`;

const registros = await obtenerHistorial().catch(() => null);

function pintar() {
  if (Array.isArray(registros)) {
    renderHistorial(contenedor, registros);
  } else {
    contenedor.innerHTML = `<p class="error-txt" style="text-align:center;padding:32px 16px">${t('Error al cargar el historial.')}</p>`;
  }
}
pintar();
window.addEventListener('langchange', () => { applyI18n(document); pintar(); });
