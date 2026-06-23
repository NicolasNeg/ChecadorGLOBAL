// Cálculos puros del historial de un empleado (sin DOM). Node-runnable self-check.
// ponytail: usa la zona horaria local del runtime (el del admin). Si la DB guarda
// UTC y el admin está en otra zona, los minutos-del-día se interpretan en local —
// correcto para el admin. Upgrade: pasar timezone explícita si se requiere multi-zona.

const minutosDia = (d) => d.getHours() * 60 + d.getMinutes();

export function horaAMin(t) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

export function esRetardo(reg, turno) {
  if (!turno || reg.tipo !== 'entrada' || !turno.hora_entrada) return false;
  const limite = horaAMin(turno.hora_entrada) + (turno.tolerancia_entrada_min ?? 0);
  return minutosDia(new Date(reg.hora)) > limite;
}

export function horasPorDia(registros) {
  const dias = new Map();
  for (const r of registros) {
    const d = new Date(r.hora);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const e = dias.get(key) ?? { fecha: key, entrada: null, salida: null };
    if (r.tipo === 'entrada' && (!e.entrada || new Date(r.hora) < new Date(e.entrada))) e.entrada = r.hora;
    if (r.tipo === 'salida'  && (!e.salida  || new Date(r.hora) > new Date(e.salida)))  e.salida  = r.hora;
    dias.set(key, e);
  }
  return [...dias.values()].map((e) => {
    const incompleto = !e.entrada || !e.salida;
    const horas = incompleto ? 0 : (new Date(e.salida) - new Date(e.entrada)) / 3_600_000;
    return { ...e, horas, incompleto };
  });
}

const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// Agrupa registros por día: primera entrada y última salida (objetos completos,
// conservan ruta_foto/ruta_firma para el lightbox).
export function agruparPorDia(registros) {
  const m = new Map();
  for (const r of registros) {
    const key = ymd(new Date(r.hora));
    const g = m.get(key) ?? { entrada: null, salida: null };
    if (r.tipo === 'entrada' && (!g.entrada || new Date(r.hora) < new Date(g.entrada.hora))) g.entrada = r;
    if (r.tipo === 'salida'  && (!g.salida  || new Date(r.hora) > new Date(g.salida.hora)))  g.salida  = r;
    m.set(key, g);
  }
  return m;
}

// Un objeto por día del rango (más reciente primero). estado:
// presente | falta | justificacion | permiso | vacaciones | festivo | futuro.
// Día sin checada ni incidencia y <= hoy ⇒ 'falta' implícita.
// ponytail: la falta implícita no distingue fines de semana ni festivos no
// marcados; el admin los marca como incidencia. Upgrade: días laborables en turno.
export function diasCalendario(registros, incidencias, rango, hoy = new Date()) {
  const regs = agruparPorDia(registros);
  const incs = new Map(incidencias.map((i) => [i.fecha, i]));
  const hoyKey = ymd(hoy);
  const dias = [];
  const cur = new Date(rango.desde + 'T12:00:00'); // mediodía: evita saltos por DST
  const fin = new Date(rango.hasta + 'T12:00:00');
  while (cur <= fin) {
    const key = ymd(cur);
    const reg = regs.get(key) ?? null;
    const inc = incs.get(key) ?? null;
    const presente = !!(reg && (reg.entrada || reg.salida));
    const estado = presente ? 'presente'
      : inc ? inc.tipo
      : key <= hoyKey ? 'falta'
      : 'futuro';
    const horas = (reg?.entrada && reg?.salida)
      ? Math.round((new Date(reg.salida.hora) - new Date(reg.entrada.hora)) / 360000) / 10
      : null;
    dias.push({ fecha: key, dow: cur.getDay(), estado, entrada: reg?.entrada ?? null, salida: reg?.salida ?? null, horas, inc });
    cur.setDate(cur.getDate() + 1);
  }
  return dias.reverse();
}

// Agrupa notas (antes "incidencias") por día → Map<ymd, nota[]>. Un día puede
// tener varias (permiso + justificación, etc.).
export function notasPorDia(incidencias) {
  const m = new Map();
  for (const i of incidencias) {
    if (!m.has(i.fecha)) m.set(i.fecha, []);
    m.get(i.fecha).push(i);
  }
  return m;
}

// Estado de un día para la cuadrícula mensual: presente si hubo checada; si no,
// el tipo de la primera nota; si no y el día ya pasó: falta; si no: futuro.
export function estadoDia({ entrada, salida, notas }, ymdKey, hoyKey) {
  if (entrada || salida) return 'presente';
  if (notas && notas.length) return notas[0].tipo;
  return ymdKey <= hoyKey ? 'falta' : 'futuro';
}

export function resumen(registros, turno, incidencias = []) {
  const retardos = registros.filter((r) => esRetardo(r, turno)).length;
  const horasTotales = horasPorDia(registros).reduce((s, d) => s + d.horas, 0);
  return {
    totalChecadas: registros.length,
    retardos,
    horasTotales: Math.round(horasTotales * 10) / 10,
    incidencias: incidencias.length,
  };
}

// ── Tablero mensual (heatmap empleado × día) ──────────────────────────────────
// Categoría de color a partir del estado granular (la leyenda tiene 5 colores).
export const CATEGORIA = {
  presente: 'presente', asistencia: 'presente', retardo: 'retardo', falta: 'falta',
  permiso: 'permiso', justificacion: 'permiso', vacaciones: 'permiso', festivo: 'permiso',
  descanso: 'descanso', sinasignar: 'sinasignar',
  futuro: 'futuro', previo: 'futuro', // 'previo' = antes del alta: en blanco, no cuenta
};

// Estado de una celda (un empleado, un día).
// Sin turno asignado ⇒ 'sinasignar' (NO descanso): un día sin turno no es un
// descanso, es que aún no se le asignó horario. 'descanso' solo cuando se marca
// explícitamente como incidencia (inc.tipo === 'descanso').
export function estadoCelda(reg, inc, turno, ymdKey, hoyKey) {
  if (reg && reg.entrada) return esRetardo(reg.entrada, turno) ? 'retardo' : 'presente';
  if (reg && reg.salida)  return 'presente';
  if (inc)                return inc.tipo;
  if (!turno)             return 'sinasignar';
  return ymdKey <= hoyKey ? 'falta' : 'futuro';
}

// Construye el tablero: columnas (días del rango) + una fila por empleado con
// sus celdas y un resumen por categoría. Puro (sin DOM), node-testable.
// El turno de cada día viene de turnos_dia (lo asigna la sección Turnos): si no
// hay fila para (empleado, fecha) ⇒ ese día es descanso. Días anteriores al alta
// del empleado (fecha_ingreso) salen en blanco y no se cuentan.
export function tableroMes(empleados, registros, incidencias, turnosDia, turnos, rango, hoy = new Date()) {
  const hoyKey = ymd(hoy);
  const turnoDe = new Map(turnos.map((t) => [t.id, t]));
  const turnoDiaDe = new Map(turnosDia.map((d) => [`${d.id_empleado}-${d.fecha}`, d.turno_id]));

  // registros agrupados por empleado → Map<empId, Map<ymd,{entrada,salida}>>
  const regsPorEmp = new Map();
  for (const r of registros) {
    if (!regsPorEmp.has(r.id_empleado)) regsPorEmp.set(r.id_empleado, []);
    regsPorEmp.get(r.id_empleado).push(r);
  }
  const diasPorEmp = new Map();
  for (const [id, regs] of regsPorEmp) diasPorEmp.set(id, agruparPorDia(regs));

  const incPorEmpDia = new Map();
  for (const i of incidencias) {
    const k = `${i.id_empleado}-${i.fecha}`;
    if (!incPorEmpDia.has(k)) incPorEmpDia.set(k, i); // primera gana
  }

  // columnas
  const dias = [];
  const cur = new Date(rango.desde + 'T12:00:00');
  const fin = new Date(rango.hasta + 'T12:00:00');
  while (cur <= fin) {
    const dow = cur.getDay(); // 0=Dom..6=Sáb
    dias.push({ ymd: ymd(cur), dia: cur.getDate(), dow, finde: dow === 0 || dow === 6, esHoy: ymd(cur) === hoyKey });
    cur.setDate(cur.getDate() + 1);
  }

  const filas = empleados.map((e) => {
    const regsDia = diasPorEmp.get(e.id) ?? new Map();
    const resumen = { presente: 0, retardo: 0, falta: 0, permiso: 0, descanso: 0, sinasignar: 0, futuro: 0 };
    const ingreso = e.fecha_ingreso || null;
    const celdas = dias.map((d) => {
      const turno = turnoDe.get(turnoDiaDe.get(`${e.id}-${d.ymd}`));
      const reg = regsDia.get(d.ymd) ?? null;
      const inc = incPorEmpDia.get(`${e.id}-${d.ymd}`) ?? null;
      const estado = (ingreso && d.ymd < ingreso)
        ? 'previo'
        : estadoCelda(reg, inc, turno, d.ymd, hoyKey);
      const cat = CATEGORIA[estado] ?? 'futuro';
      resumen[cat] = (resumen[cat] ?? 0) + 1;
      return { ymd: d.ymd, dia: d.dia, estado, cat, entrada: reg?.entrada ?? null, salida: reg?.salida ?? null, inc };
    });
    return { empleado: e, celdas, resumen };
  });

  return { dias, filas };
}

// ── Self-check (node assets/js/admin/historial-calc.mjs) ──────────────────────
if (typeof process !== 'undefined' && process.argv?.[1] && import.meta.url === `file://${process.argv[1]}`) {
  const assert = (c, m) => { if (!c) { console.error('FAIL:', m); process.exit(1); } };
  const incs = [
    { fecha: '2026-06-10', tipo: 'permiso' },
    { fecha: '2026-06-10', tipo: 'justificacion' },
    { fecha: '2026-06-11', tipo: 'falta' },
  ];
  const m = notasPorDia(incs);
  assert(m.get('2026-06-10').length === 2, 'dos notas el mismo día');
  assert(estadoDia({ entrada: {}, notas: [] }, '2026-06-10', '2026-06-15') === 'presente', 'checada ⇒ presente');
  assert(estadoDia({ notas: m.get('2026-06-10') }, '2026-06-10', '2026-06-15') === 'permiso', 'primera nota define estado');
  assert(estadoDia({ notas: [] }, '2026-06-09', '2026-06-15') === 'falta', 'día pasado sin nada ⇒ falta');
  assert(estadoDia({ notas: [] }, '2026-06-20', '2026-06-15') === 'futuro', 'día futuro ⇒ futuro');

  // tableroMes: 1 empleado con turno L-V 09:00 (turnos_dia), checada tarde el lunes.
  // Sábado/domingo sin fila en turnos_dia ⇒ descanso.
  const emp = [{ id: 1, nombre: 'Ana', fecha_ingreso: '2026-06-15' }];
  const turnos = [{ id: 10, hora_entrada: '09:00', tolerancia_entrada_min: 0 }];
  const turnosDia = ['2026-06-15', '2026-06-16', '2026-06-17', '2026-06-18', '2026-06-19']
    .map((fecha) => ({ id_empleado: 1, fecha, turno_id: 10 }));
  const regs = [{ id_empleado: 1, tipo: 'entrada', hora: '2026-06-15T09:30:00' }]; // lunes tarde
  const tab = tableroMes(emp, regs, [], turnosDia, turnos, { desde: '2026-06-15', hasta: '2026-06-21' }, new Date('2026-06-18T12:00:00'));
  const byYmd = (k) => tab.filas[0].celdas.find((c) => c.ymd === k);
  assert(tab.dias.length === 7, 'tablero: 7 columnas');
  assert(byYmd('2026-06-15').estado === 'retardo', 'lunes con checada tardía ⇒ retardo');
  assert(byYmd('2026-06-16').estado === 'falta', 'martes laboral sin checada y pasado ⇒ falta');
  assert(byYmd('2026-06-20').estado === 'sinasignar', 'sábado sin turno_dia ⇒ sin asignar (no descanso)');
  assert(byYmd('2026-06-19').estado === 'futuro', 'viernes posterior a hoy ⇒ futuro');
  // descanso solo cuando se marca explícitamente (incidencia), no por ausencia de turno
  assert(estadoCelda(null, { tipo: 'descanso' }, null, '2026-06-20', '2026-06-18') === 'descanso', 'descanso explícito (incidencia) ⇒ descanso');
  assert(estadoCelda(null, null, null, '2026-06-16', '2026-06-18') === 'sinasignar', 'sin turno ni incidencia ⇒ sin asignar');

  // fecha_ingreso: días anteriores al alta salen en blanco y no se cuentan como falta.
  const emp2 = [{ id: 2, nombre: 'Beto', fecha_ingreso: '2026-06-17' }];
  const tab2 = tableroMes(emp2, [], [], [], turnos, { desde: '2026-06-15', hasta: '2026-06-18' }, new Date('2026-06-18T12:00:00'));
  const c2 = (k) => tab2.filas[0].celdas.find((c) => c.ymd === k);
  assert(c2('2026-06-16').estado === 'previo', 'día anterior al alta ⇒ previo');
  assert(c2('2026-06-16').cat === 'futuro', 'previo se pinta en blanco (cat futuro)');
  assert(tab2.filas[0].resumen.falta === 0, 'días previos al alta no cuentan como falta');
  console.log('historial-calc OK');
}
