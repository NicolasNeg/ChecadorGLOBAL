# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project is

EQS Checador — mobile-first attendance app (check-in / check-out).  
No build step. No frameworks. No PHP.

- **Frontend**: HTML + CSS + ES Modules (vanilla), served as a static site from Vercel.
- **Backend**: Supabase Edge Functions (Deno/TypeScript) + Postgres + Storage.
- **Auth**: numeric PIN hashed with pgcrypto `crypt()`; the server issues a short-lived HMAC token the client stores in memory and passes as `x-checador-token`.

## Commands

### Supabase (requires Supabase CLI installed and project linked)

```bash
supabase link --project-ref <REF>   # link once
supabase db push                    # apply migrations
supabase db seed                    # insert test employees
supabase secrets set TOKEN_SECRET=<64-char random>
supabase functions deploy verificar-pin guardar-registro obtener-historial
supabase functions serve            # local dev with hot-reload
```

### Frontend (no build)

Open `index.html` directly with a local HTTPS server (camera + geolocation require HTTPS):

```bash
npx serve .         # or any static server; use a tunnel (ngrok) for HTTPS on mobile
```

Vercel deploys the repo root as a static site — no framework preset, no output directory config needed.

## Architecture

### Security model

The client holds only the **anon key** (public). All DB reads/writes go through Edge Functions using the **service role key** (server-side only). RLS is enabled on both tables with no anon policies — pure deny-by-default.

PIN flow: `verificar-pin` calls the `verificar_pin(text)` RPC (security definer, granted only to service_role). On success it returns an HMAC token signed with `TOKEN_SECRET`. The other two functions extract `idEmpleado` from that token — the client never sends its own ID.

### Frontend module graph

```
app.js          ← orchestrates screens and state
├─ permisos.js  ← getUserMedia + watchPosition (blocking gate)
├─ firma.js     ← SignaturePad (ESM from jsDelivr) + devicePixelRatio scaling
├─ camara.js    ← video preview + canvas JPEG capture
├─ historial.js ← table render + lightbox
└─ api.js       ← fetch wrapper; stores token in module-level variable
   └─ config.js ← SUPABASE_URL, SUPABASE_ANON_KEY, FUNCTIONS_BASE
```

`app.js` drives a single-page flow by toggling `hidden` on `<section class="pantalla">` elements. There is no router.

### Edge Function layout

```
supabase/functions/
├─ _shared/cors.ts    ← CORS headers + OPTIONS handler
├─ _shared/token.ts   ← firmarToken() / verificarToken() (HMAC-SHA256, timing-safe)
├─ verificar-pin/     ← POST: validates PIN via RPC, returns token
├─ guardar-registro/  ← POST + x-checador-token: uploads photo+signature to Storage, inserts row
└─ obtener-historial/ ← POST + x-checador-token: queries registros, generates signed URLs
```

All functions import from `https://esm.sh/@supabase/supabase-js@2` and `_shared/` via relative paths.

### Database

Two tables: `empleados` and `registros`. Photos go to the `fotos` bucket, signatures to `firmas` — both private. Historial signed URLs expire in 1 hour. Server always uses `new Date().toISOString()` for `hora`; never trusts the client clock.

## Key constraints

- `assets/js/config.js` contains only the **anon key** (public). Never put `service_role` or `TOKEN_SECRET` there.
- Camera and geolocation require HTTPS — always test on Vercel or a tunnel, not plain `http://localhost`.
- SignaturePad is loaded as ESM from `https://cdn.jsdelivr.net/npm/signature_pad@5/dist/signature_pad.esm.js` — no local copy needed.
- Edge Functions must respond to `OPTIONS` with 204 and include CORS headers on every response.
- `guardar-registro` validates image size (< 8 MB decoded), mime type, and coordinate ranges before touching Storage.
