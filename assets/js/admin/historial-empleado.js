import * as api from './api.js';
import { horasPorDia, esRetardo, resumen } from './historial-calc.mjs';
import { openModal, closeModal, showToast, confirm, fmtFecha, loading } from './utils.js';
import { SUPABASE_URL } from '../config.js';

const TIPOS = ['falta', 'permiso', 'justificacion', 'vacaciones'];
const publicURL = (ruta) => ruta ? `${SUPABASE_URL}/storage/v1/object/public/${ruta}` : null;
const hoyISO = () => new Date().toISOString().slice(0, 10);
const haceDiasISO = (n) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

let _preId = null;
export function preseleccionar(id) { _preId = id; }

let _empleados = [];

export async function init(panel) {
  _empleados = await api.getEmpleados().catch(() => []);
  const opts = _empleados.map((e) => `<option value="${e.id}">${e.nombre}</option>`).join('');

  panel.innerHTML = `
    <div class="panel-header">
      <h2>Historial por empleado</h2>
      <div class="panel-header__actions" style="flex-wrap:wrap;gap:8px">
        <select id="hist-emp" class="form-input" style="height:36px;min-width:200px" aria-label="Empleado">
          <option value="">– Selecciona empleado –</option>${opts}
        </select>
        <input id="hist-desde" type="date" class="form-input" style="height:36px" value="${haceDiasISO(30)}" aria-label="Desde">
        <input id="hist-hasta" type="date" class="form-input" style="height:36px" value="${hoyISO()}" aria-label="Hasta">
        <button id="hist-ver" class="abtn abtn--primary">Ver</button>
      </div>
    </div>
    <div id="hist-resultado"></div>`;

  const verBtn = panel.querySelector('#hist-ver');
  const empSel = panel.querySelector('#hist-emp');
  verBtn.addEventListener('click', () => {
    const id = parseInt(empSel.value);
    if (!id) { showToast('Selecciona un empleado.', 'error'); return; }
    mostrar(panel, id, rangoDe(panel));
  });

  if (_preId) {
    empSel.value = String(_preId);
    mostrar(panel, _preId, rangoDe(panel));
    _preId = null;
  }
}

function rangoDe(panel) {
  return {
    desde: panel.querySelector('#hist-desde').value || haceDiasISO(30),
    hasta: panel.querySelector('#hist-hasta').value || hoyISO(),
  };
}

export async function mostrar(panel, idEmpleado, rango) {
  const wrap = panel.querySelector('#hist-resultado');
  if (!wrap) return;
  loading(wrap);
  try {
    const [emp, registros, incidencias] = await Promise.all([
      api.getEmpleado(idEmpleado),
      api.getRegistrosEmpleado(idEmpleado, rango),
      api.getIncidencias(idEmpleado, rango),
    ]);
    const turno = emp?.turnos ?? null;
    render(wrap, idEmpleado, emp, turno, registros, incidencias, rango, panel);
  } catch (e) {
    wrap.innerHTML = `<div class="ad-empty" style="color:#DC2626">${e.message}</div>`;
  }
}

function badgeTipo(t) {
  return t === 'entrada'
    ? '<span class="abadge abadge--green">Entrada</span>'
    : '<span class="abadge abadge--orange">Salida</span>';
}

function render(wrap, idEmpleado, emp, turno, registros, incidencias, rango, panel) {
  const r = resumen(registros, turno, incidencias);
  const sinTurno = !turno;

  const cards = `
    <div class="stat-grid" style="margin-bottom:16px">
      <div class="stat-card"><div class="stat-card__label">Checadas</div><div class="stat-card__value">${r.totalChecadas}</div></div>
      <div class="stat-card"><div class="stat-card__label">Retardos</div><div class="stat-card__value" style="color:#DC2626">${sinTurno ? '–' : r.retardos}</div></div>
      <div class="stat-card"><div class="stat-card__label">Horas trabajadas</div><div class="stat-card__value" style="color:#16A34A">${r.horasTotales}</div></div>
      <div class="stat-card"><div class="stat-card__label">Incidencias</div><div class="stat-card__value" style="color:#0EA5E9">${r.incidencias}</div></div>
    </div>`;

  const avisoTurno = sinTurno
    ? `<p class="td-muted" style="margin-bottom:12px">Sin turno asignado — no se evalúan retardos.</p>` : '';

  const filasReg = registros.length ? registros.map((reg) => {
    const tarde = esRetardo(reg, turno);
    const foto = publicURL(reg.ruta_foto);
    const firma = publicURL(reg.ruta_firma);
    return `<tr>
      <td>${fmtFecha(reg.hora)}</td>
      <td>${badgeTipo(reg.tipo)}${tarde ? ' <span class="abadge abadge--red">Retardo</span>' : ''}</td>
      <td>${reg.geocerca_valida === false ? '<span class="abadge abadge--red">Fuera de geocerca</span>' : '<span class="abadge abadge--green">OK</span>'}</td>
      <td>${foto ? `<img src="${foto}" alt="Foto de checada" class="hist-thumb" data-full="${foto}">` : '–'}</td>
      <td>${firma ? `<img src="${firma}" alt="Firma de checada" class="hist-thumb hist-thumb--firma" data-full="${firma}">` : '–'}</td>
    </tr>`;
  }).join('') : `<tr><td colspan="5"><div class="ad-empty">Sin checadas en este rango.</div></td></tr>`;

  const filasInc = incidencias.length ? incidencias.map((i) => `
    <tr>
      <td>${i.fecha}</td>
      <td><span class="abadge abadge--gray">${i.tipo}</span></td>
      <td>${i.nota ?? '–'}</td>
      <td><div class="actions">
        <button class="abtn abtn--danger abtn--icon" title="Eliminar" data-del-inc="${i.id}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/></svg>
        </button>
      </div></td>
    </tr>`).join('') : `<tr><td colspan="4"><div class="ad-empty">Sin incidencias.</div></td></tr>`;

  wrap.innerHTML = `
    <div class="panel-header" style="border:0;padding-top:0">
      <h3 style="margin:0">${emp?.nombre ?? 'Empleado'} <span class="td-muted">· ${rango.desde} a ${rango.hasta}</span></h3>
      <button id="hist-nueva-inc" class="abtn abtn--primary">+ Incidencia</button>
    </div>
    ${cards}${avisoTurno}
    <div class="ad-card" style="margin-bottom:16px">
      <div class="table-scroll"><table class="data-table">
        <thead><tr><th>Fecha y hora</th><th>Tipo</th><th>Geocerca</th><th>Foto</th><th>Firma</th></tr></thead>
        <tbody>${filasReg}</tbody>
      </table></div>
    </div>
    <h4 style="margin:0 0 8px">Incidencias</h4>
    <div class="ad-card">
      <div class="table-scroll"><table class="data-table">
        <thead><tr><th>Fecha</th><th>Tipo</th><th>Nota</th><th style="width:80px">Acciones</th></tr></thead>
        <tbody>${filasInc}</tbody>
      </table></div>
    </div>
    <div id="hist-lightbox" class="hist-lightbox" hidden><img alt="Vista ampliada"></div>`;

  // Lightbox
  const lb = wrap.querySelector('#hist-lightbox');
  const lbImg = lb.querySelector('img');
  wrap.querySelectorAll('.hist-thumb').forEach((img) => {
    img.addEventListener('click', () => { lbImg.src = img.dataset.full; lb.hidden = false; });
  });
  lb.addEventListener('click', () => { lb.hidden = true; lbImg.src = ''; });

  // Nueva incidencia
  wrap.querySelector('#hist-nueva-inc').addEventListener('click', () => abrirFormInc(idEmpleado, rango, panel));

  // Eliminar incidencia
  wrap.querySelectorAll('[data-del-inc]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('¿Eliminar esta incidencia?')) return;
      try {
        await api.deleteIncidencia(parseInt(btn.dataset.delInc));
        showToast('Incidencia eliminada.', 'ok');
        mostrar(panel, idEmpleado, rango);
      } catch (e) { showToast(e.message, 'error'); }
    });
  });
}

function abrirFormInc(idEmpleado, rango, panel) {
  const tipoOpts = TIPOS.map((t) => `<option value="${t}">${t}</option>`).join('');
  openModal('Nueva incidencia',
    `<div class="form-group">
      <label for="inc-fecha">Fecha *</label>
      <input id="inc-fecha" class="form-input" type="date" value="${hoyISO()}">
    </div>
    <div class="form-group">
      <label for="inc-tipo">Tipo *</label>
      <select id="inc-tipo" class="form-input">${tipoOpts}</select>
    </div>
    <div class="form-group">
      <label for="inc-nota">Nota</label>
      <input id="inc-nota" class="form-input" placeholder="Opcional">
    </div>
    <p id="inc-error" class="error-inline" hidden></p>`,
    async () => {
      const fecha = document.getElementById('inc-fecha').value;
      const tipo  = document.getElementById('inc-tipo').value;
      const nota  = document.getElementById('inc-nota').value.trim() || null;
      const errEl = document.getElementById('inc-error');
      if (!fecha || !tipo) { errEl.textContent = 'Fecha y tipo son obligatorios.'; errEl.hidden = false; return; }
      try {
        await api.createIncidencia({ id_empleado: idEmpleado, fecha, tipo, nota });
        closeModal();
        showToast('Incidencia registrada.', 'ok');
        mostrar(panel, idEmpleado, rango);
      } catch (e) { errEl.textContent = e.message; errEl.hidden = false; }
    },
    'Guardar'
  );
}
