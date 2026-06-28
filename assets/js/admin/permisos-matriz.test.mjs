import assert from 'node:assert';
import { rolesAsignables, defaultDelRol, estadoEfectivo, accionTriestado } from './permisos-matriz.mjs';

const roles = [
  { clave: 'super_admin', nivel: 4 }, { clave: 'rh', nivel: 3 },
  { clave: 'jefe', nivel: 2 }, { clave: 'supervisor', nivel: 1 },
];
// Un jefe (nivel 2) solo puede asignar supervisor (nivel 1).
assert.deepStrictEqual(rolesAsignables(roles, 2).map(r => r.clave), ['supervisor']);
// Un rh (nivel 3) puede asignar jefe y supervisor.
assert.deepStrictEqual(rolesAsignables(roles, 3).map(r => r.clave), ['jefe', 'supervisor']);

const rolPermisos = [
  { rol: 'jefe', permiso: 'empleados.ver' },
  { rol: 'jefe', permiso: 'empleados.editar' },
];
assert.strictEqual(defaultDelRol('empleados.ver', 'jefe', rolPermisos), true);
assert.strictEqual(defaultDelRol('config.editar', 'jefe', rolPermisos), false);

// Sin override → hereda.
assert.strictEqual(estadoEfectivo('empleados.ver', 'jefe', rolPermisos, []), 'hereda');
// Override concedido / revocado mandan.
assert.strictEqual(estadoEfectivo('config.editar', 'jefe', rolPermisos,
  [{ permiso: 'config.editar', concedido: true }]), 'concedido');
assert.strictEqual(estadoEfectivo('empleados.ver', 'jefe', rolPermisos,
  [{ permiso: 'empleados.ver', concedido: false }]), 'revocado');

// Ciclo tri-estado.
assert.strictEqual(accionTriestado('hereda'), 'concedido');
assert.strictEqual(accionTriestado('concedido'), 'revocado');
assert.strictEqual(accionTriestado('revocado'), 'hereda');

console.log('permisos-matriz OK');
