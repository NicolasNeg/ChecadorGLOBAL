// face.js — verificación facial con liveness + anti-spoof (vladmandic/human).
// El gate vive en el cliente; el techo de seguridad (cliente manipulable) es el
// mismo del id_empleado que ya confía el checador. Upgrade: verificar el embedding
// en una Edge Function con token HMAC.

export const UMBRAL_SIMILITUD = 0.60;
export const UMBRAL_VIVEZA    = 0.60; // face.live
export const UMBRAL_REAL      = 0.60; // face.real (anti-spoof)

// ponytail: si los modelos dan 404 en este path, cambiar a
// 'https://vladmandic.github.io/human-models/models/' (mismo set de modelos).
const CFG = {
  modelBasePath: 'https://cdn.jsdelivr.net/npm/@vladmandic/human/models/',
  backend: 'webgl',
  filter: { enabled: true },
  face: {
    enabled: true,
    detector: { rotation: false, maxDetected: 1 },
    mesh: { enabled: true },
    description: { enabled: true }, // embedding de identidad
    antispoof: { enabled: true },   // face.real
    liveness: { enabled: true },    // face.live
    iris: { enabled: false },
    emotion: { enabled: false },
  },
  body: { enabled: false },
  hand: { enabled: false },
  object: { enabled: false },
  gesture: { enabled: false },
};

let _human = null;

// Carga diferida: el import remoto (~10MB, cacheable) solo ocurre aquí, no al
// importar el módulo — así face.test.mjs corre bajo node sin tocar la red.
export async function cargarMotor() {
  if (_human) return _human;
  const { default: Human } = await import('https://cdn.jsdelivr.net/npm/@vladmandic/human/dist/human.esm.js');
  _human = new Human(CFG);
  await _human.load();
  await _human.warmup();
  return _human;
}

export async function analizar(videoEl) {
  if (!_human) await cargarMotor();
  const res = await _human.detect(videoEl);
  const f = res.face && res.face[0];
  if (!f || !f.embedding) return null;
  return {
    embedding: f.embedding,
    live: f.live ?? 0,
    real: f.real ?? 0,
    box:  f.box,
  };
}

// Similitud coseno → 0..1 (1 = idénticos). Propia (no human.similarity) para que
// el self-check corra offline.
export function similitud(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  if (na === 0 || nb === 0) return 0;
  return Math.max(0, dot / (Math.sqrt(na) * Math.sqrt(nb)));
}
