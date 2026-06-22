// Shared utilities for admin modules
import { t } from '../i18n.js';

// Escapa texto de la DB antes de interpolarlo en innerHTML (previene XSS almacenado).
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

export function fmtFecha(iso) {
  if (!iso) return '–';
  return new Date(iso).toLocaleString('es-MX', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}

export function fmtHora(time) {
  // "09:00:00" → "09:00"
  return time ? time.slice(0, 5) : '–';
}

export function fmtDistancia(m) {
  if (m == null) return '–';
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${m} m`;
}

export function loading(container) {
  container.innerHTML = `<div class="ad-loading"><div class="ad-spinner"></div> ${t('Cargando…')}</div>`;
}

export function empty(container, msg = 'Sin registros.') {
  container.innerHTML = `<div class="ad-empty">${t(msg)}</div>`;
}

// Generic table renderer
// cols: [{ key, label, render? }]
// rows: array of objects
// actions: (row) => HTML string
export function renderTable(container, cols, rows, actions) {
  if (!rows.length) { empty(container); return; }
  const ths = cols.map(c => `<th>${esc(t(c.label))}</th>`).join('');
  const trs = rows.map(row => {
    // data-label alimenta el layout apilado en móvil (ver estilos-admin.css).
    const tds = cols.map(c => `<td data-label="${esc(t(c.label))}">${c.render ? c.render(row) : (row[c.key] ?? '–')}</td>`).join('');
    const act = actions ? `<td data-label="${esc(t('Acciones'))}"><div class="actions">${actions(row)}</div></td>` : '';
    return `<tr data-id="${row.id}">${tds}${act}</tr>`;
  }).join('');
  const actTh = actions ? `<th style="width:100px">${esc(t('Acciones'))}</th>` : '';
  container.innerHTML = `<div class="table-scroll">
    <table class="data-table">
      <thead><tr>${ths}${actTh}</tr></thead>
      <tbody>${trs}</tbody>
    </table>
  </div>`;
}

// Toast notifications
const TOAST_ICO = {
  ok:    '<path d="M20 6 9 17l-5-5"/>',
  error: '<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6m0-6 6 6"/>',
  warn:  '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4m0 4h.01"/>',
};
export function showToast(message, type = 'ok') {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const el = document.createElement('div');
  el.className = `toast toast--${type}`;
  el.setAttribute('role', type === 'error' ? 'alert' : 'status'); // a11y: lo anuncia el lector
  el.innerHTML = `<svg class="toast__ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${TOAST_ICO[type] ?? TOAST_ICO.ok}</svg><span class="toast__msg"></span>`;
  el.querySelector('.toast__msg').textContent = t(message); // textContent: a prueba de XSS
  const dismiss = () => { el.classList.add('toast--out'); setTimeout(() => el.remove(), 200); };
  el.addEventListener('click', dismiss);
  container.appendChild(el);
  setTimeout(dismiss, 3500);
}

// Open/close the shared modal
export function openModal(title, bodyHTML, onSave, saveLabel = 'Guardar') {
  const modal = document.getElementById('ad-modal');
  modal.querySelector('#modal-title').textContent   = t(title);
  modal.querySelector('#modal-body').innerHTML      = bodyHTML;
  modal.querySelector('#modal-save-label').textContent = t(saveLabel);
  modal.hidden = false;
  const save = modal.querySelector('#modal-save');
  save.disabled = false; // limpia un disabled dejado por un guardado anterior
  save.onclick = onSave;
  modal.querySelector('#modal-body').querySelector('input,select,textarea')?.focus();
}

export function closeModal() {
  const modal = document.getElementById('ad-modal');
  modal.hidden = true;
  modal.querySelector('#modal-save').onclick = null;
}

// Diálogo de confirmación personalizado (reemplaza window.confirm nativo).
// Devuelve Promise<boolean>. Reusa las clases .ad-modal ya estilizadas.
export function confirm(msg, { ok = 'Confirmar', cancel = 'Cancelar', danger = true } = {}) {
  return new Promise((resolve) => {
    const ov = document.createElement('div');
    ov.className = 'ad-modal';
    ov.innerHTML = `
      <div class="ad-modal__card" style="max-width:400px">
        <div class="ad-modal__body" style="padding-top:24px">
          <p style="font-size:.95rem;color:var(--ad-tinta);line-height:1.5">${esc(t(msg))}</p>
        </div>
        <div class="ad-modal__footer">
          <button class="abtn abtn--ghost" data-act="cancel">${esc(t(cancel))}</button>
          <button class="abtn abtn--${danger ? 'danger' : 'primary'}" data-act="ok">${esc(t(ok))}</button>
        </div>
      </div>`;
    const done = (val) => { ov.remove(); document.removeEventListener('keydown', onKey); resolve(val); };
    const onKey = (e) => { if (e.key === 'Escape') done(false); };
    ov.addEventListener('click', (e) => {
      if (e.target === ov) done(false);
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act) done(act === 'ok');
    });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(ov);
    ov.querySelector('[data-act="ok"]').focus();
  });
}
