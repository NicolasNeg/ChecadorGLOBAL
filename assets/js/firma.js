// Integra SignaturePad (ESM desde jsDelivr) con escalado devicePixelRatio.
import SignaturePad from 'https://cdn.jsdelivr.net/npm/signature_pad@5/dist/signature_pad.esm.js';

let pad = null;

export function iniciarFirma(canvas) {
  pad = new SignaturePad(canvas, { penColor: '#0C2030' });
  escalar(canvas);

  // Re-escalar si el dispositivo rota
  const ro = new ResizeObserver(() => {
    const data = pad.toData();
    escalar(canvas);
    pad.fromData(data);
  });
  ro.observe(canvas);
  return () => ro.disconnect();
}

function escalar(canvas) {
  const ratio = Math.max(window.devicePixelRatio ?? 1, 1);
  const rect  = canvas.getBoundingClientRect();
  canvas.width  = rect.width  * ratio;
  canvas.height = rect.height * ratio;
  const ctx = canvas.getContext('2d');
  ctx.scale(ratio, ratio);
  if (pad) pad.clear();
}

export function limpiarFirma() {
  pad?.clear();
}

export function estaVacia() {
  return pad ? pad.isEmpty() : true;
}

export function obtenerFirmaPNG() {
  return pad ? pad.toDataURL('image/png') : null;
}
