# Avisos — Editor drag-and-drop + tablón del empleado

**Estado:** aprobado (brainstorming 2026-06-26)
**Stack:** vanilla HTML/CSS/ES Modules (sin build), Supabase Postgres + Storage, jsPDF (ya en uso vía esm.sh). SVG nativo + pointer events para el editor. Sin dependencias nuevas.

## Objetivo

Herramienta en el panel admin para crear avisos/anuncios con un editor drag-and-drop (lienzo SVG con elementos arrastrables), guardarlos en Supabase y mostrarlos a los empleados en un tablón dentro del checador. El admin también puede descargar el aviso como PNG/PDF.

## Decisiones tomadas

- **Destino:** ambos — se guarda en Supabase, se muestra digital al empleado y se exporta a PNG/PDF.
- **Artefacto único:** el editor produce un *modelo* (JSON de elementos) y lo renderiza a un PNG. El PNG es la fuente para el tablón digital y para la descarga. No hay reflow responsive: el móvil escala la imagen.
- **Segmentación:** por plaza (`null` = todas) + fechas de vigencia opcionales. Encaja con el RBAC existente (`mi_rol()`/`mi_plaza_id()`).
- **Paleta del editor:** texto + imagen + forma + iconos/plantillas (set curado pequeño: ~3 plantillas, puñado de iconos SVG reusados del proyecto).
- **Enfoque técnico:** lienzo SVG + pointer events. Arrastrar = mover; manija de esquina = redimensionar imagen/forma/icono; panel inspector para estilo. Export = serializar SVG → `<img>` → `<canvas>` → `toDataURL('png')`; PDF vía jsPDF `addImage`.

## Arquitectura (3 unidades)

```
Backend (0034)         Editor admin                 Tablón empleado
─────────────          ─────────────                ───────────────
tabla avisos     <───  avisos.js (lista+CRUD)        avisos/index.html
bucket avisos    <───  aviso-editor.js (lienzo)      avisos-page.js
RPC vigentes     ──>   aviso-modelo.mjs (puro)  ──>  (lee RPC, render PNG)
                       aviso-modelo.test.mjs
```

**Flujo admin:** editor → `modelo` (jsonb) + render PNG → sube PNG a Storage `avisos/<uuid>.png` → inserta/actualiza fila (`diseno`, `imagen_url`, `plaza_id`, fechas, `titulo`).
**Flujo empleado:** menú → página avisos → `rpc/avisos_vigentes(plaza_id)` → render de los PNG (rejilla + lightbox).
**Export:** desde el editor o la lista, el PNG guardado → jsPDF `addImage` → descarga PDF; o descarga directa del PNG.

---

## Sección 1 — Backend (`supabase/migrations/0034_avisos.sql`)

Migración nueva, idempotente (`if exists`/`on conflict`). No edita migraciones aplicadas.

**Tabla `avisos`:**
```sql
create table if not exists avisos (
  id          uuid primary key default gen_random_uuid(),
  titulo      text not null,
  plaza_id    bigint references plazas(id) on delete cascade,  -- null = todas las plazas
  inicia_en   date,                                            -- null = sin inicio
  termina_en  date,                                            -- null = sin fin
  imagen_url  text,                                            -- PNG renderizado (público)
  diseno      jsonb not null default '{}'::jsonb,               -- modelo de elementos
  activo      boolean not null default true,
  creado_por  uuid references auth.users(id) default auth.uid(),  -- server-side, no se confía del cliente
  creado_en   timestamptz not null default now()
);
```

**RLS admin** (reusa helpers de 0004):
- `enable row level security`.
- `rh`: full sobre todas las filas (incluidos globales `plaza_id is null`):
  `using (mi_rol() = 'rh') with check (mi_rol() = 'rh')`.
- `jefe`: solo su plaza:
  `using (mi_rol() = 'jefe' and plaza_id = mi_plaza_id()) with check (mi_rol() = 'jefe' and plaza_id = mi_plaza_id())`.
- Sin políticas anon sobre la tabla (el empleado entra por RPC).

**RPC empleado** (patrón de `verificar_credencial` en 0033):
```sql
drop function if exists avisos_vigentes(bigint);
create function avisos_vigentes(p_plaza_id bigint)
returns table(id uuid, titulo text, imagen_url text, creado_en timestamptz)
language sql security definer set search_path = public
as $$
  select a.id, a.titulo, a.imagen_url, a.creado_en
  from avisos a
  where a.activo
    and (a.plaza_id is null or a.plaza_id = p_plaza_id)
    and (a.inicia_en  is null or a.inicia_en  <= current_date)
    and (a.termina_en is null or a.termina_en >= current_date)
  order by a.creado_en desc;
$$;
revoke all on function avisos_vigentes(bigint) from public, anon, authenticated;
grant  execute on function avisos_vigentes(bigint) to anon, service_role;
```

**Storage** (patrón de 0005, pero más estricto):
```sql
insert into storage.buckets (id, name, public) values ('avisos','avisos',true)
  on conflict (id) do update set public = excluded.public;
-- lectura pública; escritura solo authenticated (admins), nunca anon
drop policy if exists "public_read_avisos" on storage.objects;
drop policy if exists "auth_write_avisos"  on storage.objects;
create policy "public_read_avisos" on storage.objects for select to public using (bucket_id = 'avisos');
create policy "auth_write_avisos"  on storage.objects for all to authenticated
  using (bucket_id = 'avisos') with check (bucket_id = 'avisos');
```

---

## Sección 2 — Editor SVG drag-and-drop (admin)

**Lienzo:** `<svg viewBox="0 0 1080 1350">` (retrato 4:5; se ve bien en móvil y se imprime centrado en A4). Escala al ancho del panel vía CSS. Formato único; toggle A4 queda como futuro si lo piden.

**Modelo** (`diseno`):
```js
{ fondo: '#ffffff', elementos: [
  { id, tipo: 'texto',  x, y, w, texto, fontSize, color, bold, align },
  { id, tipo: 'imagen', x, y, w, h, dataUrl },
  { id, tipo: 'forma',  x, y, w, h, fill, radio, opacidad },
  { id, tipo: 'icono',  x, y, w, h, path, color },
] }
```
Coordenadas en el espacio del viewBox (1080×1350). `id` = contador/`crypto.randomUUID()`. El orden del array es el orden Z.

**Interacción ("drag and hold"):**
- **Arrastrar = mover:** `pointerdown` en el elemento → seleccionar; `pointermove` actualiza `x,y` convirtiendo px de pantalla a coords del viewBox con el factor de escala (`viewBoxW / svg.clientWidth`); `pointerup` confirma. `setPointerCapture` para no perder el drag al salir del nodo.
- **Manija esquina inf-derecha** (solo imagen/forma/icono): redimensiona `w` (y `h` proporcional en imagen/icono; libre en forma). El texto se dimensiona con `fontSize` desde el inspector.
- **Inspector** lateral del elemento seleccionado, contextual por tipo:
  - `texto`: textarea (contenido), slider fontSize, color, toggle bold, align (izq/centro/der).
  - `imagen`: botón reemplazar (file input).
  - `forma`: color fill, radio esquinas, opacidad.
  - `icono`: color, (tamaño por manija).
  - común: `Eliminar`, orden Z (Subir/Bajar = mover en el array).
- **Barra de herramientas:** `+ Texto`, `+ Imagen` (file input), `+ Forma`, `+ Icono` (popover con el set), `Plantilla` (3 presets), color de fondo.

**Plantillas** (presets = arrays de elementos predefinidos): `urgente` (banda roja + título "URGENTE" + cuerpo placeholder), `evento`, `informativo`.

**Iconos:** set chico (~6–8) de `<path>` SVG reusados de los inline del proyecto (alerta, info, calendario, reloj, ubicación, check). Viven como constantes en `aviso-modelo.mjs`.

**Validación (frontera de confianza — no se simplifica):**
- `titulo` obligatorio (botón guardar deshabilitado si vacío).
- Imagen: solo `image/png` / `image/jpeg`, máx ~3 MB; si no, toast de error y se descarta.
- El texto se **escapa** al serializar el SVG (`&<>"`), para no romper el SVG ni inyectar nodos.

**Export** (`modeloASvg` es puro y testeable):
1. `modeloASvg(modelo)` → string SVG completo (fondo + elementos, texto escapado, imágenes inline por data URI).
2. `await document.fonts.ready`; fuente del SVG = stack web-safe (`Arial, Helvetica, sans-serif`) para que el texto no se renderice sin fuente en el canvas.
3. `data:image/svg+xml;charset=utf-8,<encoded>` → `<img>` → `drawImage` en `<canvas width=1080 height=1350>` → `toDataURL('image/png')`.
4. PDF: jsPDF (`format`/orientación que encajen 1080×1350 a mm) `addImage(png, 'PNG', ...)`.

Las imágenes subidas son data URIs (`FileReader.readAsDataURL`), así el SVG las lleva inline y el canvas **no** se "ensucia" (taint) por CORS al exportar.

**Guardar:** valida → render PNG → `supabase.storage.avisos.upload('<uuid>.png')` (vía REST con JWT admin) → `insert/update avisos` con `diseno`, `imagen_url` (URL pública), `titulo`, `plaza_id`, fechas. Al editar uno existente, se carga su `diseno` al lienzo.

**Archivos:**
- `assets/js/admin/avisos.js` — panel: lista (miniatura PNG, plaza, vigencia, botones editar/activar-desactivar/borrar) + "Nuevo aviso". CRUD vía `admin/api.js`.
- `assets/js/admin/aviso-editor.js` — editor (lienzo SVG, drag, inspector, barra, export, guardar).
- `assets/js/admin/aviso-modelo.mjs` — **puro, sin DOM**: factory de elementos por defecto, plantillas, set de iconos, `modeloASvg(modelo)`, `avisoVigente(aviso, hoy)`.
- `assets/js/admin/aviso-modelo.test.mjs` — tests: `modeloASvg` escapa texto y posiciona elementos; `avisoVigente` cubre rango de fechas (sin inicio/sin fin/dentro/fuera); plantilla devuelve nº de elementos esperado.
- `assets/js/admin/dashboard.js` — `case 'avisos': { const m = await import('./avisos.js'); await m.init(panel); break; }`.
- `admin/dashboard/index.html` — nav `<a data-panel="avisos">` (icono megáfono/bell) + `<div id="panel-avisos" class="admin-panel" data-title="Avisos" hidden></div>`.
- `assets/css/estilos-admin.css` — estilos del panel + editor (paleta sky existente, inspector, barra, manija, miniaturas). Diseño siguiendo ui-ux-pro-max.

**API admin** (`assets/js/admin/api.js`): `listarAvisos()`, `crearAviso(payload)`, `actualizarAviso(id, payload)`, `borrarAviso(id)`, `subirImagenAviso(blob, nombre)` (Storage). Filtran por RLS automáticamente vía JWT.

---

## Sección 3 — Tablón del empleado (checador)

**Acceso:** entrada **"Avisos"** en el menú de bienvenida (`index.html`, tras login PIN), junto a Checador/Historial. Badge con el conteo de vigentes si hay.

**Página `avisos/index.html`** (mismo patrón que `historial/`): script `<base>` inline al inicio del `<head>`, paths relativos, reusa `base.css`/`app.css`, carga `assets/js/avisos-page.js`.

**Flujo (`avisos-page.js`):**
- `requireSession()` (de `auth.js`); restaura `_idEmpleado`/sesión desde `sessionStorage`.
- Toma `plaza_id` del empleado (de `verificar_pin`, ya en `sessionStorage`).
- `api.obtenerAvisos(plazaId)` → `rpc/avisos_vigentes`.
- Render: rejilla de tarjetas (miniatura PNG + título). Tap → **lightbox** a pantalla completa (reuso patrón de `historial.js`).
- **Empty state** si no hay vigentes ("No hay avisos por ahora").
- Orden: `creado_en desc` (ya desde el RPC).

**Badge en el menú** (`app.js`): al entrar al menú, una llamada al mismo RPC cuenta los vigentes y pinta el número en el botón "Avisos". Sin tabla de leído/no-leído (YAGNI; se agrega si piden marcar como leído).

**API empleado** (`assets/js/api.js`): `obtenerAvisos(plazaId)` → POST `rpc/avisos_vigentes` con anon key.

**Seguridad:** lectura solo por RPC `SECURITY DEFINER` (sin SELECT anon a la tabla); imágenes por URL pública del bucket (igual que las fotos del historial). Coincide con el modelo de seguridad actual.

**Accesibilidad (no se simplifica):** `alt` = título del aviso; lightbox cierra por teclado/Escape y tiene `aria-label`; tarjetas como botones con foco visible; `prefers-reduced-motion` respetado en transiciones.

**Archivos lado empleado:**
- `avisos/index.html` — página del tablón.
- `assets/js/avisos-page.js` — carga + render + lightbox + helper de conteo.
- `assets/js/api.js` — `obtenerAvisos(plazaId)`.
- `assets/js/app.js` — entrada "Avisos" + badge en el menú.
- `assets/css/app.css` — estilos del tablón + lightbox (si no se reusan tal cual).

---

## Pruebas

- `aviso-modelo.test.mjs` (node, sin framework, `assert`):
  - `modeloASvg` escapa `&<>"` en texto y coloca cada elemento en su `x,y`.
  - `avisoVigente(aviso, hoy)`: sin fechas → vigente; dentro del rango → vigente; antes de `inicia_en` o después de `termina_en` → no vigente; `activo=false` → no vigente.
  - plantilla (p.ej. `urgente`) devuelve el nº de elementos esperado.
- El editor (DOM/canvas) y el render PNG se verifican manualmente con `npx serve .` + túnel HTTPS.

## Restricciones del proyecto (heredadas)

- `config.js` solo anon key (pública); nunca `service_role`/`TOKEN_SECRET`.
- Frontera de seguridad = RPC SECURITY DEFINER + RLS (no Edge Functions).
- Cada tabla/política nueva en migración numerada nueva, idempotente; nunca editar una aplicada.
- Paths relativos + script `<base>` al inicio del `<head>` en cada HTML (GitHub Pages `/ChecadorGLOBAL/`).
- HTTPS para cámara/geo (no aplica aquí, pero el tablón vive en el mismo origen).
- Cerrar cada cambio con `git add . && git commit && git push` (trailer `Co-Authored-By: Claude Opus 4.8`).

## Fuera de alcance (YAGNI)

- Marcar avisos como leído/no-leído por empleado.
- Segmentación por empleado individual.
- Múltiples formatos de lienzo (solo 4:5; A4 si lo piden).
- Librería grande de iconos/plantillas (solo el set curado).
- Notificaciones push.
