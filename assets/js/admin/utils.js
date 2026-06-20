// Shared utilities for admin modules

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
  container.innerHTML = `<div class="ad-loading"><div class="ad-spinner"></div> Cargando…</div>`;
}

export function empty(container, msg = 'Sin registros.') {
  container.innerHTML = `<div class="ad-empty">${msg}</div>`;
}

// Generic table renderer
// cols: [{ key, label, render? }]
// rows: array of objects
// actions: (row) => HTML string
export function renderTable(container, cols, rows, actions) {
  if (!rows.length) { empty(container); return; }
  const ths = cols.map(c => `<th>${c.label}</th>`).join('');
  const trs = rows.map(row => {
    const tds = cols.map(c => `<td>${c.render ? c.render(row) : (row[c.key] ?? '–')}</td>`).join('');
    const act = actions ? `<td><div class="actions">${actions(row)}</div></td>` : '';
    return `<tr data-id="${row.id}">${tds}${act}</tr>`;
  }).join('');
  const actTh = actions ? '<th style="width:100px">Acciones</th>' : '';
  container.innerHTML = `<div class="table-scroll">
    <table class="data-table">
      <thead><tr>${ths}${actTh}</tr></thead>
      <tbody>${trs}</tbody>
    </table>
  </div>`;
}

// Toast notifications
export function showToast(message, type = 'ok') {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const t = document.createElement('div');
  t.className = `toast toast--${type}`;
  t.textContent = message;
  container.appendChild(t);
  setTimeout(() => t.remove(), 3500);
}

// Open/close the shared modal
export function openModal(title, bodyHTML, onSave, saveLabel = 'Guardar') {
  const modal = document.getElementById('ad-modal');
  modal.querySelector('#modal-title').textContent   = title;
  modal.querySelector('#modal-body').innerHTML      = bodyHTML;
  modal.querySelector('#modal-save-label').textContent = saveLabel;
  modal.hidden = false;
  modal.querySelector('#modal-save').onclick = onSave;
  modal.querySelector('#modal-body').querySelector('input,select,textarea')?.focus();
}

export function closeModal() {
  const modal = document.getElementById('ad-modal');
  modal.hidden = true;
  modal.querySelector('#modal-save').onclick = null;
}

// Confirm dialog using native browser confirm (lazy — add custom dialog when needed)
export const confirm = (msg) => window.confirm(msg);
