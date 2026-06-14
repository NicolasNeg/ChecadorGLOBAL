import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { verificarToken } from '../_shared/token.ts';

const MAX_BYTES = 8 * 1024 * 1024; // 8 MB

function dataURLtoBytes(dataURL: string, expectedMime: RegExp): Uint8Array | null {
  const match = dataURL.match(/^data:(image\/(?:jpeg|png));base64,(.+)$/);
  if (!match || !expectedMime.test(match[1])) return null;
  const raw = atob(match[2]);
  const buf = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) buf[i] = raw.charCodeAt(i);
  return buf;
}

function rand6(): string {
  return Math.random().toString(36).slice(2, 8);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions();

  const token = req.headers.get('x-checador-token') ?? '';
  const idEmpleado = await verificarToken(token);
  if (!idEmpleado) {
    return Response.json(
      { ok: false, error: 'No autorizado' },
      { status: 401, headers: corsHeaders }
    );
  }

  try {
    const { tipoChecada, foto, firma, latitud, longitud } = await req.json();

    // Validaciones de entrada
    if (!['entrada', 'salida'].includes(tipoChecada)) {
      return Response.json({ ok: false, error: 'tipo inválido' }, { status: 400, headers: corsHeaders });
    }
    if (typeof latitud !== 'number' || latitud < -90 || latitud > 90) {
      return Response.json({ ok: false, error: 'latitud inválida' }, { status: 400, headers: corsHeaders });
    }
    if (typeof longitud !== 'number' || longitud < -180 || longitud > 180) {
      return Response.json({ ok: false, error: 'longitud inválida' }, { status: 400, headers: corsHeaders });
    }

    const fotoBytes = dataURLtoBytes(foto, /^image\/jpeg$/);
    if (!fotoBytes || fotoBytes.length > MAX_BYTES) {
      return Response.json({ ok: false, error: 'foto inválida o muy grande' }, { status: 400, headers: corsHeaders });
    }
    const firmaBytes = dataURLtoBytes(firma, /^image\/png$/);
    if (!firmaBytes || firmaBytes.length > MAX_BYTES) {
      return Response.json({ ok: false, error: 'firma inválida o muy grande' }, { status: 400, headers: corsHeaders });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const ts = Date.now();
    const rutaFoto  = `${idEmpleado}/${ts}-${rand6()}.jpg`;
    const rutaFirma = `${idEmpleado}/${ts}-${rand6()}.png`;

    const [uploadFoto, uploadFirma] = await Promise.all([
      supabase.storage.from('fotos').upload(rutaFoto, fotoBytes, { contentType: 'image/jpeg' }),
      supabase.storage.from('firmas').upload(rutaFirma, firmaBytes, { contentType: 'image/png' }),
    ]);

    if (uploadFoto.error) throw uploadFoto.error;
    if (uploadFirma.error) throw uploadFirma.error;

    const { error: dbError } = await supabase.from('registros').insert({
      id_empleado: idEmpleado,
      tipo: tipoChecada,
      hora: new Date().toISOString(),
      latitud,
      longitud,
      ruta_foto: rutaFoto,
      ruta_firma: rutaFirma,
    });

    if (dbError) throw dbError;

    return Response.json({ ok: true }, { headers: corsHeaders });
  } catch (err) {
    console.error('guardar-registro:', err);
    return Response.json({ ok: false, error: 'Error interno' }, { status: 500, headers: corsHeaders });
  }
});
