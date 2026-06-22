# Reconocimiento facial en el checador — Diseño

**Fecha:** 2026-06-22
**Estado:** Diseño aprobado en brainstorming, pendiente de revisión del spec escrito.

## Objetivo

Añadir un paso de seguridad biométrico al flujo de checada: antes de permitir
"Tomar foto", la cámara verifica en vivo el rostro del empleado contra su rostro
de referencia. El botón "Tomar foto" permanece **deshabilitado** hasta que se
reconoce a la persona correcta (con prueba de vida / anti-spoof). Si tras 15s no
hay match, se ofrece un escape que marca la checada como no verificada para que
RH la revise.

## Decisiones tomadas (brainstorming)

- **Modo de referencia: Híbrido.** Si el empleado tiene `face_descriptor`, se
  compara contra él. Si no, se auto-registra en el primer uso (auto-enroll).
- **Comportamiento sin match: Bloqueo con reintentos + escape a los 15s.** Nunca
  dejar a un empleado sin poder marcar; el escape graba `rostro_verificado=false`.
- **Auto-enroll: automático, pero avisando a RH.** `empleados` ya tiene trigger de
  auditoría (`fn_audit_log`), así el enroll aparece en "Historial de cambios" sin
  código extra.
- **Librería: `@vladmandic/human`** (opción B, "lo más seguro desde el principio")
  cargada como ESM desde CDN (jsDelivr), mismo patrón que SignaturePad/Leaflet.
  Incluye detección de rostro + embedding de identidad (faceres) + anti-spoof
  (`face.real`) + liveness (`face.live`) **desde la v1**, no como mejora futura.

## Arquitectura

Multi-página vanilla, sin build. El gate es **client-side** porque un servidor no
puede habilitar/deshabilitar un botón en el navegador.

```
checador/ (checador.js)
  showFoto()
    ├─ face.js  cargarMotor()  → carga modelos Human (lazy, cacheables ~10MB)
    ├─ loop ~400ms: analizar(video) → {embedding, live, real, box} | null
    ├─ similitud(embedding, referencia) ≥ UMBRAL  &&  live ≥ UMBRAL  &&  real ≥ UMBRAL
    │     → habilita #btn-tomar-foto, chip "Identidad verificada", data.rostroVerificado=true
    ├─ sin referencia → auto-enroll: guardarDescriptorFacial(embedding)
    └─ 15s sin match → muestra "Continuar sin verificar" (rostroVerificado=false)
```

### Archivo nuevo: `assets/js/face.js`

Único módulo con lógica no trivial. Interfaz:

- `cargarMotor()` → `Promise<void>` — instancia Human con config: face detector +
  description (faceres) + antispoof + liveness ON; body/hand/object/gesture OFF.
  Idempotente (memoiza la instancia).
- `analizar(videoEl)` → `Promise<{embedding:number[], live:number, real:number, box}|null>`
  — corre `human.detect(videoEl)`; devuelve `result.face[0]` mapeado o `null` si no hay cara.
- `similitud(a, b)` → `number` en 0..1 — distancia coseno entre dos embeddings.
- Constantes exportadas: `UMBRAL_SIMILITUD = 0.60`, `UMBRAL_VIVEZA = 0.60`,
  `UMBRAL_REAL = 0.60`. Ajustables (calibración real, no valores "mágicos" fijos).

### Modificaciones

- **`checador.js` `showFoto()`**: bucle de verificación (throttle ~400ms), gating del
  botón, chip de estado, anillo-guía, escape a 15s, set `data.rostroVerificado`/`data.viveza`/`data.similitud`.
- **`api.js`**:
  - `verificarPin()` devuelve además `faceDescriptor` (array | null) y `fotoUrl`.
  - nuevo `guardarDescriptorFacial(embedding)` → RPC `registrar_descriptor_facial(p_id_empleado, p_descriptor)`.
  - `guardarRegistro()` pasa `rostro_verificado`, `viveza`, `similitud` al insert.
- **HTML del checador**: chip de estado (`role="status" aria-live="polite"`),
  anillo-guía, botón "Tomar foto" `disabled` inicial, botón "Continuar sin verificar" oculto.
- **Admin** (`asistencia.js` / `historial`): badge ⚠ cuando `rostro_verificado = false`.
- **i18n**: claves nuevas (ES/EN) para todos los textos del chip y botones.

## Datos — Migración `0023_reconocimiento_facial.sql` (idempotente)

```sql
alter table empleados add column if not exists face_descriptor jsonb;

alter table registros add column if not exists rostro_verificado boolean not null default false;
alter table registros add column if not exists viveza numeric;
alter table registros add column if not exists similitud numeric;

-- verificar_pin: devolver face_descriptor + foto_url (drop+create de la función)
-- registrar_descriptor_facial(p_id_empleado uuid, p_descriptor jsonb): SECURITY DEFINER,
--   grant a anon; UPDATE empleados SET face_descriptor = p_descriptor WHERE id = p_id_empleado
--   (queda auditado por el trigger fn_audit_log existente).
```

- `face_descriptor` = vector de embedding (~1024 floats), **nunca la imagen**.
- `verificar_pin` (SECURITY DEFINER) es el único camino que expone el descriptor.

## UX del gate (Sección 3 — aprobada)

Chip de estado + anillo-guía (óvalo) sobre el `<video>`. El color **siempre** va
acompañado de icono SVG + texto (regla `color-not-only`).

| Estado | Chip | Anillo | Animación |
|---|---|---|---|
| Cargando modelos | ◐ "Cargando…" | gris | shimmer |
| Sin rostro | ⊙ "Coloca tu cara en el óvalo" | gris punteado | — |
| Verificando | ↻ "Verificando…" | ámbar | barra de escaneo (loop 2s) |
| Liveness baja | ⚠ "Mira a la cámara, sin fotos" | ámbar | shake 1x (200ms) |
| Match ✓ | ✓ "Identidad verificada" | verde | scale-pop (250ms) + crossfade |
| Auto-registrando | ⊕ "Registrando tu rostro…" | azul | shimmer |
| Escape (15s) | botón "Continuar sin verificar" | — | fade-in (200ms) |

**Microinteracciones:** todas `transform`/`opacity`, 150–300ms, ease-out al entrar /
ease-in al salir. Botón "Tomar foto": disabled → `opacity .4 + aria-disabled +
cursor not-allowed`; al desbloquear, pulso de escala (0.96→1.04→1) + anillo verde
como señal de causa-efecto. Chip: crossfade entre estados (no snap). Match: opcional
`navigator.vibrate(40)`.

**Accesibilidad (no negociable):**
- Chip = `role="status" aria-live="polite"`.
- `@media (prefers-reduced-motion: reduce)`: se desactivan escaneo/shake/pop/shimmer;
  solo quedan crossfades de opacidad. El gate funciona idéntico, sin movimiento.
- Botones ≥44px de alto, foco visible.
- Estado nunca comunicado solo por color.

CSS puro (keyframes), sin librería de animación.

## Seguridad y errores (Sección 4 — aprobada)

**Umbrales:** `similitud ≥ 0.60` **Y** `live ≥ 0.60` **Y** `real ≥ 0.60`.

**Techo conocido (MVP):** el match es client-side → un cliente manipulado podría
enviar `rostro_verificado=true`. Mismo techo que el `id_empleado` que ya confía el
cliente (documentado en `0006`). Upgrade path: verificar el embedding en una Edge
Function con token HMAC.

**Privacidad (LFPDPPP):** `face_descriptor` se sirve al cliente para comparar en el
navegador → el vector biométrico sale del servidor. Requiere aviso de privacidad +
consentimiento del empleado al auto-registrar. No se almacena imagen, solo el vector.

**Degradación:**
| Fallo | Comportamiento |
|---|---|
| Modelos no cargan (15s) | botón "Continuar sin verificar", `rostro_verificado=false`; no bloquea la checada |
| Sin descriptor de referencia | auto-enroll en 1er uso, auditado |
| Cámara denegada | ya gestionado por `permisos.js`; el flujo de foto no inicia |
| 15s sin match | escape → `rostro_verificado=false`, badge ⚠ para RH |

## Pruebas (Sección 5 — aprobada)

- `face.js`: `node --check` + `demo()` con `similitud()` sobre dos vectores conocidos
  (idéntico → 1.0, ortogonal → ~0). Única lógica no trivial (distancia coseno).
- `node --check` en `checador.js`, `api.js`.
- Manual en HTTPS: match propio habilita botón; foto de pantalla → liveness baja
  mantiene bloqueado; 15s → escape funciona.
- `supabase db push` para `0023` (pendiente de autorización del usuario).

## Fuera de alcance (YAGNI)

- Verificación server-side del embedding (Edge Function HMAC) — upgrade path documentado.
- Re-enroll / gestión de múltiples rostros por empleado.
- Detección de gemelos / ataques sofisticados más allá del anti-spoof de Human.
