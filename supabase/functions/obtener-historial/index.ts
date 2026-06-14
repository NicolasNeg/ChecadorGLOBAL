import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { verificarToken } from '../_shared/token.ts';

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
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { data, error } = await supabase
      .from('registros')
      .select('id, hora, tipo, latitud, longitud, ruta_foto')
      .eq('id_empleado', idEmpleado)
      .order('hora', { ascending: false })
      .limit(200);

    if (error) throw error;

    const registros = await Promise.all(
      (data ?? []).map(async (r) => {
        let fotoUrl: string | null = null;
        if (r.ruta_foto) {
          const { data: signed } = await supabase.storage
            .from('fotos')
            .createSignedUrl(r.ruta_foto, 3600);
          fotoUrl = signed?.signedUrl ?? null;
        }
        return {
          id:       r.id,
          hora:     r.hora,
          tipo:     r.tipo,
          latitud:  r.latitud,
          longitud: r.longitud,
          foto:     fotoUrl,
        };
      })
    );

    return Response.json(registros, { headers: corsHeaders });
  } catch (err) {
    console.error('obtener-historial:', err);
    return Response.json({ ok: false, error: 'Error interno' }, { status: 500, headers: corsHeaders });
  }
});
