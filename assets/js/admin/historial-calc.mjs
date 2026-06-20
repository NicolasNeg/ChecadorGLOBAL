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
