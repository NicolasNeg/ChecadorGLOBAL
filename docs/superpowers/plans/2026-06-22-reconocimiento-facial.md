# Reconocimiento facial en el checador — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Antes de "Tomar foto", verificar en vivo que el rostro es de la persona correcta (con prueba de vida/anti-spoof); el botón queda bloqueado hasta el match o hasta el escape de 15s.

**Architecture:** Gate **client-side** en la pantalla de foto del checador. `face.js` envuelve la librería `@vladmandic/human` (carga diferida desde CDN) y expone detección + embedding + liveness + anti-spoof. `checador.js` corre un bucle de verificación (~400ms) que habilita el botón al hacer match contra el `face_descriptor` del empleado (o auto-registra el rostro la primera vez). El resultado (`rostro_verificado`, `viveza`, `similitud`) se graba en cada `registros` para que RH lo revise.

**Tech Stack:** Vanilla ES Modules (sin build), `@vladmandic/human` (ESM vía jsDelivr), Supabase REST/RPC + anon key, CSS puro.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-06-22-reconocimiento-facial-design.md`.
- **Depende de la migración `0023`** (resolución de turno del día). `0024` redefine `verificar_pin` y **debe partir del cuerpo de `0023`** (cascada de turno por fecha) y solo añadir `face_descriptor` — nunca volver al join estático `e.turno_id`.
- Migración nueva, numerada, **idempotente** (`add column if not exists`, `create or replace`, `drop function if exists`). Nunca editar una migración aplicada.
- `assets/js/config.js` solo contiene el **anon key** (público). Nunca `service_role` ni `TOKEN_SECRET`.
- Frontera de seguridad: SECURITY DEFINER RPCs + RLS. El match es client-side (techo MVP conocido, igual que el `id_empleado` que ya confía el cliente); upgrade path = Edge Function con token HMAC.
- Umbrales (constantes ajustables en `face.js`): `UMBRAL_SIMILITUD = 0.60`, `UMBRAL_VIVEZA = 0.60` (`face.live`), `UMBRAL_REAL = 0.60` (`face.real`).
- Privacidad (LFPDPPP): se almacena el **vector de embedding**, nunca la imagen. Requiere aviso/consentimiento al auto-registrar (fuera del alcance de código).
- Accesibilidad no negociable: chip `role="status" aria-live="polite"`; `@media (prefers-reduced-motion: reduce)` desactiva escaneo/shake/pop/shimmer; botones ≥44px; el estado nunca se comunica solo por color (icono + texto siempre).
- Animaciones: solo `transform`/`opacity`, 150–300ms, ease-out al entrar / ease-in al salir.
- Todo texto visible pasa por `t()` de `i18n.js` (ES/EN).
- Cámara/geolocalización requieren HTTPS; probar en Vercel/GitHub Pages/túnel.
- `supabase db push` pendiente de autorización del usuario.
- Cerrar cada cambio con `git add . && git commit && git push` (trailer `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`).

> **Nota de alcance (ponytail):** se descarta devolver `foto_url` desde `verificar_pin`. La referencia es el `face_descriptor`; el flujo híbrido auto-registra el rostro desde la cámara en vivo la primera vez, así que no se necesita convertir la foto de perfil a embedding. Añadir `foto_url` solo si más adelante se quiere pre-sembrar el descriptor desde la foto de perfil.

---

### Task 1: Migración `0024` — columnas + `verificar_pin` con descriptor + RPC de registro

**Files:**
- Create: `supabase/migrations/0024_reconocimiento_facial.sql`
- Test: `supabase/tests/0024_facial.sql`

**Interfaces:**
- Consumes: `verificar_pin` tal como queda en `0023` (cascada de turno); tablas `empleados`, `registros`, `turnos`, `plazas`, `turnos_dia`, `horarios_semana`.
- Produces:
  - `empleados.face_descriptor jsonb`
  - `registros.rostro_verificado boolean not null default false`, `registros.viveza numeric`, `registros.similitud numeric`
  - `verificar_pin(p_pin text)` → contrato de `0023` **+ columna final `face_descriptor jsonb`** (14 columnas).
  - `registrar_descriptor_facial(p_id_empleado bigint, p_descriptor jsonb)` → void; grant a anon.

- [ ] **Step 1: Escribir la migración**

Crear `supabase/migrations/0024_reconocimiento_facial.sql`:

```sql
-- ═══════════════════════════════════════════════════════════════════════════
-- 0024: reconocimiento facial. Vector de embedding en empleados (NO la imagen),
-- resultado de verificación por registro, y verificar_pin devuelve el descriptor.
-- verificar_pin conserva la cascada de turno de 0023 y SOLO añade face_descriptor.
-- ═══════════════════════════════════════════════════════════════════════════

alter table empleados  add column if not exists face_descriptor jsonb;
alter table registros  add column if not exists rostro_verificado boolean not null default false;
alter table registros  add column if not exists viveza            numeric;
alter table registros  add column if not exists similitud         numeric;

-- ── verificar_pin: cascada de turno (0023) + face_descriptor ────────────────
drop function if exists verificar_pin(text);
create function verificar_pin(p_pin text)
returns table(
  id              bigint,
  nombre          text,
  numero_empleado text,
  puesto          text,
  email           text,
  telefono        text,
  rol             text,
  plaza_id        bigint,
  turno_id        bigint,
  plaza_nombre    text,
  turno_nombre    text,
  turno_entrada   time,
  turno_salida    time,
  face_descriptor jsonb
)
language sql security definer set search_path = public, extensions
as $$
  with emp as (
    select e.* from empleados e
    where e.activo = true and e.pin_hash = crypt(p_pin, e.pin_hash)
    limit 1
  ),
  resuelto as (
    select emp.*,
      coalesce(
        (select d.turno_id from turnos_dia d
          where d.id_empleado = emp.id and d.fecha = current_date),
        case
          when exists (select 1 from turnos_dia d where d.id_empleado = emp.id)
            then null
          else coalesce(
            (select h.turno_id from horarios_semana h
              where h.id_empleado = emp.id
                and h.dia_semana = extract(isodow from current_date)::int),
            emp.turno_id
          )
        end
      ) as turno_efectivo_id
    from emp
  )
  select r.id, r.nombre, r.numero_empleado, r.puesto, r.email, r.telefono, r.rol,
         r.plaza_id, r.turno_efectivo_id,
         p.nombre, t.nombre, t.hora_entrada, t.hora_salida,
         r.face_descriptor
  from   resuelto r
  left join plazas p on p.id = r.plaza_id
  left join turnos t on t.id = r.turno_efectivo_id;
$$;
revoke all on function verificar_pin(text) from public, anon, authenticated;
grant  execute on function verificar_pin(text) to service_role, anon;

-- ── Registrar/actualizar el descriptor facial (auto-enroll, anon) ───────────
-- ponytail: confía en el id que pasa el cliente, igual que obtener_historial.
-- Upgrade: derivar el id de un token HMAC firmado (Edge Functions).
-- El UPDATE queda auditado por el trigger fn_audit_log de empleados → aparece
-- en "Historial de cambios".
create or replace function registrar_descriptor_facial(p_id_empleado bigint, p_descriptor jsonb)
returns void
language sql security definer set search_path = public as $$
  update empleados set face_descriptor = p_descriptor where id = p_id_empleado;
$$;
revoke all on function registrar_descriptor_facial(bigint, jsonb) from public;
grant  execute on function registrar_descriptor_facial(bigint, jsonb) to anon, service_role;
```

- [ ] **Step 2: Escribir el script de verificación**

Crear `supabase/tests/0024_facial.sql`:

```sql
-- Verifica: verificar_pin devuelve face_descriptor y conserva la resolución de
-- turno de 0023; registrar_descriptor_facial persiste el vector.
-- Corre: supabase db query --linked --file supabase/tests/0024_facial.sql
-- Esperado: "OK 0024". Hace rollback.
begin;

insert into turnos (id, nombre, hora_entrada, hora_salida)
  values (9201, 'TEST T 0024', '08:00', '16:00') on conflict (id) do nothing;
insert into empleados (id, nombre, pin_hash, activo, turno_id)
  values (9201, 'TEST 0024', crypt('8888', gen_salt('bf')), true, 9201)
  on conflict (id) do nothing;

-- Sin descriptor: verificar_pin devuelve NULL en face_descriptor pero sí el turno fijo.
do $$ declare d jsonb; tn text; begin
  select face_descriptor, turno_nombre into d, tn from verificar_pin('8888');
  if d is not null then raise exception 'face_descriptor debería ser NULL: %', d; end if;
  if tn is distinct from 'TEST T 0024' then raise exception 'turno_nombre roto: %', tn; end if;
end $$;

-- Tras registrar el descriptor: verificar_pin lo devuelve.
select registrar_descriptor_facial(9201, '[0.1,0.2,0.3]'::jsonb);
do $$ declare d jsonb; begin
  select face_descriptor into d from verificar_pin('8888');
  if d is distinct from '[0.1,0.2,0.3]'::jsonb then
    raise exception 'face_descriptor no persistió: %', d;
  end if;
end $$;

select 'OK 0024' as resultado;
rollback;
```

- [ ] **Step 3: Aplicar y verificar**

Run: `supabase db push`
Expected: aplica `0024` sin error.

Run: `supabase db query --linked --file supabase/tests/0024_facial.sql`
Expected: fila `OK 0024`, sin excepciones.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0024_reconocimiento_facial.sql supabase/tests/0024_facial.sql
git commit -m "feat(db): descriptor facial + resultado de verificación por registro

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git push
```

---

### Task 2: Módulo `face.js` (motor Human + similitud)

**Files:**
- Create: `assets/js/face.js`
- Test: `assets/js/face.test.mjs`

**Interfaces:**
- Produces:
  - `cargarMotor()` → `Promise<Human>` (idempotente; importa Human de forma diferida).
  - `analizar(videoEl)` → `Promise<{embedding:number[], live:number, real:number, box:number[]}|null>`.
  - `similitud(a:number[], b:number[])` → `number` en 0..1 (1 = idénticos).
  - Constantes `UMBRAL_SIMILITUD`, `UMBRAL_VIVEZA`, `UMBRAL_REAL` (todas 0.60).

- [ ] **Step 1: Escribir el self-check (falla primero)**

Crear `assets/js/face.test.mjs`:

```js
import assert from 'node:assert';
import { similitud } from './face.js';

const v = [1, 2, 3, 4];
assert.ok(Math.abs(similitud(v, v) - 1) < 1e-9, 'idénticos → 1');
assert.strictEqual(similitud([1, 0], [0, 1]), 0, 'ortogonales → 0');
assert.strictEqual(similitud([1, 2, 3], [1, 2]), 0, 'distinta longitud → 0');
assert.strictEqual(similitud(null, [1]), 0, 'null → 0');
console.log('OK face.similitud');
```

Run: `node assets/js/face.test.mjs`
Expected: FAIL — `Cannot find module './face.js'`.

- [ ] **Step 2: Escribir `face.js`**

Crear `assets/js/face.js`:

```js
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
```

- [ ] **Step 3: Correr el self-check**

Run: `node assets/js/face.test.mjs`
Expected: `OK face.similitud`.

- [ ] **Step 4: Chequeo de sintaxis**

Run: `node --check assets/js/face.js`
Expected: sin salida (sintaxis OK).

- [ ] **Step 5: Commit**

```bash
git add assets/js/face.js assets/js/face.test.mjs
git commit -m "feat(checador): módulo face.js (Human + liveness + similitud coseno)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git push
```

---

### Task 3: `api.js` + `app.js` — descriptor en sesión, auto-enroll, grabar verificación

**Files:**
- Modify: `assets/js/api.js:30-45` (return de `verificarPin`), `assets/js/api.js:56` (firma+body de `guardarRegistro`), nueva función `guardarDescriptorFacial`
- Modify: `assets/js/app.js:118` (persistir `faceDescriptor` en la sesión)

**Interfaces:**
- Consumes: `verificar_pin` con `face_descriptor` (Task 1); `registrar_descriptor_facial` RPC (Task 1).
- Produces:
  - `verificarPin()` añade `faceDescriptor` al objeto devuelto.
  - `guardarDescriptorFacial(embedding:number[])` → `Promise<{ok:boolean}>`.
  - `guardarRegistro({..., rostroVerificado, viveza, similitud})` inserta esas 3 columnas.
  - La sesión en `sessionStorage` incluye `faceDescriptor`.

- [ ] **Step 1: `verificarPin` devuelve `faceDescriptor`**

En `assets/js/api.js`, dentro del objeto `return { ok: true, ... }` (después de `turnoSalida: e.turno_salida`), añadir:

```js
        turnoSalida:    e.turno_salida,
        faceDescriptor: e.face_descriptor ?? null
```

(añadir la coma tras `e.turno_salida`).

- [ ] **Step 2: `guardarRegistro` graba el resultado de verificación**

En `assets/js/api.js`, cambiar la firma:

```js
export async function guardarRegistro({ tipoChecada, foto, firma, latitud, longitud, rostroVerificado = false, viveza = null, similitud = null }) {
```

y en el `body` del insert a `registros`, añadir tras `ruta_firma: rutaFirma`:

```js
        ruta_firma: rutaFirma,
        rostro_verificado: rostroVerificado,
        viveza: viveza,
        similitud: similitud
```

(añadir la coma tras `rutaFirma`).

- [ ] **Step 3: Nueva función `guardarDescriptorFacial`**

En `assets/js/api.js`, después de `guardarRegistro` (antes de `obtenerHistorial`), añadir:

```js
// ── REGISTRAR DESCRIPTOR FACIAL (auto-enroll la primera vez) ────────────────
export async function guardarDescriptorFacial(embedding) {
  if (!_idEmpleado) return { ok: false };
  try {
    const r = await fetch(`${REST_BASE}/rpc/registrar_descriptor_facial`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
      },
      body: JSON.stringify({ p_id_empleado: _idEmpleado, p_descriptor: embedding })
    });
    return { ok: r.ok };
  } catch (e) {
    console.error('Error en guardarDescriptorFacial:', e);
    return { ok: false };
  }
}
```

- [ ] **Step 4: Persistir `faceDescriptor` en la sesión**

En `assets/js/app.js`, el objeto `perfil` que se pasa a `setSession(perfil)` (alrededor de la línea 118) se arma desde el resultado de `verificarPin`. Asegurar que incluya el descriptor. Localizar dónde se construye `perfil` y añadir `faceDescriptor: res.faceDescriptor`. Si `perfil` es directamente `res` (el objeto de `verificarPin`), ya lo incluye por el Step 1 — en ese caso no hay cambio y se verifica en el Step 5.

- [ ] **Step 5: Verificar contrato y sintaxis**

Run: `node --check assets/js/api.js && node --check assets/js/app.js`
Expected: sin salida.

Verificación manual del shape: en consola del navegador tras login, `JSON.parse(sessionStorage.getItem('eqs_session')).faceDescriptor` debe existir (null si el empleado aún no tiene descriptor).

- [ ] **Step 6: Commit**

```bash
git add assets/js/api.js assets/js/app.js
git commit -m "feat(checador): descriptor facial en sesión + grabar verificación por registro

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git push
```

---

### Task 4: Markup + CSS del gate (chip, anillo, animaciones, reduced-motion)

**Files:**
- Modify: `checador/index.html:92-105` (sec-video) y `:123-131` (btm-foto)
- Modify: `assets/css/checador.css` (añadir estilos del gate al final)

**Interfaces:**
- Produces (IDs que consume Task 5):
  - `#face-ring` (contenedor con `data-estado`), `#face-chip` (`role=status aria-live=polite`, `data-estado`), `#face-chip-icon`, `#face-chip-txt`.
  - `#btn-tomar-foto` con atributo `disabled` inicial.
  - `#btn-continuar-sin-verificar` (en `#btm-foto`, `hidden` inicial).

- [ ] **Step 1: Markup — envolver el video con anillo + chip**

En `checador/index.html`, reemplazar el bloque `#sec-video` (líneas 92-97) por:

```html
    <div id="sec-video">
      <p class="app-screen__sub" style="margin-bottom:12px" data-i18n>Mira directo a la cámara</p>
      <div class="camara-wrap">
        <div id="face-ring" class="face-ring" data-estado="cargando">
          <video id="video-preview" autoplay playsinline muted></video>
          <span class="face-ring__scan" aria-hidden="true"></span>
        </div>
      </div>
      <div id="face-chip" class="face-chip" role="status" aria-live="polite" data-estado="cargando">
        <span id="face-chip-icon" class="face-chip__icon" aria-hidden="true"></span>
        <span id="face-chip-txt" class="face-chip__txt" data-i18n>Cargando verificación…</span>
      </div>
    </div>
```

- [ ] **Step 2: Markup — botón deshabilitado + escape**

En `checador/index.html`, reemplazar el bloque `#btm-foto` (líneas 123-131) por:

```html
  <div id="btm-foto" class="app-bottom" hidden>
    <button id="btn-continuar-sin-verificar" class="btn btn--secundario" style="flex:1" hidden data-i18n>Continuar sin verificar</button>
    <button id="btn-tomar-foto" class="btn btn--primario" style="flex:2" disabled aria-disabled="true">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
        <circle cx="12" cy="13" r="4"/>
      </svg>
      <span data-i18n>Tomar foto</span>
    </button>
  </div>
```

- [ ] **Step 3: CSS — anillo, chip, estados y animaciones**

Añadir al final de `assets/css/checador.css`:

```css
/* ── Gate de reconocimiento facial ─────────────────────────────────────────── */
.face-ring {
  position: relative;
  border-radius: 18px;
  overflow: hidden;
  outline: 3px solid var(--c-borde, #d0d5dd);
  outline-offset: -3px;
  transition: outline-color 200ms ease-out;
}
.face-ring[data-estado="verificando"],
.face-ring[data-estado="liveness"],
.face-ring[data-estado="enrolando"] { outline-color: #f59e0b; }
.face-ring[data-estado="match"]     { outline-color: #16a34a; }

/* Línea de escaneo (solo mientras verifica/enrola) */
.face-ring__scan {
  position: absolute; left: 0; right: 0; top: 0; height: 3px;
  background: linear-gradient(90deg, transparent, #f59e0b, transparent);
  opacity: 0; pointer-events: none;
}
.face-ring[data-estado="verificando"] .face-ring__scan,
.face-ring[data-estado="enrolando"]   .face-ring__scan {
  opacity: 1; animation: face-scan 2s ease-in-out infinite;
}
@keyframes face-scan { 0% { transform: translateY(0); } 100% { transform: translateY(calc(var(--scan-h, 240px))); } }

/* Match: pulso de escala del anillo */
.face-ring[data-estado="match"] { animation: face-pop 250ms ease-out; }
@keyframes face-pop { 0% { transform: scale(0.97); } 60% { transform: scale(1.03); } 100% { transform: scale(1); } }

/* Liveness baja: shake sutil 1x */
.face-ring[data-estado="liveness"] { animation: face-shake 200ms ease-in-out; }
@keyframes face-shake { 0%,100% { transform: translateX(0); } 25% { transform: translateX(-4px); } 75% { transform: translateX(4px); } }

/* Chip de estado */
.face-chip {
  display: inline-flex; align-items: center; gap: 8px;
  margin: 12px auto 0; padding: 8px 14px;
  border-radius: 999px; font-size: 14px; font-weight: 600;
  background: #f2f4f7; color: #475467;
  transition: background 200ms ease-out, color 200ms ease-out;
}
.face-chip__icon { display: inline-flex; width: 18px; height: 18px; }
.face-chip[data-estado="verificando"],
.face-chip[data-estado="liveness"],
.face-chip[data-estado="enrolando"] { background: #fef0c7; color: #b54708; }
.face-chip[data-estado="match"]     { background: #dcfae6; color: #067647; }
.face-chip[data-estado="error"]     { background: #fee4e2; color: #b42318; }
/* spinner del icono mientras carga/enrola */
.face-chip[data-estado="cargando"] .face-chip__icon,
.face-chip[data-estado="enrolando"] .face-chip__icon { animation: face-spin 1s linear infinite; }
@keyframes face-spin { to { transform: rotate(360deg); } }

/* Botón "Tomar foto" deshabilitado y su desbloqueo */
#btn-tomar-foto[disabled] { opacity: .4; cursor: not-allowed; }
#btn-tomar-foto.face-listo { animation: face-pop 260ms ease-out; }

/* Respeto a usuarios que prefieren menos movimiento */
@media (prefers-reduced-motion: reduce) {
  .face-ring, .face-ring__scan, .face-chip, #btn-tomar-foto.face-listo { animation: none !important; }
  .face-ring__scan { display: none; }
  .face-ring, .face-chip { transition: outline-color 1ms, background 1ms, color 1ms; }
}
```

- [ ] **Step 4: Verificación visual estática**

Abrir `checador/index.html` con `npx serve .` (o túnel HTTPS). En la pantalla de foto, confirmar que el chip aparece bajo el video y que "Tomar foto" se ve atenuado/deshabilitado. (La lógica que cambia `data-estado` llega en Task 5.)

- [ ] **Step 5: Commit**

```bash
git add checador/index.html assets/css/checador.css
git commit -m "feat(checador): UI del gate facial (anillo, chip, animaciones, reduced-motion)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git push
```

---

### Task 5: `checador.js` — bucle del gate e integración

**Files:**
- Modify: `assets/js/checador.js` (import de face.js + api; `showFoto`; back/captura cleanup; `data`; llamada a `guardarRegistro`)

**Interfaces:**
- Consumes: `cargarMotor`, `analizar`, `similitud`, `UMBRAL_*` de `face.js`; `guardarDescriptorFacial` de `api.js`; `sesion.faceDescriptor`; IDs de Task 4.
- Produces: `data.rostroVerificado`, `data.viveza`, `data.similitud` que se pasan a `guardarRegistro`.

- [ ] **Step 1: Imports y estado del gate**

En `assets/js/checador.js`, añadir a los imports existentes:

```js
import { setIdEmpleado, guardarRegistro, obtenerUltimaEntrada, obtenerEstadoJornada, guardarDescriptorFacial } from './api.js';
import { cargarMotor, analizar, similitud, UMBRAL_SIMILITUD, UMBRAL_VIVEZA, UMBRAL_REAL } from './face.js';
```

(reemplaza la línea de import de `./api.js` por la primera; añade la segunda.)

Ampliar el objeto `data` (línea 39):

```js
const data = { tipo: null, firmaDataURL: null, fotoDataURL: null, rostroVerificado: false, viveza: null, similitud: null };
```

Añadir variables de módulo del gate (junto a `let timerId = null;`):

```js
let faceLoopId = null;   // intervalo de análisis
let faceEscapeId = null; // timeout de 15s
```

- [ ] **Step 2: Helpers del gate (chip + estado + detener)**

En `assets/js/checador.js`, añadir antes de `function showFoto()`:

```js
const FACE_ICON = {
  cargando:    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M21 12a9 9 0 1 1-6.2-8.5"/></svg>',
  sincara:     '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M9 10h.01M15 10h.01M9 15c1.5 1.2 4.5 1.2 6 0"/></svg>',
  verificando: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M21 12a9 9 0 1 1-6.2-8.5"/></svg>',
  liveness:    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
  enrolando:   '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M21 12a9 9 0 1 1-6.2-8.5"/></svg>',
  match:       '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
  error:       '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>',
};
const FACE_TXT = {
  cargando:    'Cargando verificación…',
  sincara:     'Coloca tu cara en el óvalo',
  verificando: 'Verificando…',
  liveness:    'Mira a la cámara, sin fotos',
  enrolando:   'Registrando tu rostro…',
  match:       'Identidad verificada',
  error:       'No se pudo verificar',
};

function setFaceEstado(estado) {
  const ring = document.getElementById('face-ring');
  const chip = document.getElementById('face-chip');
  if (ring) ring.dataset.estado = estado;
  if (chip) {
    chip.dataset.estado = estado;
    document.getElementById('face-chip-icon').innerHTML = FACE_ICON[estado] || '';
    document.getElementById('face-chip-txt').textContent = t(FACE_TXT[estado] || '');
  }
}

function detenerGateFacial() {
  if (faceLoopId)   { clearInterval(faceLoopId); faceLoopId = null; }
  if (faceEscapeId) { clearTimeout(faceEscapeId); faceEscapeId = null; }
}

function habilitarTomarFoto() {
  const btn = document.getElementById('btn-tomar-foto');
  btn.disabled = false;
  btn.removeAttribute('aria-disabled');
  btn.classList.add('face-listo');
  if (navigator.vibrate) navigator.vibrate(40);
}
```

- [ ] **Step 3: Reescribir `showFoto()` con el gate**

En `assets/js/checador.js`, reemplazar la función `showFoto()` (líneas 180-195) por:

```js
function showFoto() {
  current = 'foto';
  showOnly(sFoto, btmFoto);
  headerTitle.textContent = t('Foto de verificación');
  setDots(3);
  setError('error-camara', '');

  document.getElementById('sec-video').hidden   = false;
  document.getElementById('sec-preview').hidden = true;

  // Reset del gate: botón bloqueado, escape oculto.
  const btnFoto = document.getElementById('btn-tomar-foto');
  btnFoto.disabled = true; btnFoto.setAttribute('aria-disabled', 'true'); btnFoto.classList.remove('face-listo');
  const btnEscape = document.getElementById('btn-continuar-sin-verificar');
  btnEscape.hidden = true;
  data.rostroVerificado = false; data.viveza = null; data.similitud = null;

  const video = document.getElementById('video-preview');
  iniciarPreview(video, streamCamara);

  if (coordenadas.latitud != null && coordenadas.longitud != null) {
    direccionDesdeCoords(coordenadas.latitud, coordenadas.longitud);
  }

  iniciarGateFacial(video, btnEscape);
}

async function iniciarGateFacial(video, btnEscape) {
  detenerGateFacial();
  setFaceEstado('cargando');

  // Escape a 15s: permite checar sin verificar (queda rostro_verificado=false).
  faceEscapeId = setTimeout(() => {
    btnEscape.hidden = false;
    btnEscape.onclick = () => { detenerGateFacial(); data.rostroVerificado = false; habilitarTomarFoto(); };
  }, 15000);

  try {
    await cargarMotor();
  } catch (e) {
    console.error('Human no cargó:', e);
    setFaceEstado('error');
    btnEscape.hidden = false;
    btnEscape.onclick = () => { detenerGateFacial(); data.rostroVerificado = false; habilitarTomarFoto(); };
    return;
  }

  const referencia = sesion.faceDescriptor || null;
  let ocupado = false;

  faceLoopId = setInterval(async () => {
    if (ocupado || current !== 'foto') return;
    ocupado = true;
    try {
      const cara = await analizar(video);
      if (!cara) { setFaceEstado('sincara'); return; }
      if (cara.real < UMBRAL_REAL || cara.live < UMBRAL_VIVEZA) { setFaceEstado('liveness'); return; }

      if (!referencia) {
        // Auto-enroll: primer rostro válido se registra como referencia.
        setFaceEstado('enrolando');
        const r = await guardarDescriptorFacial(cara.embedding);
        if (r.ok) {
          sesion.faceDescriptor = cara.embedding;
          data.rostroVerificado = true; data.viveza = cara.live; data.similitud = 1;
          setFaceEstado('match'); detenerGateFacial(); habilitarTomarFoto();
        } else {
          setFaceEstado('error');
        }
        return;
      }

      const sim = similitud(cara.embedding, referencia);
      if (sim >= UMBRAL_SIMILITUD) {
        data.rostroVerificado = true; data.viveza = cara.live; data.similitud = sim;
        setFaceEstado('match'); detenerGateFacial(); habilitarTomarFoto();
      } else {
        setFaceEstado('verificando');
      }
    } catch (e) {
      console.error('Error en análisis facial:', e);
    } finally {
      ocupado = false;
    }
  }, 400);
}
```

- [ ] **Step 4: Detener el gate al salir de la pantalla o al capturar**

En `assets/js/checador.js`:

(a) En el handler de `btn-tomar-foto` (línea 197), añadir `detenerGateFacial();` como primera línea del callback.

(b) En el handler `btn-atras` (líneas 72-76), añadir `detenerGateFacial();` al inicio del callback (cubre volver de foto→firma).

(c) En `showFirma()` y `showTipo()`, añadir `detenerGateFacial();` al inicio (defensa: cualquier navegación fuera de foto apaga el bucle).

- [ ] **Step 5: Pasar el resultado a `guardarRegistro`**

En `assets/js/checador.js`, en el handler `btn-confirmar-foto` (línea 223), cambiar la llamada por:

```js
    res = await guardarRegistro({
      tipoChecada: data.tipo, foto: data.fotoDataURL, firma: data.firmaDataURL,
      latitud, longitud,
      rostroVerificado: data.rostroVerificado, viveza: data.viveza, similitud: data.similitud
    });
```

- [ ] **Step 6: Chequeo de sintaxis**

Run: `node --check assets/js/checador.js`
Expected: sin salida.

- [ ] **Step 7: Verificación manual (HTTPS)**

En túnel/Vercel: (1) empleado sin descriptor → auto-enroll, chip "Registrando…" → "Identidad verificada", botón se habilita; (2) re-login y checar → match directo habilita el botón; (3) mostrar una foto en pantalla a la cámara → chip "Mira a la cámara, sin fotos", botón sigue bloqueado; (4) esperar 15s sin cara → aparece "Continuar sin verificar", al pulsarlo se habilita el botón y la checada se graba con `rostro_verificado=false`.

- [ ] **Step 8: Commit**

```bash
git add assets/js/checador.js
git commit -m "feat(checador): gate de verificación facial en la pantalla de foto

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git push
```

---

### Task 6: Badge "Sin verificar" en el historial del admin

**Files:**
- Modify: `assets/js/admin/api.js:149-150` (select de `getRegistrosEmpleado`)
- Modify: `assets/js/admin/historial-empleado.js:373` (render del punto de la línea de tiempo)

**Interfaces:**
- Consumes: `registros.rostro_verificado` (Task 1).
- Produces: badge ámbar "Sin verificar" en cada checada con `rostro_verificado === false`.

- [ ] **Step 1: Incluir la columna en el fetch**

En `assets/js/admin/api.js`, en `getRegistrosEmpleado` (línea 150), añadir `,rostro_verificado` a la lista de `select`:

```js
  apiFetch(`registros?select=id,tipo,hora,latitud,longitud,geocerca_valida,distancia_metros,ruta_foto,ruta_firma,rostro_verificado` +
```

- [ ] **Step 2: Renderizar el badge**

En `assets/js/admin/historial-empleado.js` (línea 373), junto al badge existente de geocerca, añadir el de verificación. Reemplazar el fragmento:

```js
${r.geocerca_valida === false ? ` <span class="abadge abadge--red">${t('Fuera')}</span>` : ''}
```

por:

```js
${r.geocerca_valida === false ? ` <span class="abadge abadge--red">${t('Fuera')}</span>` : ''}${r.rostro_verificado === false ? ` <span class="abadge abadge--amber">${t('Sin verificar')}</span>` : ''}
```

- [ ] **Step 3: Asegurar el estilo del badge ámbar**

Run: `grep -n "abadge--amber" assets/css/estilos-admin.css`
Expected: si **no** existe, añadir al final de `assets/css/estilos-admin.css`:

```css
.abadge--amber { background: #fef0c7; color: #b54708; }
```

(Si ya existe, no añadir nada.)

- [ ] **Step 4: Chequeo de sintaxis**

Run: `node --check assets/js/admin/api.js && node --check assets/js/admin/historial-empleado.js`
Expected: sin salida.

- [ ] **Step 5: Commit**

```bash
git add assets/js/admin/api.js assets/js/admin/historial-empleado.js assets/css/estilos-admin.css
git commit -m "feat(admin): badge 'Sin verificar' en checadas sin reconocimiento facial

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git push
```

---

### Task 7: Traducciones (i18n EN)

**Files:**
- Modify: `assets/js/i18n.js` (diccionario EN)

**Interfaces:**
- Consumes: nada. Produces: claves EN para todos los textos nuevos del gate y el badge.

- [ ] **Step 1: Añadir las claves**

En `assets/js/i18n.js`, localizar el objeto del diccionario inglés (`en`) y añadir estas entradas (clave ES → valor EN). Mantener el estilo de las entradas existentes:

```js
  'Cargando verificación…': 'Loading verification…',
  'Coloca tu cara en el óvalo': 'Place your face in the oval',
  'Verificando…': 'Verifying…',
  'Mira a la cámara, sin fotos': 'Look at the camera, no photos',
  'Registrando tu rostro…': 'Registering your face…',
  'Identidad verificada': 'Identity verified',
  'No se pudo verificar': 'Could not verify',
  'Continuar sin verificar': 'Continue without verifying',
  'Sin verificar': 'Unverified',
```

- [ ] **Step 2: Chequeo de sintaxis**

Run: `node --check assets/js/i18n.js`
Expected: sin salida.

- [ ] **Step 3: Verificación**

Run: `node -e "import('./assets/js/i18n.js').then(m=>{}).catch(e=>{console.error(e);process.exit(1)})"`
Expected: sin error (el módulo parsea). Verificación visual: cambiar a EN en el checador y confirmar que el chip muestra inglés.

- [ ] **Step 4: Commit**

```bash
git add assets/js/i18n.js
git commit -m "i18n: traducciones EN del gate facial

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git push
```

---

## Self-Review

- **Cobertura del spec:**
  - `face.js` (cargarMotor/analizar/similitud/umbrales) → Task 2 ✅
  - migración 0024 (face_descriptor, rostro_verificado/viveza/similitud, verificar_pin+descriptor, registrar_descriptor_facial) → Task 1 ✅
  - acoplamiento con 0023 (conservar cascada de turno) → Task 1 Step 1 (cuerpo idéntico a 0023 + columna) y Global Constraints ✅
  - api.js (verificarPin+faceDescriptor, guardarDescriptorFacial, guardarRegistro con 3 columnas) → Task 3 ✅
  - HTML del checador (chip, anillo, botón disabled, escape) → Task 4 ✅
  - gate loop + auto-enroll + escape 15s + umbrales → Task 5 ✅
  - UX/animaciones + reduced-motion + aria-live + color-not-only → Task 4 (CSS) + Task 5 (icono+texto) ✅
  - badge admin → Task 6 ✅
  - i18n → Task 7 ✅
  - `foto_url`: descartado explícitamente (nota de alcance) ✅
- **Placeholders:** ninguno; todo el código está completo.
- **Consistencia de tipos:** `verificar_pin` devuelve `face_descriptor` (Task 1) → `verificarPin` mapea `faceDescriptor` (Task 3) → `sesion.faceDescriptor` (Task 3/5) → `referencia` en el loop (Task 5). `guardarRegistro` recibe `rostroVerificado/viveza/similitud` (Task 3) que `checador.js` pasa desde `data.*` (Task 5). IDs del DOM (`face-ring`, `face-chip`, `btn-continuar-sin-verificar`) definidos en Task 4 y usados en Task 5. Coherente.
- **Riesgo externo (ponytail):** las rutas CDN de Human (lib + modelos) son el único punto de incertidumbre; marcado con `// ponytail:` y path alterno en `face.js`. Se valida en la prueba manual de Task 5 Step 7.
