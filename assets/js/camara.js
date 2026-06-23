// Controla el preview de cámara, captura y convierte a JPEG base64.

let _stream = null;

export function iniciarPreview(videoEl, stream) {
  _stream = stream;
  videoEl.srcObject = stream;
}

export function capturarFoto(videoEl, quality = 0.7) {
  const canvas = document.createElement('canvas');
  canvas.width  = videoEl.videoWidth;
  canvas.height = videoEl.videoHeight;
  // Espejo (selfie): voltea horizontal para que la foto guardada coincida con
  // el preview espejado. No afecta el reconocimiento (analiza el <video>, no el JPEG).
  const ctx = canvas.getContext('2d');
  ctx.translate(canvas.width, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(videoEl, 0, 0);
  return canvas.toDataURL('image/jpeg', quality);
}
