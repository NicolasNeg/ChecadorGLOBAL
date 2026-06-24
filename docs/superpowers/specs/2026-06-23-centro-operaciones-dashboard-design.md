# Centro de Operaciones — Dashboard en vivo (diseño)

**Fecha:** 2026-06-23
**Estado:** aprobado en brainstorming, pendiente de revisión del spec.

## Goal

Reemplazar el panel "Resumen" (overview estático del día) por un **Centro de
Operaciones** en vivo: lo primero que ve un supervisor/administrador al entrar,
útil para la operación diaria sin tener que navegar a otra sección. Pieza
central: un **mapa en tiempo real de las plazas** con el conteo de usuarios
activos en cada una. Acompañado de métricas operativas (presentes, ausentes,
llegadas tarde, incidencias) y una lista en vivo de quién está dentro.

## Qué se elimina

Del overview actual (`loadOverview` en `dashboard.js`):
- **Accesos rápidos** (`renderQuickLinks`, `#overview-quick`).
- **Distribución de hoy** (las 3 barras `barRow`, `renderDistribucion`,
  `#overview-dist`).

Se conserva el saludo/hero y se reemplaza el resto.

## Arquitectura

Sin build, multi-page, ES Modules vanilla (como el resto del admin). Tres piezas
nuevas + modificación del overview:

1. **Mapa (Leaflet vía CDN ESM).** Igual patrón que SignaturePad/Human: se
   importa Leaflet desde CDN (`https://esm.sh/leaflet@1.9`), su CSS desde el
   mismo CDN. Tiles de OpenStreetMap (sin API key). Un marcador por plaza con
   insignia de conteo de activos; clic en plaza dibuja su geocerca y abre el
   detalle lateral.

2. **Realtime (supabase-js vía CDN ESM).** El cliente actual del admin habla
   REST/RPC con `fetch`; para realtime se añade el cliente
   `@supabase/supabase-js` (CDN ESM) **solo para la suscripción websocket** a
   inserts de `registros`. Se le pasa el JWT del admin
   (`supabase.realtime.setAuth(access_token)`) para que el socket respete RLS
   por rol (jefe → su plaza, rh → todas). Cada insert dispara un recálculo.
   `// ponytail: supabase-js solo para realtime; hilar el protocolo Phoenix a
   mano sería un nido de bugs. Si se quiere quitar la dependencia, degradar a
   polling.` Fallback: si la suscripción falla, intervalo de 30s.

3. **Cálculo puro y testeable** (`operaciones-calc.mjs`): reduce los registros
   del día al estado actual por empleado y los agrega por plaza. Es la única
   lógica no trivial → lleva su `*.test.mjs` (patrón de `historial-calc`).

### Migración 0028 (Realtime)

`supabase/migrations/0028_registros_realtime.sql` — idempotente:
- Añade `registros` a la publicación `supabase_realtime`
  (`alter publication supabase_realtime add table registros;` envuelto en un
  bloque que ignora "ya es miembro").
- No toca RLS: `rh_all_registros` y `jefe_select_registros` (0004) ya scopean
  el SELECT por rol y Realtime los honra para el rol `authenticated`.
- No requiere `replica identity full` (solo se escuchan INSERTs).

## Componentes y archivos

- **Crear** `assets/js/admin/operaciones-calc.mjs` — funciones puras:
  - `estadoActualPorEmpleado(registros)` → `Map<id_empleado, {tipo, hora, plazaId, nombre, plazaNombre}>`. Los registros vienen `order=hora.desc`, así que el primero por empleado es el más reciente.
  - `activosPorPlaza(registros)` → `Map<plazaId, {nombre, activos: [{nombre, hora}]}>` (solo empleados cuyo estado actual es `entrada`).
  - `contarTarde(registros, turnosPorEmpleado)` → número de empleados cuya primera entrada de hoy es retardo (reusa `esRetardo` de `historial-calc.mjs`).
  - `contarIncidencias(registros)` → registros con `geocerca_valida === false`.
- **Crear** `assets/js/admin/operaciones-calc.test.mjs` — self-check con `assert` (sin framework), corre con `node operaciones-calc.test.mjs`.
- **Crear** `assets/js/admin/mapa-operaciones.js` — wrapper de Leaflet:
  - `cargarMapa()` (carga perezosa de Leaflet ESM + CSS, una vez).
  - `montarMapa(contenedor, plazas)` → instancia el mapa, ajusta bounds a las plazas con coords; devuelve un handle.
  - `pintarConteos(handle, activosPorPlaza)` → actualiza insignias/colores de marcadores sin recrear el mapa.
  - `seleccionarPlaza(handle, plazaId)` → centra, dibuja círculo de geocerca (`radio_metros`), emite el detalle.
- **Modificar** `assets/js/admin/dashboard.js`:
  - Renombrar/reescribir `loadOverview` → `loadOperaciones` (el panel sigue siendo `#panel-overview`, hash `#overview`).
  - Quitar `renderQuickLinks` y `renderDistribucion`/`barRow`.
  - Nueva consulta única del día → cálculo → métricas + mapa + lista "Activos ahora".
  - Suscripción realtime al entrar al panel; cancelarla (`unsubscribe`) al salir del panel (en `showPanel`).
- **Modificar** `assets/js/admin/api.js`:
  - `getRegistros` ya devuelve lo necesario; añadir `getEmpleadosConTurno()` o reutilizar `getEmpleados` + `getTurnos` para resolver `hora_entrada`/`tolerancia_entrada_min` por empleado (para "tarde" y "ausentes").
  - Añadir `suscribirRegistros(onInsert)` → crea el cliente supabase-js (lazy, una vez), `setAuth(token)`, canal `postgres_changes` INSERT en `registros`; devuelve `() => unsubscribe`.
- **Modificar** `admin/dashboard/index.html`: nada de markup nuevo obligatorio (el panel se llena por JS); el CSS de Leaflet se inyecta desde el wrapper.
- **Modificar** `assets/css/estilos-admin.css`: layout del centro de operaciones (mapa + tira de métricas + lista), alturas del mapa, insignias de marcador, responsive (stack en móvil).
- **Modificar** `assets/js/i18n.js`: cadenas nuevas (ES base + EN).

## Flujo de datos

Al entrar al panel `overview`:
1. `getPlazas()` → plazas con `latitud/longitud/radio_metros` (scopeadas por RLS).
2. `getRegistros({ fecha: hoyISO, limit: 500 })` → registros de hoy (scopeados por RLS).
3. `getEmpleados()` + `getTurnos()` → para denominador de ausentes y turno (hora_entrada) por empleado.
4. `operaciones-calc` reduce a: activos por plaza, presentes, ausentes, tarde, incidencias.
5. Render: tira de métricas, marcadores del mapa con conteo, lista "Activos ahora".
6. `suscribirRegistros` → en cada INSERT, re-ejecuta pasos 2/4/5 (debounce ~1s para ráfagas). Si la suscripción no conecta, intervalo de 30s como fallback.

### Definiciones operativas (v1)

- **Presentes ahora:** empleados cuyo estado actual hoy es `entrada` (última checada del día = entrada). Arregla la aproximación `entradas − salidas` actual.
- **Activos por plaza:** los presentes agrupados por `empleado.plaza_id`.
- **Ausentes:** empleados activos con turno asignado que **no** tienen entrada hoy. `// ponytail: usa turno por defecto del empleado; resolver el horario por-día (getTurnosDia) es el upgrade.`
- **Llegadas tarde hoy:** empleados cuya primera entrada de hoy cumple `esRetardo(entrada, turnoDelEmpleado)`. Reusa `esRetardo` (compara contra `hora_entrada + tolerancia_entrada_min`).
- **Incidencias hoy:** registros con `geocerca_valida === false`.

## RBAC / scoping

No se añade lógica de scoping nueva: RLS ya filtra `getRegistros`, `getPlazas`
(jefe → su plaza) y el canal realtime (por JWT). El mapa de un `jefe` mostrará
solo su plaza; el de `rh`, todas (bounds automáticos). Reusar `filterByPlaza` /
`plaza-scope.js` donde el selector de plaza del header aplique.

## Manejo de errores / degradación

- **Tiles del mapa no cargan / sin red:** el mapa muestra su fondo; las
  métricas y la lista "Activos ahora" siguen funcionando (no dependen de tiles).
- **Leaflet no carga (CDN caído):** se oculta el contenedor del mapa y se
  muestra solo la tira de métricas + lista, con un aviso discreto. No bloquea el
  panel.
- **Realtime no conecta:** fallback a intervalo de 30s + botón "Actualizar".
- **Plaza sin coordenadas:** no se dibuja marcador; aparece en la lista igual.
- Errores de consulta: las métricas muestran `—` y un mensaje, como hoy.

## Diseño visual (ui-ux-pro-max)

- Mobile-first: en móvil se apila (métricas arriba, mapa, lista); en desktop el
  mapa ocupa la columna principal y la lista "Activos ahora" la columna lateral.
- Mapa con `min-height` razonable (p. ej. 360px móvil / 520px desktop), bordes
  redondeados consistentes con `.ad-card`.
- Marcadores: insignia circular con el conteo; color por estado (verde = con
  presentes, gris = vacía, ámbar = incidencia hoy). El color nunca es el único
  indicador — el conteo y el texto del detalle lo acompañan (a11y).
- Respeta `prefers-reduced-motion` (sin animaciones de marcador innecesarias).
- Indicador "en vivo" (punto pulsante) + hora de última actualización.

## Testing

- **`operaciones-calc.test.mjs`** (runnable, `node`): casos para
  `estadoActualPorEmpleado` (entrada→activo, entrada+salida→inactivo, varios
  empleados), `activosPorPlaza` (agrupa y cuenta), `contarTarde` (entrada tardía
  vs a tiempo con tolerancia). Es la lógica que rompe silenciosamente si se
  toca; el resto (Leaflet, realtime, render) se valida manualmente en
  Vercel/túnel con HTTPS.
- Verificación manual: dos sesiones (una checa en el checador, el mapa del admin
  debe reflejar el conteo en vivo).

## Fuera de alcance (YAGNI por ahora)

- Histórico/tendencias multi-día y gráficas (el usuario las descartó).
- Heatmap o clustering de marcadores.
- Resolución de horario por-día para ausentes/tarde (se usa turno por defecto).
- Realtime de UPDATE/DELETE (solo INSERT de checadas).
