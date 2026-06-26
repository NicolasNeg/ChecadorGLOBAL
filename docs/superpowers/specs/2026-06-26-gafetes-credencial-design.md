# Gafetes / credenciales — diseño

**Fecha:** 2026-06-26
**Estado:** aprobado, pendiente de plan de implementación

## Objetivo

Panel admin que genera la credencial (gafete) de un empleado como **archivo PDF
real en milímetros** (jsPDF), individual o por lote (toda una plaza). El gafete
lleva un **QR que abre una página pública de verificación** mostrando que el
empleado está activo en EQS.

## Alcance (y lo que NO entra)

- **Entra:** plantilla fija de gafete CR80, generación individual y por lote a
  PDF, QR de verificación, página pública de verificación, RPC pública segura,
  migración con el código de credencial.
- **No entra (YAGNI):** editor drag-and-drop tipo Canva, otros documentos
  (constancias, anuncios, contratos), reposición/revocación manual de códigos.
  `// ponytail:` plantilla fija; si luego se requiere mover elementos, ese es el
  camino del canvas-editor — no hoy.

## Modelo de seguridad

El QR codifica una URL de verificación pública:
`<origin><BASE>/verificar/?c=<credencial_codigo>`

- `credencial_codigo` es un **UUID opaco por empleado**, NO el `id` interno ni el
  PIN. No expone nada enumerable ni el secreto, y queda desligado del techo
  conocido del MVP (las RPC de historial confían en el `id_empleado` del cliente).
- RPC pública `verificar_credencial(p_codigo uuid)` — `SECURITY DEFINER`,
  `grant execute` a `anon` y `service_role`, `revoke` al resto. Devuelve **solo
  campos seguros**: `nombre, numero_empleado, puesto, plaza_nombre, foto_url,
  activo`. Nunca PIN, email, teléfono ni `id`. Si `activo = false`, la página lo
  muestra como no vigente → la credencial se invalida sola al desactivar al
  empleado.
- El cliente solo tiene la anon key (pública), como en el resto del proyecto.

## Componentes

### 1. Migración `0033_credencial.sql`

```sql
-- Código opaco de credencial: lo que codifica el QR del gafete. NO es el id ni
-- el PIN; es un uuid público sin más permiso que ver datos no sensibles.
alter table empleados
  add column if not exists credencial_codigo uuid not null default gen_random_uuid();
-- unique para poder buscar por él (y backfill: el default ya rellena los existentes)
create unique index if not exists empleados_credencial_codigo_key on empleados(credencial_codigo);

-- Verifica una credencial por su código. Devuelve solo datos públicos seguros.
-- ponytail: sin rate-limit propio; superficie mínima (solo lectura de campos no
-- sensibles). Upgrade path: contar lecturas por código si se abusa.
drop function if exists verificar_credencial(uuid);
create function verificar_credencial(p_codigo uuid)
returns table(nombre text, numero_empleado text, puesto text, plaza_nombre text, foto_url text, activo boolean)
language sql security definer set search_path = public
as $$
  select e.nombre, e.numero_empleado, e.puesto, p.nombre, e.foto_url, e.activo
  from empleados e
  left join plazas p on p.id = e.plaza_id
  where e.credencial_codigo = p_codigo
  limit 1;
$$;
revoke all on function verificar_credencial(uuid) from public, anon, authenticated;
grant  execute on function verificar_credencial(uuid) to anon, service_role;
```

Idempotente. `0033` es el siguiente libre (la última aplicada es `0032`).

### 2. Página pública `verificar/`

`verificar/index.html` + `assets/js/verificar.js`:

- Mismo script `<base>` inline en el `<head>` que las demás páginas (prefijo
  GitHub Pages) y reusa `config.js` (`REST_BASE`, `SUPABASE_ANON_KEY`).
- `verificar.js`: lee `?c=` (valida que sea uuid), llama
  `rpc/verificar_credencial`, y pinta una tarjeta de estado.
- Estados: **válida + activa** (foto, nombre, número, puesto, plaza, sello
  "✓ Empleado activo de EQS"); **válida + inactiva** ("Credencial no vigente");
  **no encontrada / código inválido** ("Credencial no válida").

**UI/UX (ui-ux-pro-max):** página centrada, una sola tarjeta, jerarquía por
tamaño/peso (no solo color). Estado por **icono + texto + color** (no color
solo): verde ✓ activo, gris ✗ no vigente, rojo ⚠ inválida — contraste ≥ 4.5:1.
Foto con `alt`. Responsive mobile-first (la mayoría escanea con el teléfono),
`min-h-dvh`, `viewport-fit=cover`. Sin datos sensibles a la vista.

### 3. Panel admin `Gafetes`

Ítem de menú nuevo + módulo lazy `assets/js/admin/gafetes.js` (registrado en el
router de `dashboard.js` como los demás `case`).

- Carga **jsPDF** y **qrcode** desde esm.sh una sola vez (patrón
  qrcode/leaflet ya usado en `plazas.js`):
  `import('https://esm.sh/jspdf@2.5.2')`, `import('https://esm.sh/qrcode@1.5.4')`.
- `urlVerificacion(codigo)` → `${location.origin}${BASE}/verificar/?c=${codigo}`
  (función pura, testeable).
- `dibujarGafete(doc, emp, x, y)` — dibuja una tarjeta **CR80 (85.6×54 mm)** en el
  `doc` jsPDF en la esquina `(x,y)`: fondo con marca, foto (`addImage`), nombre,
  puesto, plaza, número de empleado y QR de la URL de verificación.
- `fotoADataUrl(url)` — carga la foto con `crossOrigin="anonymous"` y la pasa por
  un `<canvas>` a dataURL para `addImage`. Si falla (CORS/tainted/sin foto) →
  devuelve `null` y `dibujarGafete` pinta un **círculo con iniciales**.
- **Individual:** combobox de empleado (reusar `combobox.js`) → vista previa con
  el PDF embebido en un `<iframe>` (`doc.output('datauristring')`) → botón
  **Descargar PDF** (`doc.save(...)`).
- **Lote:** selector de plaza → `posicionesLote()` reparte las tarjetas en hojas
  **Letter** con márgenes y separación; `doc.addPage()` entre hojas →
  **Descargar PDF**.

**UI/UX (ui-ux-pro-max):** el gafete debe verse profesional —
- Tipografía: nombre en peso fuerte (Lexend 600–700), puesto/plaza en regular,
  número en etiqueta tabular.
- Color: paleta de marca (`--primario` EQS), franja/encabezado con el color de la
  plaza si existe; texto sobre fondo con contraste ≥ 4.5:1 **impreso** (no
  confiar en colores claros que se pierden en papel).
- Layout de tarjeta: foto a la izquierda, datos a la derecha, QR en esquina;
  márgenes de seguridad (≥ 4 mm) para corte.
- Botones del panel con estados loading/disabled durante la generación
  (`touch-target` ≥ 44px, feedback en < 100ms).

### 4. Estilos

`estilos-admin.css`: panel de gafetes (picker, contenedor de preview/iframe,
botones). `verificar/` lleva su propio CSS mínimo (o reusa `base.css` + un bloque
propio) — página independiente, no carga el dashboard.

## Datos

Sin tablas nuevas. Solo la columna `empleados.credencial_codigo` (uuid) y la RPC.
Los demás campos ya existen (`nombre, numero_empleado, puesto, plaza_id,
foto_url, activo`).

## Manejo de errores

- Foto CORS-tainted / ausente → iniciales (no rompe el PDF). ⚠️ El bucket `fotos`
  es público (`0005`); confirmar que responde con CORS permitido para
  `addImage`. Si no, la foto se omite con aviso y se documenta el ajuste de CORS
  en Supabase como follow-up.
- CDN (jsPDF/qrcode) no carga → toast de error, no se genera.
- Página pública: `?c` ausente o no-uuid → "Credencial no válida" sin llamar la
  RPC; RPC sin filas → mismo mensaje; error de red → "No se pudo verificar,
  reintenta".

## Pruebas

- `posicionesLote(pagina, tarjeta, margen)` → función pura; test mínimo
  (`assets/js/admin/gafetes-layout.test.mjs`, patrón de los `.test.mjs`
  existentes) que valida: nº de tarjetas por hoja con Letter+CR80, y que la
  primera coordenada respeta el margen y ninguna se sale de la página.
- `urlVerificacion(codigo)` → assert de formato en el mismo test.

## Constraints (heredadas del proyecto)

- `config.js` solo anon key; nada de service_role.
- Frontera de seguridad = RPC SECURITY DEFINER + RLS.
- Migración nueva numerada e idempotente; no editar migraciones aplicadas.
- Rutas relativas + script `<base>` en toda página HTML nueva (GitHub Pages).
- Sin build, ES Modules, dependencias por esm.sh (no copia local).
