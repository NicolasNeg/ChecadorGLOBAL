export const corsHeaders: HeadersInit = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, apikey, content-type, x-checador-token',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export function handleOptions(): Response {
  return new Response(null, { status: 204, headers: corsHeaders });
}
