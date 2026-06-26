// Cálculo puro de la rejilla de gafetes en una hoja (para el lote). Separado de
// gafetes.js para poder probarlo sin jsPDF ni DOM. Todo en milímetros.

// Cuántas tarjetas caben en una hoja y en qué coordenadas (esquina sup-izq de
// cada tarjeta). cols/rows se calculan dejando margen alrededor y gap entre
// tarjetas. Devuelve { cols, rows, porPagina, posiciones:[{x,y}] }.
export function gridGafetes({ pagW, pagH, cardW, cardH, margen = 12, gap = 8 }) {
  const usableW = pagW - 2 * margen;
  const usableH = pagH - 2 * margen;
  const cols = Math.max(1, Math.floor((usableW + gap) / (cardW + gap)));
  const rows = Math.max(1, Math.floor((usableH + gap) / (cardH + gap)));
  const posiciones = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      posiciones.push({ x: margen + c * (cardW + gap), y: margen + r * (cardH + gap) });
    }
  }
  return { cols, rows, porPagina: cols * rows, posiciones };
}

// URL pública que codifica el QR del gafete. origin+base para que funcione en
// Vercel y en GitHub Pages (subruta /ChecadorGLOBAL).
export function urlVerificacion(origin, base, codigo) {
  return `${origin}${base}/verificar/?c=${codigo}`;
}
