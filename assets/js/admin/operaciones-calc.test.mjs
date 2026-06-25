// node assets/js/admin/operaciones-calc.test.mjs
import assert from 'node:assert';
import {
  estadoActualPorEmpleado, presentes, activosPorPlaza,
  contarAusentes, contarTarde, contarIncidencias,
} from './operaciones-calc.mjs';

const emp = (id, nombre, plazaId, plazaNombre) => ({ id, nombre, plaza_id: plazaId, plazas: { nombre: plazaNombre } });
// Registros del día, orden hora.desc (más reciente primero).
const registros = [
  { tipo: 'salida',  hora: '2026-06-23T17:00:00', geocerca_valida: true,  empleados: emp(1, 'Ana', 10, 'Centro') },
  { tipo: 'entrada', hora: '2026-06-23T09:15:00', geocerca_valida: false, empleados: emp(1, 'Ana', 10, 'Centro') },
  { tipo: 'entrada', hora: '2026-06-23T08:55:00', geocerca_valida: true,  empleados: emp(2, 'Beto', 10, 'Centro') },
  { tipo: 'entrada', hora: '2026-06-23T10:30:00', geocerca_valida: true,  empleados: emp(3, 'Cito', 20, 'Norte') },
];

// estado actual: el más reciente por empleado
const estado = estadoActualPorEmpleado(registros);
assert.equal(estado.get(1).tipo, 'salida',  'Ana: última checada = salida → inactiva');
assert.equal(estado.get(2).tipo, 'entrada', 'Beto: solo entrada → activo');
assert.equal(estado.size, 3, 'tres empleados distintos');

// presentes: solo quienes su estado actual es entrada
const pres = presentes(registros);
assert.deepEqual(pres.map(p => p.nombre).sort(), ['Beto', 'Cito'], 'presentes = Beto y Cito');

// activos por plaza
const porPlaza = activosPorPlaza(registros);
assert.equal(porPlaza.get(10).activos.length, 1, 'plaza 10 (Centro): 1 activo (Beto)');
assert.equal(porPlaza.get(20).activos.length, 1, 'plaza 20 (Norte): 1 activo (Cito)');
assert.equal(porPlaza.has(undefined), false, 'sin plaza nula');

// ausentes: empleados con turno que no aparecen hoy
const conTurno = [{ id: 1, turno_id: 100 }, { id: 2, turno_id: 100 }, { id: 4, turno_id: 100 }];
assert.equal(contarAusentes(registros, conTurno), 1, 'solo el empleado 4 está ausente');

// tarde: primera entrada vs hora_entrada + tolerancia
const turnoPorEmpleado = new Map([
  [1, { hora_entrada: '09:00', tolerancia_entrada_min: 10 }], // Ana entró 09:15 > 09:10 → tarde
  [2, { hora_entrada: '09:00', tolerancia_entrada_min: 10 }], // Beto entró 08:55 → a tiempo
  [3, { hora_entrada: '11:00', tolerancia_entrada_min: 0 }],  // Cito entró 10:30 < 11:00 → a tiempo
]);
assert.equal(contarTarde(registros, turnoPorEmpleado), 1, 'solo Ana llegó tarde');

// incidencias de geocerca
assert.equal(contarIncidencias(registros), 1, 'una checada fuera de geocerca');

console.log('operaciones-calc: OK');
