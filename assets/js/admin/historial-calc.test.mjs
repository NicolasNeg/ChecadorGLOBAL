import { test } from 'node:test';
import assert from 'node:assert/strict';
import { horaAMin, esRetardo, horasPorDia, resumen } from './historial-calc.mjs';

const turno = { hora_entrada: '09:00:00', tolerancia_entrada_min: 15 };

test('horaAMin convierte HH:MM[:SS] a minutos', () => {
  assert.equal(horaAMin('09:00:00'), 540);
  assert.equal(horaAMin('09:15'), 555);
});

test('esRetardo: entrada después de hora_entrada + tolerancia', () => {
  // 09:20 local > 09:15 límite → retardo
  assert.equal(esRetardo({ tipo: 'entrada', hora: '2026-06-19T09:20:00' }, turno), true);
  // 09:10 local <= 09:15 → no
  assert.equal(esRetardo({ tipo: 'entrada', hora: '2026-06-19T09:10:00' }, turno), false);
  // salida nunca es retardo
  assert.equal(esRetardo({ tipo: 'salida', hora: '2026-06-19T20:00:00' }, turno), false);
  // sin turno → no se evalúa
  assert.equal(esRetardo({ tipo: 'entrada', hora: '2026-06-19T09:20:00' }, null), false);
});

test('horasPorDia empareja primera entrada con última salida', () => {
  const regs = [
    { tipo: 'entrada', hora: '2026-06-19T09:00:00' },
    { tipo: 'salida',  hora: '2026-06-19T13:00:00' },
    { tipo: 'salida',  hora: '2026-06-19T18:00:00' }, // última salida
  ];
  const dias = horasPorDia(regs);
  assert.equal(dias.length, 1);
  assert.equal(dias[0].incompleto, false);
  assert.equal(dias[0].horas, 9); // 09:00 → 18:00
});

test('horasPorDia marca incompleto el día sin salida', () => {
  const dias = horasPorDia([{ tipo: 'entrada', hora: '2026-06-19T09:00:00' }]);
  assert.equal(dias[0].incompleto, true);
  assert.equal(dias[0].horas, 0);
});

test('resumen agrega totales', () => {
  const regs = [
    { tipo: 'entrada', hora: '2026-06-19T09:20:00' }, // retardo
    { tipo: 'salida',  hora: '2026-06-19T18:00:00' },
  ];
  const r = resumen(regs, turno, [{ tipo: 'falta' }]);
  assert.equal(r.totalChecadas, 2);
  assert.equal(r.retardos, 1);
  assert.equal(r.incidencias, 1);
  assert.ok(Math.abs(r.horasTotales - 8.7) < 0.01); // 09:20→18:00 = 8.666… → 8.7
});
