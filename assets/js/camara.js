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
  canvas.getContext('2d').drawImage(videoEl, 0, 0);
  return canvas.toDataURL('image/jpeg', quality);
}
