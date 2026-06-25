// Cálculos puros del Centro de Operaciones (sin DOM, node-runnable self-check).
// Reduce los registros del día al estado ACTUAL por empleado y los agrega por plaza.
// Los registros llegan ordenados `hora.desc` (más reciente primero).
import { esRetardo } from './historial-calc.mjs';

// id_empleado → su registro más reciente de hoy {tipo, hora, plazaId, nombre, plazaNombre}
export function estadoActualPorEmpleado(registros) {
  const m = new Map();
  for (const r of registros) {
    const e = r.empleados;
    if (!e) continue;
    if (m.has(e.id)) continue; // ya tenemos el más reciente (orden desc)
    m.set(e.id, {
      tipo: r.tipo,
      hora: r.hora,
      plazaId: e.plaza_id ?? null,
      nombre: e.nombre ?? '—',
      plazaNombre: e.plazas?.nombre ?? null,
    });
  }
  return m;
}

// "Presente" = su estado actual de hoy es una entrada (aún no ha salido).
export function presentes(registros) {
  return [...estadoActualPorEmpleado(registros).values()].filter(s => s.tipo === 'entrada');
}

// plazaId → {nombre, activos: [{nombre, hora}]} (solo presentes; agrupa por plaza)
export function activosPorPlaza(registros) {
  const out = new Map();
  for (const s of presentes(registros)) {
    if (s.plazaId == null) continue;
    if (!out.has(s.plazaId)) out.set(s.plazaId, { nombre: s.plazaNombre, activos: [] });
    out.get(s.plazaId).activos.push({ nombre: s.nombre, hora: s.hora });
  }
  return out;
}

// Empleados activos con turno hoy que NO tienen entrada registrada hoy.
// empleadosConTurno: [{id, turno_id}] de empleados activos con turno asignado.
export function contarAusentes(registros, empleadosConTurno) {
  const estado = estadoActualPorEmpleado(registros);
  return empleadosConTurno.filter(e => !estado.has(e.id)).length;
}

// Empleados cuya PRIMERA entrada de hoy es un retardo según su turno.
// turnoPorEmpleado: Map<id_empleado, turno {hora_entrada, tolerancia_entrada_min}>
export function contarTarde(registros, turnoPorEmpleado) {
  // primera entrada de hoy por empleado: como vienen desc, la última que veamos
  // por empleado con tipo 'entrada' es la más temprana.
  const primeraEntrada = new Map();
  for (const r of registros) {
    if (r.tipo !== 'entrada' || !r.empleados) continue;
    primeraEntrada.set(r.empleados.id, r); // se sobreescribe → queda la más temprana
  }
  let n = 0;
  for (const [id, reg] of primeraEntrada) {
    const turno = turnoPorEmpleado.get(id);
    if (turno && esRetardo(reg, turno)) n++;
  }
  return n;
}

export function contarIncidencias(registros) {
  return registros.filter(r => r.geocerca_valida === false).length;
}

// ── self-check ──────────────────────────────────────────────────────────────
// node assets/js/admin/operaciones-calc.test.mjs
