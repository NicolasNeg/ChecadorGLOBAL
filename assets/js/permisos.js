// Gestiona permisos de cámara y geolocalización.
// Exporta el stream de vídeo y las coordenadas actuales para uso global.

export let streamCamara = null;
export let coordenadas  = { latitud: null, longitud: null };

let _watchId = null;

export async function solicitarPermisos(onEstado) {
  // onEstado({ camara, ubicacion }) — 'pendiente' | 'activa' | 'bloqueada'
  let estado = { camara: 'pendiente', ubicacion: 'pendiente' };
  const notificar = () => onEstado({ ...estado });

  await Promise.allSettled([
    (async () => {
      try {
        streamCamara = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user' },
          audio: false,
        });
        estado.camara = 'activa';
      } catch {
        estado.camara = 'bloqueada';
      }
      notificar();
    })(),
    new Promise((resolve) => {
      if (!navigator.geolocation) {
        estado.ubicacion = 'bloqueada';
        notificar();
        resolve();
        return;
      }
      _watchId = navigator.geolocation.watchPosition(
        (pos) => {
          coordenadas.latitud  = pos.coords.latitude;
          coordenadas.longitud = pos.coords.longitude;
          if (estado.ubicacion !== 'activa') {
            estado.ubicacion = 'activa';
            notificar();
          }
          resolve();
        },
        () => {
          estado.ubicacion = 'bloqueada';
          notificar();
          resolve();
        },
        { enableHighAccuracy: true, timeout: 10000 }
      );
    }),
  ]);

  return estado;
}

export function detenerWatch() {
  if (_watchId !== null) navigator.geolocation.clearWatch(_watchId);
}
