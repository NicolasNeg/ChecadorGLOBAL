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
  console.log('historial-calc OK');
}
