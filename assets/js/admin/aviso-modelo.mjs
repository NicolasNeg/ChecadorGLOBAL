// Modelo puro del editor de avisos (sin DOM, testeable). El lienzo es retrato
// 4:5 a 1080×1350. El modelo es { fondo, elementos:[...] }; cada elemento lleva
// x,y en coords del viewBox. modeloASvg() lo serializa a un SVG completo que el
// editor rasteriza a PNG. avisoVigente() replica la vigencia del RPC.

export const LIENZO_W = 1080;
export const LIENZO_H = 1350;

// Set chico de iconos (paths stroke estilo lucide, viewBox 24). Se escalan a w.
export const ICONOS = {
  alerta:    'M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z M12 9v4 M12 17h.01',
  info:      'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z M12 16v-4 M12 8h.01',
  calendario:'M3 4h18v18H3z M16 2v4 M8 2v4 M3 10h18',
  reloj:     'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z M12 6v6l4 2',
  ubicacion: 'M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z M12 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  check:     'M22 11.08V12a10 10 0 1 1-5.93-9.14 M22 4 12 14.01l-3-3',
  megafono:  'M3 11l18-5v12L3 14v-3z M11.6 16.8a3 3 0 1 1-5.8-1.6',
  estrella:  'M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z',
};

const uid = () => (globalThis.crypto?.randomUUID?.() ?? `el_${Math.random().toString(36).slice(2, 10)}`);

// Factory con valores por defecto razonables, centrado en el lienzo.
export function elementoNuevo(tipo, extra = {}) {
  const base = { id: uid(), tipo, x: 140, y: 560 };
  const def = {
    texto:  { w: 800, texto: 'Texto', fontSize: 64, color: '#0f172a', bold: false, align: 'left' },
    imagen: { w: 400, h: 400, dataUrl: '' },
    forma:  { w: 800, h: 200, fill: '#0369a1', radio: 16, opacidad: 1 },
    icono:  { w: 120, h: 120, path: ICONOS.info, color: '#0369a1' },
  }[tipo] || {};
  return { ...base, ...def, ...extra };
}

// Plantillas: arreglos de elementos predefinidos. Devuelven { fondo, elementos }.
// `campos` (opcional, del modo formulario) rellena título/cuerpo/fecha; vacíos
// usan los placeholders. La fecha sólo agrega su línea cuando viene con texto.
export function plantilla(nombre, campos = {}) {
  const tit = (campos.titulo || '').trim();
  const cue = (campos.cuerpo || '').trim();
  const fec = (campos.fecha || '').trim();

  if (nombre === 'urgente') {
    const els = [
      elementoNuevo('forma',  { x: 0, y: 0, w: LIENZO_W, h: 260, fill: '#dc2626', radio: 0 }),
      elementoNuevo('icono',  { x: 90, y: 70, w: 120, h: 120, path: ICONOS.alerta, color: '#ffffff' }),
      elementoNuevo('texto',  { x: 250, y: 160, w: 760, texto: 'URGENTE', fontSize: 96, color: '#ffffff', bold: true }),
      elementoNuevo('texto',  { x: 90, y: 380, w: 900, texto: tit || 'Escribe el aviso aquí', fontSize: 56, color: '#0f172a', bold: true }),
      elementoNuevo('texto',  { x: 90, y: 520, w: 900, texto: cue || 'Detalles del aviso…', fontSize: 40, color: '#475569' }),
    ];
    if (fec) els.push(elementoNuevo('texto', { x: 90, y: 700, w: 900, texto: fec, fontSize: 44, color: '#dc2626', bold: true }));
    return { fondo: '#ffffff', elementos: els };
  }
  if (nombre === 'evento') return { fondo: '#f0f9ff', elementos: [
    elementoNuevo('icono',  { x: 90, y: 90, w: 110, h: 110, path: ICONOS.calendario, color: '#0369a1' }),
    elementoNuevo('texto',  { x: 90, y: 320, w: 900, texto: tit || 'Nombre del evento', fontSize: 84, color: '#0c4a6e', bold: true }),
    elementoNuevo('texto',  { x: 90, y: 480, w: 900, texto: fec || 'Fecha y hora', fontSize: 48, color: '#0369a1' }),
    elementoNuevo('texto',  { x: 90, y: 600, w: 900, texto: cue || 'Lugar / detalles', fontSize: 40, color: '#475569' }),
  ] };
  // informativo (por defecto)
  const els = [
    elementoNuevo('forma',  { x: 0, y: 0, w: 24, h: LIENZO_H, fill: '#0369a1', radio: 0 }),
    elementoNuevo('icono',  { x: 90, y: 90, w: 110, h: 110, path: ICONOS.info, color: '#0369a1' }),
    elementoNuevo('texto',  { x: 90, y: 320, w: 900, texto: tit || 'Título del aviso', fontSize: 84, color: '#0f172a', bold: true }),
    elementoNuevo('texto',  { x: 90, y: 480, w: 900, texto: cue || 'Cuerpo del mensaje…', fontSize: 44, color: '#475569' }),
  ];
  if (fec) els.push(elementoNuevo('texto', { x: 90, y: 660, w: 900, texto: fec, fontSize: 40, color: '#0369a1', bold: true }));
  return { fondo: '#ffffff', elementos: els };
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function elementoASvg(el) {
  if (el.tipo === 'forma')
    return `<rect x="${el.x}" y="${el.y}" width="${el.w}" height="${el.h}" rx="${el.radio || 0}" fill="${esc(el.fill)}" opacity="${el.opacidad ?? 1}"/>`;
  if (el.tipo === 'imagen')
    return el.dataUrl ? `<image x="${el.x}" y="${el.y}" width="${el.w}" height="${el.h}" preserveAspectRatio="xMidYMid slice" href="${esc(el.dataUrl)}"/>` : '';
  if (el.tipo === 'icono') {
    const s = el.w / 24;
    return `<g transform="translate(${el.x},${el.y}) scale(${s})" fill="none" stroke="${esc(el.color)}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${esc(el.path)}"/></g>`;
  }
  // texto: una o varias líneas (\n), alineado por text-anchor
  const anchor = el.align === 'center' ? 'middle' : el.align === 'right' ? 'end' : 'start';
  const tx = el.align === 'center' ? el.x + el.w / 2 : el.align === 'right' ? el.x + el.w : el.x;
  const lh = el.fontSize * 1.2;
  const lineas = String(el.texto ?? '').split('\n');
  const tspans = lineas.map((ln, i) => `<tspan x="${tx}" dy="${i === 0 ? 0 : lh}">${esc(ln) || ' '}</tspan>`).join('');
  return `<text x="${tx}" y="${el.y + el.fontSize}" font-family="Arial, Helvetica, sans-serif" font-size="${el.fontSize}" font-weight="${el.bold ? 700 : 400}" fill="${esc(el.color)}" text-anchor="${anchor}">${tspans}</text>`;
}

// Serializa el modelo a un SVG completo (string). Texto y atributos escapados.
export function modeloASvg(modelo) {
  const fondo = modelo?.fondo || '#ffffff';
  const elementos = (modelo?.elementos || []).map(elementoASvg).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${LIENZO_W}" height="${LIENZO_H}" viewBox="0 0 ${LIENZO_W} ${LIENZO_H}">` +
    `<rect width="${LIENZO_W}" height="${LIENZO_H}" fill="${esc(fondo)}"/>${elementos}</svg>`;
}

// Vigencia (espejo del RPC, para filtrar/etiquetar en el cliente). hoy = 'YYYY-MM-DD'.
export function avisoVigente(aviso, hoy) {
  if (!aviso?.activo) return false;
  if (aviso.inicia_en  && hoy < aviso.inicia_en)  return false;
  if (aviso.termina_en && hoy > aviso.termina_en) return false;
  return true;
}
