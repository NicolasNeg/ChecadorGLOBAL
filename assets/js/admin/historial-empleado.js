import * as api from './api.js';
import { esRetardo, resumen, diasCalendario } from './historial-calc.mjs';
import { openModal, closeModal, showToast, confirm, fmtFecha, loading, esc } from './utils.js';
import { combobox } from './combobox.js';
import { getPlazaScope } from './plaza-scope.js';
import { SUPABASE_URL } from '../config.js';

const TIPOS = ['falta', 'permiso', 'justificacion', 'vacaciones', 'festivo'];

const ESTADO = {
  presente:      { txt: 'Presente',          cls: 'green'  },
  falta:         { txt: 'Falta',             cls: 'red'    },
  justificacion: { txt: 'Falta justificada', cls: 'orange' },
  permiso:       { txt: 'Permiso',           cls: 'blue'   },
  vacaciones:    { txt: 'Vacaciones',        cls: 'blue'   },
  festivo:       { txt: 'Festivo',           cls: 'gray'   },
};

// 'SELECCIONAR' ('') = todos. El rol arranca en todos; el empleado es obligatorio.
const ROLES = [
  { value: '',           label: 'Seleccionar (todos)' },
  { value: 'empleado',   label: 'Empleado' },
  { value: 'supervisor', label: 'Supervisor' },
  { value: 'gerente',    label: 'Gerente' },
];

const DOW = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const horaCorta = (iso) => new Date(iso).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
const diaCorto  = (ymd) => new Date(ymd + 'T12:00:00').toLocaleDateString('es-MX', { day: '2-digit', month: 'short' });
const publicURL = (ruta) => ruta ? `${SUPABASE_URL}/storage/v1/object/public/${ruta}` : null;
const hoyISO = () => new Date().toISOString().slice(0, 10);
const haceDiasISO = (n) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
const initials = (n) => (n || '').trim().split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
const DEFECTO = '<div class="ad-empty">Selecciona un empleado y pulsa “Ver historial”.</div>';

let _preId = null;
export function preseleccionar(id) { _preId = id; }

let _empleados = [];
let _cbPlaza, _cbRol, _cbEmp;

export async function init(panel) {
  panel.classList.add('admin-panel--full'); // historial ocupa todo el ancho en PC
  const [empleados, plazas] = await Promise.all([
    api.getEmpleados().catch(() => []),
    api.getPlazas().catch(() => []),
  ]);
  _empleados = empleados;

  panel.innerHTML = `
    <div class="hist-head">
      <div class="hist-head__icon">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="M18.7 8l-5.1 5.2-2.8-2.7L7 14.3"/></svg>
      </div>
      <div>
        <h2 class="hist-head__title">Historial por empleado</h2>
        <p class="hist-head__sub">Asistencia, retardos e incidencias por persona y rango de fechas.</p>
      </div>
    </div>

    <div class="ad-card hist-filtros">
      <div class="hist-filtros__grid">
        <div class="ff"><label>Plaza</label><div id="hf-plaza"></div></div>
        <div class="ff"><label>Tipo de empleado</label><div id="hf-rol"></div></div>
        <div class="ff ff--emp"><label>Empleado <span class="ff__req">*</span></label><div id="hf-emp"></div></div>
        <div class="ff">
          <label>Fecha inicio</label>
          <div class="ff__date">
            <input id="hf-desde" type="date" class="form-input" value="${haceDiasISO(30)}" aria-label="Fecha inicio">
            <button type="button" class="abtn abtn--ghost ff__hoy" id="hf-hoy" title="Usar fecha de hoy">Hoy</button>
          </div>
        </div>
        <div class="ff"><label>Fecha final</label><input id="hf-hasta" type="date" class="form-input" value="${hoyISO()}" aria-label="Fecha final"></div>
      </div>
      <div class="hist-filtros__acts">
        <button class="abtn abtn--ghost" id="hf-reset">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.5 15a9 9 0 1 0 2.1-9.4L1 10"/></svg>
          Resetear
        </button>
        <button class="abtn abtn--primary" id="hf-ver">Ver historial</button>
      </div>
    </div>

    <div id="hist-resultado">${DEFECTO}</div>`;

  // ── Comboboxes ──────────────────────────────────────────────────────────
  const plazaOpts = [{ value: '', label: 'Seleccionar (todas)' }, ...plazas.map(p => ({ value: p.id, label: p.nombre }))];
  _cbPlaza = combobox({ placeholder: 'Todas las plazas', options: plazaOpts, value: getPlazaScope() ?? '', onChange: rebuildEmp });
  _cbRol   = combobox({ placeholder: 'Todos', options: ROLES, value: '', searchable: false, onChange: rebuildEmp });
  _cbEmp   = combobox({ placeholder: 'Selecciona empleado…', options: empOpts(), value: '' });
  panel.querySelector('#hf-plaza').appendChild(_cbPlaza.el);
  panel.querySelector('#hf-rol').appendChild(_cbRol.el);
  panel.querySelector('#hf-emp').appendChild(_cbEmp.el);

  function empOpts() {
    const plaza = parseInt(_cbPlaza?.getValue?.() ?? '') || null;
    const rol   = _cbRol?.getValue?.() ?? '';
    return _empleados
      .filter(e => (!plaza || e.plaza_id === plaza) && (!rol || e.rol === rol))
      .map(e => ({
        value: e.id, label: e.nombre,
        img: e.foto_url || null, ph: e.foto_url ? null : initials(e.nombre),
        sub: e.puesto || e.plazas?.nombre || '',
      }));
  }
  function rebuildEmp() { _cbEmp.setOptions(empOpts()); }

  // ── Atajos ──────────────────────────────────────────────────────────────
  panel.querySelector('#hf-hoy').onclick = () => { panel.querySelector('#hf-desde').value = hoyISO(); };
  panel.querySelector('#hf-reset').onclick = () => {
    _cbPlaza.setValue(getPlazaScope() ?? '');
    _cbRol.setValue('');
    rebuildEmp();
    _cbEmp.setValue('');
    panel.querySelector('#hf-desde').value = haceDiasISO(30);
    panel.querySelector('#hf-hasta').value = hoyISO();
    panel.querySelector('#hist-resultado').innerHTML = DEFECTO;
  };
  panel.querySelector('#hf-ver').onclick = () => {
    const id = parseInt(_cbEmp.getValue());
    if (!id) { showToast('Selecciona un empleado.', 'error'); return; }
    mostrar(panel, id, rangoDe(panel));
  };

  if (_preId) {
    _cbEmp.setValue(String(_preId));
    mostrar(panel, _preId, rangoDe(panel));
    _preId = null;
  }
}

function rangoDe(panel) {
  return {
    desde: panel.querySelector('#hf-desde').value || haceDiasISO(30),
    hasta: panel.querySelector('#hf-hasta').value || hoyISO(),
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

function render(wrap, idEmpleado, emp, turno, registros, incidencias, rango, panel) {
  const r = resumen(registros, turno, incidencias);
  const sinTurno = !turno;

  const foto = emp?.foto_url
    ? `<img class="hist-subj__av" src="${esc(emp.foto_url)}" alt="">`
    : `<span class="hist-subj__av hist-subj__av--ph">${initials(emp?.nombre)}</span>`;
  const meta = [emp?.puesto, emp?.plazas?.nombre].filter(Boolean).join(' · ');
  const subject = `
    <div class="hist-subj">
      ${foto}
      <div class="hist-subj__info">
        <h3 class="hist-subj__name">${esc(emp?.nombre ?? 'Empleado')}</h3>
        ${meta ? `<span class="hist-subj__meta">${esc(meta)}</span>` : ''}
      </div>
      <span class="hist-subj__range">${diaCorto(rango.desde)} – ${diaCorto(rango.hasta)}</span>
      <button id="hist-nueva-inc" class="abtn abtn--primary">+ Incidencia</button>
    </div>`;

  const cards = `
    <div class="stat-grid hist-stats">
      <div class="stat-card stat-card--blue"><div class="stat-card__label">Checadas</div><div class="stat-card__value">${r.totalChecadas}</div></div>
      <div class="stat-card stat-card--red"><div class="stat-card__label">Retardos</div><div class="stat-card__value">${sinTurno ? '–' : r.retardos}</div></div>
      <div class="stat-card stat-card--green"><div class="stat-card__label">Horas trabajadas</div><div class="stat-card__value">${r.horasTotales}</div></div>
      <div class="stat-card stat-card--orange"><div class="stat-card__label">Incidencias</div><div class="stat-card__value">${r.incidencias}</div></div>
    </div>`;

  const avisoTurno = sinTurno
    ? `<p class="td-muted" style="margin-bottom:12px">Sin turno asignado — no se evalúan retardos.</p>` : '';

  const thumbs = (reg) => {
    if (!reg) return '';
    const f = publicURL(reg.ruta_foto), s = publicURL(reg.ruta_firma);
    return `${f ? `<img src="${f}" alt="Foto de checada" class="hist-thumb" data-full="${f}">` : ''}` +
           `${s ? `<img src="${s}" alt="Firma de checada" class="hist-thumb hist-thumb--firma" data-full="${s}">` : ''}`;
  };
  const punto = (reg, lbl, extra = '') => reg
    ? `<div class="cordon__pt">
        <span class="cordon__dot cordon__dot--${lbl === 'Entrada' ? 'in' : 'out'}"></span>
        <span class="cordon__t">${horaCorta(reg.hora)}</span>
        <span class="cordon__lbl">${lbl}${extra}</span>
        ${reg.geocerca_valida === false ? '<span class="abadge abadge--red">Fuera</span>' : ''}
      </div>`
    : `<div class="cordon__pt cordon__pt--miss">
        <span class="cordon__dot cordon__dot--miss"></span>
        <span class="cordon__lbl">Sin ${lbl.toLowerCase()}</span>
      </div>`;
  const diaPresente = (d) => {
    const tarde = d.entrada && esRetardo(d.entrada, turno);
    return `<div class="cordon">
        ${punto(d.entrada, 'Entrada', tarde ? ' <span class="abadge abadge--red">Retardo</span>' : '')}
        <div class="cordon__line">${d.horas != null ? `<span class="cordon__dur">${d.horas} h</span>` : ''}</div>
        ${punto(d.salida, 'Salida')}
      </div>
      <div class="cal-thumbs">${thumbs(d.entrada)}${thumbs(d.salida)}</div>`;
  };

  const dias = diasCalendario(registros, incidencias, rango).filter((d) => d.estado !== 'futuro');
  const calHtml = dias.length ? dias.map((d) => {
    const e = ESTADO[d.estado] ?? ESTADO.falta;
    return `<div class="cal-day cal-day--${d.estado}">
      <div class="cal-day__date">
        <span class="cal-day__dow">${DOW[d.dow]}</span>
        <span class="cal-day__num">${diaCorto(d.fecha)}</span>
      </div>
      <div class="cal-day__body">
        <span class="abadge abadge--${e.cls}">${e.txt}</span>
        ${d.estado === 'presente' ? diaPresente(d) : (d.inc?.nota ? `<span class="cal-day__nota">${esc(d.inc.nota)}</span>` : '')}
      </div>
    </div>`;
  }).join('') : `<div class="ad-empty">Sin días en este rango.</div>`;

  const filasInc = incidencias.length ? incidencias.map((i) => `
    <tr>
      <td data-label="Fecha">${i.fecha}</td>
      <td data-label="Tipo"><span class="abadge abadge--gray">${esc(i.tipo)}</span></td>
      <td data-label="Nota">${i.nota ? esc(i.nota) : '–'}</td>
      <td data-label="Acciones"><div class="actions">
        <button class="abtn abtn--danger abtn--icon" title="Eliminar" data-del-inc="${i.id}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/></svg>
        </button>
      </div></td>
    </tr>`).join('') : `<tr><td colspan="4"><div class="ad-empty">Sin incidencias.</div></td></tr>`;

  wrap.innerHTML = `
    ${subject}
    ${cards}${avisoTurno}
    <div class="ad-card cal-card hist-cal">${calHtml}</div>
    <div class="panel-header" style="border:0;padding:0;margin-bottom:4px"><h4 style="margin:0;font-size:.95rem">Incidencias</h4></div>
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
      if (!await confirm('¿Eliminar esta incidencia?', { ok: 'Eliminar' })) return;
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
