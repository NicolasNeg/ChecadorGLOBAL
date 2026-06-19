import { requireSession } from './auth.js';
import { setIdEmpleado, obtenerHistorial } from './api.js';
import { renderHistorial } from './historial.js';
import { BASE } from './config.js';

const sesion = requireSession();
if (!sesion) throw new Error('sin sesión');

setIdEmpleado(sesion.idEmpleado);
document.getElementById('header-sub').textContent = sesion.nombre;
document.getElementById('btn-atras').addEventListener('click', () => { location.href = BASE + '/'; });

const contenedor = document.getElementById('contenedor-historial');
contenedor.innerHTML = '<p class="cargando">Cargando…</p>';

const registros = await obtenerHistorial().catch(() => null);

if (Array.isArray(registros)) {
  renderHistorial(contenedor, registros);
} else {
  contenedor.innerHTML = '<p class="error-txt" style="text-align:center;padding:32px 16px">Error al cargar el historial.</p>';
}
