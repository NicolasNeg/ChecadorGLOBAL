# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project is

EQS Checador — mobile-first attendance app (check-in / check-out) with an admin dashboard.  
No build step. No frameworks. No PHP.

- **Frontend**: HTML + CSS + ES Modules (vanilla), **multi-page** static site. Deployed to **Vercel** and **GitHub Pages** (`nicolasneg.github.io/ChecadorGLOBAL/`).
- **Backend**: Supabase Postgres + Storage. Edge Functions (Deno/TypeScript) exist but are **not currently wired up** — see "Architectural split".
- **Employee auth**: numeric PIN hashed with pgcrypto `crypt()`, verified by the `verificar_pin` RPC (SECURITY DEFINER). The current frontend calls Supabase REST/RPC directly with the anon key; it does **not** use the Edge Function HMAC token yet.
- **Admin auth**: Supabase Auth (email + password → JWT). RBAC via `perfiles_admin` + RLS helpers `mi_rol()` / `mi_plaza_id()`.

### GitHub Pages base path

Repo serves at `/ChecadorGLOBAL/`, so **absolute paths (`/assets/...`) break there**. Two mechanisms keep paths working on both hosts:
- Every HTML file's first `<head>` element is an inline script that creates a `<base>` tag (`/ChecadorGLOBAL/` on github.io, `/` elsewhere). All HTML asset paths are **relative** (`assets/...`, not `/assets/...`).
- `assets/js/config.js` exports `BASE` (`'/ChecadorGLOBAL'` on github.io, `''` elsewhere). All JS navigation uses `BASE + '/path'`.

## Commands

### Supabase (requires Supabase CLI installed and project linked)

```bash
supabase link --project-ref <REF>   # link once
supabase db push                    # apply ALL migrations in supabase/migrations/ (0001 … 0006)
supabase db seed                    # re-seed demo employees (María López PIN 1234, Carlos Pérez PIN 5678) + a demo shift
```

Migrations are ordered and cumulative — `supabase db push` applies every `NNNN_*.sql` in order:
- `0001_init` — empleados, registros, `verificar_pin`, private buckets
- `0002_rls_policies` — anon INSERT/SELECT (the broad SELECT is later dropped)
- `0003_grant_anon_pin` — grant `verificar_pin` to anon
- `0004_admin_schema` — plazas, turnos, perfiles_admin, audit_log, geocerca trigger, admin RBAC + RLS
- `0005_storage_policies` — make `fotos`/`firmas` buckets **public** + anon insert/read
- `0006_empleados_perfil` — professional profile fields, `verificar_pin` returns full profile, history RPCs, **drops the broad anon SELECT**

The Edge Functions (`supabase functions deploy …`, `TOKEN_SECRET`) are **not deployed/used** by the current frontend; only run those if you wire up the Edge Function path.

Prefer creating employees through the admin dashboard (`crear_empleado` RPC hashes the PIN server-side). Direct SQL still works:
```sql
insert into empleados (nombre, pin_hash, activo, numero_empleado, puesto)
values ('Nombre Completo', crypt('<PIN>', gen_salt('bf')), true, 'EQS-003', 'Puesto');
```

### Frontend (no build)

```bash
npx serve .   # use ngrok or similar tunnel for HTTPS on mobile (camera + geolocation require HTTPS)
```

Vercel deploys the repo root as a static site — no framework preset, no output directory config needed. `vercel.json` sets `Permissions-Policy: camera=(self), geolocation=(self)` on all responses.

## Architecture

### Architectural split: api.js vs. Edge Functions

**This is the most important thing to understand.** The codebase has two parallel implementations:

- **`assets/js/api.js`** (what the frontend currently uses): calls the Supabase **REST API / RPCs directly** using the anon key. It stores `_idEmpleado` from `verificar_pin` in a module-level variable (set on login, or via `setIdEmpleado()` on history/checador pages that restore it from `sessionStorage`) and passes it to inserts and history RPCs.

- **`supabase/functions/`** (the intended secure path): Edge Functions that use the service role key and issue/verify a proper HMAC token. They exist but the current `api.js` does **not call them**, and they are not deployed.

If you wire `api.js` to the Edge Functions, it must send `x-checador-token` (received from `verificar-pin`) and stop sending `id_empleado` from the client.

### Security model (current — anon key + RPCs)

The client holds only the **anon key** (public). The security boundary is **SECURITY DEFINER RPCs** + tight RLS, not Edge Functions:

- **PIN**: `verificar_pin(p_pin)` (SECURITY DEFINER, granted to anon + service_role) returns the employee's full profile + assigned plaza/turno only when the PIN hash matches. PIN hashes never leave the DB.
- **History**: `obtener_historial(p_id_empleado)` and `ultima_entrada(p_id_empleado)` are SECURITY DEFINER RPCs that filter by employee server-side. The old broad `anon SELECT on registros` policy was **dropped** in `0006` — anon can no longer bulk-read the table; reads go only through these RPCs.
- **Writes**: `registros` INSERT is still a direct anon REST insert (`anon_insert_registros` policy). The geocerca BEFORE-INSERT trigger validates/blocks based on the employee's assigned plaza.

**Known ceiling (MVP):** the history RPCs trust the `id_empleado` the client passes — a tampered client could request another employee's id. The real fix is the HMAC token path (Edge Functions) so the id comes from a signed token, not the client. Flagged in `0006_empleados_perfil.sql`.

### Admin dashboard (`/admin/`, `/admin/dashboard/`)

Separate SPA (hash routing, lazy-loaded modules in `assets/js/admin/`). Auth = Supabase Auth (email/password → JWT in `sessionStorage['eqs_admin_session']`); the JWT goes in the `Authorization` header so PostgREST enforces RLS automatically. RBAC: `rh` (super admin, all plazas) vs `jefe` (limited to `mi_plaza_id()`). Manages plazas (geocercas), turnos, empleados, real-time asistencia, and an audit log.

### Frontend page + module map

Multi-page, not a SPA. Each page is its own HTML file with its own entry module; `sesion` state is restored from `sessionStorage` (via `auth.js`) on each page load.

```
index.html        → app.js     login (PIN) + welcome menu
checador/         → checador.js tipo→firma→foto flow + success overlay
historial/        → historial-page.js  per-user history table + lightbox
admin/, admin/dashboard/ → assets/js/admin/* (separate auth + RBAC, see above)

shared employee modules:
  auth.js       ← session persistence (sessionStorage), requireSession()
  api.js        ← REST/RPC wrapper; _idEmpleado in module scope, setIdEmpleado() to restore
  config.js     ← SUPABASE_URL, SUPABASE_ANON_KEY, REST_BASE, BASE (GitHub Pages prefix)
  permisos.js   ← getUserMedia + watchPosition (blocking gate)
  firma.js      ← SignaturePad (ESM from jsDelivr) + devicePixelRatio scaling
  camara.js     ← video preview + canvas JPEG capture
  historial.js  ← table render + lightbox helpers
```

Within a page, "screens" are `hidden`-toggled `<div>`/`<section>` blocks (e.g. `app.js` toggles `.pantalla`; `checador.js` toggles `s-tipo`/`s-firma`/`s-foto`). `[hidden] { display: none !important; }` in base.css enforces this over `display:flex`.

### Edge Function layout (present but unused)

These exist as the intended HMAC-token secure path but are **not deployed** and the frontend does not call them.

```
supabase/functions/
├─ _shared/cors.ts    ← CORS headers (Access-Control-Allow-Origin: *) + OPTIONS 204 handler
├─ _shared/token.ts   ← firmarToken() / verificarToken() (HMAC-SHA256, timing-safe compare)
├─ verificar-pin/     ← POST {pin} → {ok, idEmpleado, nombre, token}
├─ guardar-registro/  ← POST + x-checador-token: validates input, uploads photo+signature, inserts row
└─ obtener-historial/ ← POST + x-checador-token: queries registros for the token's idEmpleado, returns signed URLs (1 h)
```

### Database

- **`empleados`**: `id, nombre, pin_hash, activo` + profile columns added in `0006` (`numero_empleado, puesto, email, telefono, fecha_ingreso, rol`) + `turno_id`, `plaza_id` (from the admin schema, `0004`).
- **`registros`**: `id_empleado, tipo, hora, latitud, longitud, ruta_foto, ruta_firma` + geocerca columns (`geocerca_valida`, `distancia_metros`). Server always sets `hora` server-side; never trusts the client clock.
- **`plazas`** (geocerca: lat/lon/radio_metros) and **`turnos`** (hora_entrada/salida), plus admin RBAC tables (`perfiles_admin`) from `0004`.
- **Storage**: `fotos` (JPEG) and `firmas` (PNG) buckets, made **public** in `0005` with anon insert + read policies so the history view can show photos by public URL.

RLS: anon can INSERT `registros` and call the SECURITY DEFINER RPCs (`verificar_pin`, `obtener_historial`, `ultima_entrada`); the broad anon SELECT on `registros` was dropped in `0006`. Admin tables use authenticated-role policies scoped by `mi_rol()` / `mi_plaza_id()`. No anon UPDATE/DELETE anywhere.

### UI patterns

- **Loading overlay** (`#overlay-cargando`): shown during `guardarRegistro` to prevent duplicate taps. Hidden on both success and failure in `finally`.
- **Disabled buttons**: `btn-continuar-pin` and `btn-confirmar-foto` are disabled and relabeled while their async operation is in flight, then restored in `finally`.
- **Blocked permissions message** (`#msg-bloqueado`): appears inside the permissions screen when camera or location is `'bloqueada'`, explaining how to re-enable via browser settings.

## Key constraints

- `assets/js/config.js` contains only the **anon key** (public). Never put `service_role` or `TOKEN_SECRET` there.
- Camera and geolocation require HTTPS — always test on Vercel/GitHub Pages or a tunnel, not plain `http://localhost`.
- Every page's `<head>` must start with the inline `<base>` script (sets `/ChecadorGLOBAL/` on GitHub Pages, `/` elsewhere); all asset/nav paths must be relative so they resolve under both. See "GitHub Pages base path".
- SignaturePad is loaded as ESM from `https://cdn.jsdelivr.net/npm/signature_pad@5/dist/signature_pad.esm.js` — no local copy needed.
- New tables/columns/policies go in a new numbered migration (`000N_*.sql`), kept idempotent (`drop ... if exists`, `on conflict`). Never edit an already-applied migration.
- Security boundary is SECURITY DEFINER RPCs + RLS, not the (unused) Edge Functions. The history RPCs trust the client-supplied `id_empleado` — known MVP ceiling; HMAC token path is the upgrade.
