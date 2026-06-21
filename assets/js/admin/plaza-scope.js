// Filtro global de plaza (solo RH). El rol 'jefe' ya está limitado por RLS a
// su mi_plaza_id(), así que para él esto es ruido: el selector se oculta.
// ponytail: filtro de conveniencia en cliente; RH sigue viendo todo en backend.
// Upgrade: forzar plaza_id en las RLS de RH si se requiere aislamiento duro.
const KEY = 'eqs_admin_plaza';
let _id = (() => { const v = localStorage.getItem(KEY); return v ? parseInt(v) : null; })();

export const getPlazaScope = () => _id; // null = todas las plazas

export function setPlazaScope(id) {
  _id = id || null;
  if (_id) localStorage.setItem(KEY, String(_id));
  else localStorage.removeItem(KEY);
}

// Filtra filas por su plaza_id. getId(row) → plaza_id de esa fila.
export function filterByPlaza(rows, getId) {
  return _id == null ? rows : rows.filter(r => getId(r) === _id);
}
