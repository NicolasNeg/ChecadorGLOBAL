const SECRET = () => {
  const s = Deno.env.get('TOKEN_SECRET');
  if (!s) throw new Error('TOKEN_SECRET no configurado');
  return new TextEncoder().encode(s);
};

const SESSION_TTL = 8 * 60 * 60; // 8 horas en segundos

async function hmac(key: Uint8Array, data: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

export async function firmarToken(idEmpleado: number): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL;
  const payload = `${idEmpleado}.${exp}`;
  const firma = await hmac(SECRET(), payload);
  return `${payload}.${firma}`;
}

export async function verificarToken(token: string): Promise<number | null> {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [idStr, expStr, firma] = parts;
    const payload = `${idStr}.${expStr}`;
    const firmaEsperada = await hmac(SECRET(), payload);

    // comparación en tiempo constante
    const a = new TextEncoder().encode(firma);
    const b = new TextEncoder().encode(firmaEsperada);
    if (a.length !== b.length) return null;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
    if (diff !== 0) return null;

    const exp = parseInt(expStr, 10);
    if (Math.floor(Date.now() / 1000) > exp) return null;

    const id = parseInt(idStr, 10);
    return Number.isFinite(id) ? id : null;
  } catch {
    return null;
  }
}
