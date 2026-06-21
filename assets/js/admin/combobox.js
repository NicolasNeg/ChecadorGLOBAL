// Combobox personalizado: select con búsqueda y avatar opcional.
// ponytail: propio porque <select> nativo no busca ni muestra imágenes.
// options: [{ value, label, img?, ph?, sub? }]  ('' = opción "todas")
import { esc } from './utils.js';

const CHEV = `<svg class="cbx__chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>`;

function avatar(o, cls = 'cbx__av') {
  if (o.img) return `<img class="${cls}" src="${esc(o.img)}" alt="">`;
  if (o.ph != null) return `<span class="${cls} ${cls}--ph">${esc(o.ph)}</span>`;
  return '';
}

export function combobox({ placeholder = 'Seleccionar', options = [], value = '', searchable = true, onChange } = {}) {
  let opts = options;
  let val = value;

  const root = document.createElement('div');
  root.className = 'cbx';
  root.innerHTML = `
    <button type="button" class="cbx__btn" aria-haspopup="listbox" aria-expanded="false">
      <span class="cbx__sel"></span>${CHEV}
    </button>
    <div class="cbx__pop" hidden>
      ${searchable ? '<div class="cbx__search-wrap"><input class="cbx__search" type="text" placeholder="Buscar…" aria-label="Buscar"></div>' : ''}
      <ul class="cbx__list" role="listbox" tabindex="-1"></ul>
    </div>`;

  const btn    = root.querySelector('.cbx__btn');
  const sel     = root.querySelector('.cbx__sel');
  const pop     = root.querySelector('.cbx__pop');
  const list    = root.querySelector('.cbx__list');
  const search  = root.querySelector('.cbx__search');

  const find = (v) => opts.find(o => String(o.value) === String(v));

  function renderSel() {
    const o = find(val);
    if (o) sel.innerHTML = `${avatar(o)}<span class="cbx__sel-tx">${esc(o.label)}</span>`;
    else   sel.innerHTML = `<span class="cbx__sel-tx cbx__sel-tx--ph">${esc(placeholder)}</span>`;
  }

  function renderList() {
    const q = (search?.value ?? '').trim().toLowerCase();
    const vis = q ? opts.filter(o => o.label.toLowerCase().includes(q)) : opts;
    list.innerHTML = vis.length ? vis.map(o => `
      <li class="cbx__opt ${String(o.value) === String(val) ? 'is-sel' : ''}" role="option"
          aria-selected="${String(o.value) === String(val)}" data-val="${esc(String(o.value))}">
        ${avatar(o)}
        <span class="cbx__opt-tx"><span class="cbx__opt-lbl">${esc(o.label)}</span>${o.sub ? `<span class="cbx__opt-sub">${esc(o.sub)}</span>` : ''}</span>
        <svg class="cbx__check" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
      </li>`).join('') : `<li class="cbx__empty">Sin resultados</li>`;
  }

  function open() {
    pop.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    renderList();
    if (search) { search.value = ''; search.focus(); }
  }
  function close() {
    pop.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
  }
  const isOpen = () => !pop.hidden;

  btn.addEventListener('click', () => isOpen() ? close() : open());
  search?.addEventListener('input', renderList);
  list.addEventListener('click', (e) => {
    const li = e.target.closest('.cbx__opt');
    if (!li) return;
    val = li.dataset.val;
    renderSel();
    close();
    onChange?.(val);
  });
  // cerrar al hacer clic fuera / Escape
  document.addEventListener('click', (e) => { if (!root.contains(e.target)) close(); });
  root.addEventListener('keydown', (e) => { if (e.key === 'Escape') { close(); btn.focus(); } });

  renderSel();

  return {
    el: root,
    getValue: () => val,
    setValue(v) { val = v ?? ''; renderSel(); if (isOpen()) renderList(); },
    setOptions(next, keep = true) {
      opts = next;
      if (!keep || !find(val)) val = '';
      renderSel();
      if (isOpen()) renderList();
    },
  };
}
