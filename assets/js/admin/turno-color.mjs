// Color de turno: el elegido (turnos.color) o uno estable de la paleta por id.
// contraste() elige texto blanco/negro por luminancia (WCAG relative luminance).

export const PALETA = ['#3B82F6', '#10B981', '#14B8A6', '#F59E0B', '#8B5CF6'];

export function colorDeTurno(turno) {
  if (turno?.color) return turno.color;
  const id = turno?.id ?? 0;
  return PALETA[((id % PALETA.length) + PALETA.length) % PALETA.length];
}

// Texto legible sobre `hex`. Umbral 0.5 sobre luminancia relativa sRGB.
export function contraste(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return '#111111';
  const n = parseInt(m[1], 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  const L = 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  return L > 0.5 ? '#111111' : '#ffffff';
}
