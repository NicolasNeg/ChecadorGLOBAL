// Lógica pura de la matriz de permisos por usuario. Sin DOM, testeable.

// Roles que un gestor puede asignar: estrictamente de menor nivel que el suyo.
export function rolesAsignables(roles, miNivel) {
  return roles.filter(r => r.nivel < miNivel);
}

// ¿El rol trae el permiso por default?
export function defaultDelRol(permiso, rol, rolPermisos) {
  return rolPermisos.some(rp => rp.rol === rol && rp.permiso === permiso);
}

// Estado efectivo de un permiso para un perfil: el override (si existe) manda;
// si no, 'hereda' (toma el default del rol).
export function estadoEfectivo(permiso, rol, rolPermisos, perfilPermisos) {
  const ov = perfilPermisos.find(pp => pp.permiso === permiso);
  if (ov) return ov.concedido ? 'concedido' : 'revocado';
  return 'hereda';
}

// Clic en la celda: hereda → concedido → revocado → hereda.
export function accionTriestado(estado) {
  return estado === 'hereda' ? 'concedido'
       : estado === 'concedido' ? 'revocado'
       : 'hereda';
}
