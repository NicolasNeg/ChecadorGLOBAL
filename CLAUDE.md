# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project is

EQS Checador — mobile-first attendance app (check-in / check-out).  
No build step. No frameworks. No PHP.

- **Frontend**: HTML + CSS + ES Modules (vanilla), served as a static site from Vercel.
- **Backend**: Supabase Edge Functions (Deno/TypeScript) + Postgres + Storage.
- **Auth**: numeric PIN hashed with pgcrypto `crypt()`; the Edge Functions issue an HMAC-SHA256 token the client stores in memory and passes as `x-checador-token`.

## Commands

### Supabase (requires Supabase CLI installed and project linked)

```bash
supabase link --project-ref <REF>   # link once
supabase db push                    # apply supabase/migrations/0001_init.sql
supabase db seed                    # insert test employees (María López PIN 1234, Carlos Pérez PIN 5678)
openssl rand -base64 48             # generate TOKEN_SECRET
supabase secrets set TOKEN_SECRET=<64-char random>
supabase functions deploy verificar-pin guardar-registro obtener-historial
supabase functions serve            # local dev with hot-reload

# Apply RLS policies (run after 0001_init.sql)
supabase db push
```

Add an employee directly via SQL:
```sql
insert into empleados (nombre, pin_hash, activo)
values ('Nombre Completo', crypt('<PIN>', gen_salt('bf')), true);
```

### Frontend (no build)

```bash
npx serve .   # use ngrok or similar tunnel for HTTPS on mobile (camera + geolocation require HTTPS)
```

Vercel deploys the repo root as a static site — no framework preset, no output directory config needed. `vercel.json` sets `Permissions-Policy: camera=(self), geolocation=(self)` on all responses.

## Architecture

### Architectural split: api.js vs. Edge Functions

**This is the most important thing to understand.** The codebase has two parallel implementations:

- **`assets/js/api.js`** (what the frontend currently uses): calls the Supabase **REST API directly** (`/rest/v1/rpc/verificar_pin`, `/rest/v1/registros`, `/storage/v1/object/…`) using the anon key. It stores `_idEmpleado` from the RPC response in a module-level variable and sends it to the DB insert.

- **`supabase/functions/`** (the intended secure path): Edge Functions that use the service role key and issue/verify a proper HMAC token. These are deployed but the current `api.js` does **not call them**.

The Edge Function flow described below is the intended architecture. If you wire `api.js` to call the Edge Functions instead of the REST API directly, `api.js` must send `x-checador-token` in requests (received from `verificar-pin`) and stop sending `id_empleado` from the client.

### Security model (Edge Functions)

The client holds only the **anon key** (public). All DB reads/writes go through Edge Functions using the **service role key** (server-side only). RLS is enabled on both tables with no anon policies — pure deny-by-default.

PIN flow: `verificar-pin` calls the `verificar_pin(text)` RPC (security definer, granted only to service_role). On success it returns an HMAC-SHA256 token (TTL: 8 hours, format: `${idEmpleado}.${exp}.${hmac}`). `guardar-registro` and `obtener-historial` extract `idEmpleado` from that token — the client never sends its own ID.

### Frontend module graph

```
app.js          ← orchestrates screens and state
├─ permisos.js  ← getUserMedia + watchPosition (blocking gate)
├─ firma.js     ← SignaturePad (ESM from jsDelivr) + devicePixelRatio scaling
├─ camara.js    ← video preview + canvas JPEG capture
├─ historial.js ← table render + lightbox
└─ api.js       ← fetch wrapper; stores _token (anon key) and _idEmpleado in module scope
   └─ config.js ← exports SUPABASE_URL, SUPABASE_ANON_KEY, REST_BASE
```

`app.js` drives a single-page flow by toggling `hidden` on `<section class="pantalla">` elements. There is no router. Screen state lives in the `sesion` object (nombre, tipo, fotoDataURL, firmaDataURL).

### Edge Function layout

```
supabase/functions/
├─ _shared/cors.ts    ← CORS headers (currently Access-Control-Allow-Origin: *) + OPTIONS 204 handler
├─ _shared/token.ts   ← firmarToken() / verificarToken() (HMAC-SHA256, timing-safe compare)
├─ verificar-pin/     ← POST {pin} → {ok, idEmpleado, nombre, token}
├─ guardar-registro/  ← POST + x-checador-token: validates input, uploads photo+signature, inserts row
└─ obtener-historial/ ← POST + x-checador-token: queries registros for the token's idEmpleado, returns signed URLs (1 h)
```

All functions import from `https://esm.sh/@supabase/supabase-js@2` and `_shared/` via relative paths.

### Database

Two tables: `empleados` (`id, nombre, pin_hash, activo`) and `registros` (`id_empleado, tipo, hora, latitud, longitud, ruta_foto, ruta_firma`). Photos go to the `fotos` bucket (JPEG), signatures to `firmas` (PNG) — both private. Server always uses `new Date().toISOString()` for `hora`; never trusts the client clock.

RLS policies (`0002_rls_policies.sql`): anon role can INSERT and SELECT on `registros`, and SELECT on `empleados`. No UPDATE or DELETE policies exist — those operations are blocked for anon by design.

### UI patterns

- **Loading overlay** (`#overlay-cargando`): shown during `guardarRegistro` to prevent duplicate taps. Hidden on both success and failure in `finally`.
- **Disabled buttons**: `btn-continuar-pin` and `btn-confirmar-foto` are disabled and relabeled while their async operation is in flight, then restored in `finally`.
- **Blocked permissions message** (`#msg-bloqueado`): appears inside the permissions screen when camera or location is `'bloqueada'`, explaining how to re-enable via browser settings.

## Key constraints

- `assets/js/config.js` contains only the **anon key** (public). Never put `service_role` or `TOKEN_SECRET` there.
- Camera and geolocation require HTTPS — always test on Vercel or a tunnel, not plain `http://localhost`.
- SignaturePad is loaded as ESM from `https://cdn.jsdelivr.net/npm/signature_pad@5/dist/signature_pad.esm.js` — no local copy needed.
- Edge Functions must respond to `OPTIONS` with 204 and include CORS headers on every response.
- `guardar-registro` validates: foto must be JPEG, firma must be PNG, both < 8 MB, coordinates in valid ranges.
- CORS is `*` in the MVP; restrict to your Vercel domain in production by editing `_shared/cors.ts`.
