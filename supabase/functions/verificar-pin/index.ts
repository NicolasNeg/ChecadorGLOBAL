import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { firmarToken } from '../_shared/token.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions();

  try {
    const { pin } = await req.json();

    if (typeof pin !== 'string' || !/^\d{3,10}$/.test(pin)) {
      return Response.json(
        { ok: false, error: 'PIN inválido' },
        { status: 400, headers: corsHeaders }
      );
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { data, error } = await supabase.rpc('verificar_pin', { p_pin: pin });

    if (error) throw error;

    if (!data || data.length === 0) {
      return Response.json(
        { ok: false, error: 'PIN no reconocido' },
        { status: 200, headers: corsHeaders }
      );
    }

    const empleado = data[0] as { id: number; nombre: string };
    const token = await firmarToken(empleado.id);

    return Response.json(
      { ok: true, idEmpleado: empleado.id, nombre: empleado.nombre, token },
      { headers: corsHeaders }
    );
  } catch (err) {
    console.error('verificar-pin:', err);
    return Response.json(
      { ok: false, error: 'Error interno' },
      { status: 500, headers: corsHeaders }
    );
  }
});
