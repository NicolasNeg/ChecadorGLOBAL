# Auditoría: Seguridad y Correctitud Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cerrar los 4 hallazgos de la auditoría — rate-limit de PIN, red de pruebas + CI, retardos calculados desde la distribución por fecha (`turnos_dia`), y el camino seguro HMAC (Edge Functions) para escrituras e historial.

**Architecture:** EQS Checador es un sitio estático multipágina (HTML + CSS + ES Modules, sin build) servido en Vercel y GitHub Pages, contra Supabase Postgres + Storage. El cliente sólo tiene la anon key; la frontera de seguridad son RPCs `SECURITY DEFINER` + RLS. Cada fase es independiente y desplegable por sí sola; el orden minimiza riesgo (control urgente primero, red de pruebas antes de tocar lógica, y el cambio más grande —HMAC— al final).

**Tech Stack:** Postgres (migraciones SQL numeradas e idempotentes), Deno/TypeScript (Edge Functions), vanilla ES Modules, `node --test` (test runner nativo, sin dependencias), GitHub Actions.

## Global Constraints

- `assets/js/config.js` contiene **sólo la anon key** (pública). NUNCA poner `service_role` ni `TOKEN_SECRET` ahí.
- La frontera de seguridad son RPCs `SECURITY DEFINER` + RLS, no las Edge Functions (hoy sin desplegar).
- Las tablas/columnas/políticas nuevas van en una **migración nueva numerada** (`0021`, `0022`, …), **idempotente** (`drop … if exists`, `create … if not exists`, `on conflict`). **Nunca** editar una migración ya aplicada.
- No tocar `perfiles_admin.rol` (`rh`/`jefe`) ni los helpers `mi_rol()` / `mi_plaza_id()`.
- Cámara y geolocalización requieren HTTPS — probar en Vercel/GitHub Pages o túnel, nunca `http://localhost` pelado.
- Todo cambio termina con `git add . && git commit && git push`. El mensaje de commit cierra con el trailer:
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`
- Fechas TZ-safe: `ymd(d)` con `getFullYear/getMonth/getDate` (local), NUNCA `toISOString()` (UTC). Semana lunes–domingo: `dow = (getDay()+6)%7`.
- Rutas relativas en HTML (`assets/…`) y `BASE + '/ruta'` en navegación JS (compatibilidad GitHub Pages `/ChecadorGLOBAL/`).

---

## File Structure

| Archivo | Responsabilidad | Fase |
|---|---|---|
| `supabase/migrations/0021_pin_rate_limit.sql` | Tabla `pin_intentos` + `verificar_pin` con throttle por IP | 1 |
| `package.json` | `"type":"module"` + script `test` (node --test) | 2 |
| `assets/js/semana.mjs` | Helpers de semana puros (`lunesDe`, `ymd`, `addDias`, `proxLunes`) reutilizados por app.js, turnos.js y la calc | 2 |
| `assets/js/semana.test.mjs` | Pruebas de los helpers de semana | 2 |
| `assets/js/admin/historial-calc.test.mjs` | Ya existe; se le añade el caso de override por `turnos_dia` | 2,3 |
| `.github/workflows/ci.yml` | CI: `node --test` + `node --check` en push/PR | 2 |
| `assets/js/admin/historial-calc.mjs` | `tableroMes` acepta `turnosDia` y prioriza la distribución por fecha | 3 |
| `assets/js/admin/asistencia.js` | Carga `turnos_dia` del rango y lo pasa a `tableroMes` | 3 |
| `assets/js/admin/historial-empleado.js` | Resuelve el turno esperado por día desde `turnos_dia` | 3 |
| `supabase/functions/*` | Despliegue del camino HMAC (ya escritas, sin desplegar) | 4 |
| `assets/js/config.js` | Exporta `FUNCTIONS_BASE` | 4 |
| `assets/js/api.js` | Reescritura: PIN→token, guardar/historial vía Edge Function | 4 |
| `supabase/migrations/0022_hmac_lockdown.sql` | Endurece RLS/Storage una vez migrado el cliente | 4 |

---

## Phase 1 — Rate-limit de PIN

**Problema:** `verificar_pin` (migración 0006) escanea todos los empleados haciendo `crypt()` por fila y no tiene throttle. Con la anon key, cualquiera puede llamar el RPC en bucle y forzar PINs de 4 dígitos (10 000 combinaciones).

**Enfoque:** Una migración nueva (`0021`) crea `pin_intentos` (por IP) y reemplaza `verificar_pin` por una versión `plpgsql` que cuenta intentos fallidos por IP, bloquea tras 5 fallos en 15 min, y mete `pg_sleep` en cada fallo. La IP sale de la cabecera `x-forwarded-for` que PostgREST expone vía `current_setting('request.headers')`.

> **ponytail / techo conocido:** `x-forwarded-for` es spoofeable por el cliente en algunos despliegues, así que esto frena fuerza bruta casual pero no a un atacante decidido. El refuerzo duro es Turnstile/CAPTCHA o rate-limit en el borde (Vercel/Cloudflare). Documentado en la migración.

### Task 1.1: Migración de rate-limit de PIN

**Files:**
- Create: `supabase/migrations/0021_pin_rate_limit.sql`

**Interfaces:**
- Consumes: `empleados`, `plazas`, `turnos` (existentes); extensión `pgcrypto` (`crypt`).
- Produces: tabla `pin_intentos(ip text pk, intentos int, ventana_inicio timestamptz, bloqueado_hasta timestamptz)`; `verificar_pin(p_pin text)` con misma firma de retorno que 0006, que ahora puede lanzar `raise exception 'DEMASIADOS_INTENTOS'` (SQLSTATE `P0001`).

- [ ] **Step 1: Escribir la migración completa**

```sql
-- 0021_pin_rate_limit.sql
-- Rate-limit por IP para verificar_pin: frena fuerza bruta de PINs de 4 dígitos.
-- ponytail: throttle por IP vía x-forwarded-for; techo = XFF es spoofeable.
--   Refuerzo duro: CAPTCHA/Turnstile o rate-limit en el borde (Vercel/Cloudflare).

create table if not exists pin_intentos (
  ip              text primary key,
  intentos        int  not null default 0,
  ventana_inicio  timestamptz not null default now(),
  bloqueado_hasta timestamptz
);

-- Sólo el dueño (SECURITY DEFINER) toca esta tabla; nadie más.
revoke all on table pin_intentos from public, anon, authenticated;

create or replace function verificar_pin(p_pin text)
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
  turno_salida    time
)
language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_ip       text := coalesce(
    nullif(split_part(
      coalesce(nullif(current_setting('request.headers', true), '')::json ->> 'x-forwarded-for', ''),
      ',', 1), ''),
    'desconocida');
  v_rec      pin_intentos%rowtype;
  v_ventana  interval := interval '15 minutes';
  v_max      int := 5;
begin
  select * into v_rec from pin_intentos where ip = v_ip for update;

  -- Bloqueo activo → corta antes de hacer cualquier crypt().
  if v_rec.bloqueado_hasta is not null and v_rec.bloqueado_hasta > now() then
    raise exception 'DEMASIADOS_INTENTOS' using errcode = 'P0001';
  end if;

  -- Ventana caducada (o primera vez) → reinicia el contador.
  if v_rec.ip is null or now() - v_rec.ventana_inicio > v_ventana then
    insert into pin_intentos (ip, intentos, ventana_inicio, bloqueado_hasta)
    values (v_ip, 0, now(), null)
    on conflict (ip) do update
      set intentos = 0, ventana_inicio = now(), bloqueado_hasta = null;
  end if;

  return query
    select e.id, e.nombre, e.numero_empleado, e.puesto, e.email, e.telefono, e.rol,
           e.plaza_id, e.turno_id,
           p.nombre, t.nombre, t.hora_entrada, t.hora_salida
    from   empleados e
    left join plazas p on p.id = e.plaza_id
    left join turnos t on t.id = e.turno_id
    where  e.activo = true
      and  e.pin_hash = crypt(p_pin, e.pin_hash)
    limit 1;

  if found then
    update pin_intentos set intentos = 0, bloqueado_hasta = null where ip = v_ip;
  else
    update pin_intentos
       set intentos = intentos + 1,
           bloqueado_hasta = case when intentos + 1 >= v_max then now() + v_ventana else null end
     where ip = v_ip;
    perform pg_sleep(0.5);  -- ralentiza fuerza bruta sin afectar al usuario legítimo
  end if;
end;
$$;

revoke all on function verificar_pin(text) from public, anon, authenticated;
grant  execute on function verificar_pin(text) to service_role, anon;
```

- [ ] **Step 2: Aplicar la migración y verificar que el camino feliz sigue funcionando**

Run:
```bash
supabase db push
supabase db query --linked --file - <<'SQL'
select id, nombre from verificar_pin('1234');  -- María (seed)
SQL
```
Expected: una fila con María. (Si el seed no está aplicado, primero `supabase db query --linked --file supabase/seed.sql`.)

- [ ] **Step 3: Verificar el bloqueo tras 5 fallos**

Run:
```bash
supabase db query --linked --file - <<'SQL'
do $$
declare i int;
begin
  for i in 1..5 loop
    begin perform * from verificar_pin('0000'); exception when others then null; end;
  end loop;
end $$;
-- El 6º intento (aún con PIN correcto) debe fallar por bloqueo:
select id from verificar_pin('1234');
SQL
```
Expected: el último `select` lanza `ERROR: DEMASIADOS_INTENTOS`. Limpieza: `delete from pin_intentos;`

> Nota: el bloqueo es por IP. Bajo `supabase db query` no hay `request.headers`, así que `v_ip = 'desconocida'` y todos los intentos comparten cubeta — exactamente lo que este test necesita.

- [ ] **Step 4: Manejar el error en el frontend (mensaje claro)**

**Files:**
- Modify: `assets/js/api.js` (función `verificarPin`)

`verificarPin` ya hace POST al RPC con la anon key y devuelve `{ok, ...}` o `{ok:false, error}`. Cuando PostgREST devuelve el error `P0001`, el body trae `{message: "DEMASIADOS_INTENTOS"}`. Mapear ese caso a un mensaje en español dentro del `catch`/manejo de no-ok de `verificarPin`:

```js
// dentro de verificarPin, al detectar respuesta no-ok / error del RPC:
if (data?.message?.includes('DEMASIADOS_INTENTOS'))
  return { ok: false, error: t('Demasiados intentos. Espera 15 minutos.') };
```

Añadir la clave EN en `assets/js/i18n.js`:
```js
'Demasiados intentos. Espera 15 minutos.': 'Too many attempts. Wait 15 minutes.',
```

- [ ] **Step 5: `node --check` del JS tocado**

Run: `node --check assets/js/api.js && node --check assets/js/i18n.js`
Expected: sin salida (OK).

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/0021_pin_rate_limit.sql assets/js/api.js assets/js/i18n.js
git commit -m "feat(seguridad): rate-limit por IP en verificar_pin (P0)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git push
```

---

## Phase 2 — Pruebas + CI

**Problema:** El único test del repo es el self-check de `historial-calc.mjs`. La lógica de semana (retardos, fechas, cruce de medianoche) vive duplicada e inline en `app.js` y `turnos.js`, sin pruebas. Antes de tocar lógica (Fase 3) hace falta una red de seguridad.

**Enfoque:** `node --test` nativo (sin dependencias). Extraer los helpers de semana —hoy duplicados— a `assets/js/semana.mjs` (DRY) y cubrirlos con pruebas. Un workflow de GitHub Actions corre `node --test` + `node --check` en cada push/PR.

### Task 2.1: package.json + extracción de helpers de semana

**Files:**
- Create: `package.json`
- Create: `assets/js/semana.mjs`
- Create: `assets/js/semana.test.mjs`
- Modify: `assets/js/app.js:169-176` (usar los helpers importados)
- Modify: `assets/js/admin/turnos.js` (helpers tras el array DIAS)

**Interfaces:**
- Produces: `lunesDe(d) → Date` (lunes 00:00 local de la semana de `d`), `ymd(d) → 'YYYY-MM-DD'` (local), `addDias(d, n) → Date`, `proxLunes(hoy = new Date()) → Date` (lunes de la próxima semana).

- [ ] **Step 1: Crear package.json**

```json
{
  "name": "eqs-checador",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test",
    "check": "find assets/js -name '*.js' -o -name '*.mjs' | xargs -n1 node --check"
  }
}
```

- [ ] **Step 2: Escribir la prueba que falla (helpers aún no existen)**

`assets/js/semana.test.mjs`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lunesDe, ymd, addDias, proxLunes } from './semana.mjs';

test('lunesDe devuelve el lunes de la semana (lun–dom)', () => {
  // 2026-06-18 es jueves → su lunes es 2026-06-15
  assert.equal(ymd(lunesDe(new Date(2026, 5, 18))), '2026-06-15');
  // 2026-06-21 es domingo → su lunes es 2026-06-15
  assert.equal(ymd(lunesDe(new Date(2026, 5, 21))), '2026-06-15');
  // 2026-06-15 es lunes → se devuelve a sí mismo
  assert.equal(ymd(lunesDe(new Date(2026, 5, 15))), '2026-06-15');
});

test('ymd es local, no UTC (no se corre de día)', () => {
  // 23:30 local NO debe convertirse al día siguiente vía toISOString()
  assert.equal(ymd(new Date(2026, 5, 18, 23, 30)), '2026-06-18');
});

test('addDias suma días cruzando mes', () => {
  assert.equal(ymd(addDias(new Date(2026, 5, 28), 7)), '2026-07-05');
});

test('proxLunes es el lunes de la semana siguiente', () => {
  // jueves 2026-06-18 → próxima semana empieza 2026-06-22
  assert.equal(ymd(proxLunes(new Date(2026, 5, 18))), '2026-06-22');
});
```

- [ ] **Step 3: Correr la prueba y verificar que falla**

Run: `node --test assets/js/semana.test.mjs`
Expected: FAIL — `Cannot find module './semana.mjs'`.

- [ ] **Step 4: Implementar los helpers**

`assets/js/semana.mjs`:
```js
// Helpers de semana (lunes–domingo), TZ-safe (local, no UTC).
export const lunesDe = (d) => {
  const x = new Date(d);
  const dow = (x.getDay() + 6) % 7; // 0 = lunes
  x.setDate(x.getDate() - dow);
  x.setHours(0, 0, 0, 0);
  return x;
};
export const ymd = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const addDias = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
export const proxLunes = (hoy = new Date()) => addDias(lunesDe(hoy), 7);
```

- [ ] **Step 5: Correr la prueba y verificar que pasa**

Run: `node --test assets/js/semana.test.mjs`
Expected: PASS (4 tests).

- [ ] **Step 6: Reemplazar los helpers inline duplicados por el import**

En `assets/js/app.js`, cambiar el import de la línea 1 y borrar las definiciones inline `lunesDe`/`ymdT`/`addDiasT`/`proxLunes` (líneas 171–176), usando los nombres del módulo. Reemplazo en línea 1:
```js
import { verificarPin, limpiarSesion, obtenerTurnosPlazaSemana, setIdEmpleado } from './api.js';
import { lunesDe, ymd, addDias, proxLunes } from './semana.mjs';
```
Borrar las líneas 171–176 (`const lunesDe = …`, `const ymdT = …`, `const addDiasT = …`, `const proxLunes = …`). Luego renombrar los usos en el archivo: `ymdT(` → `ymd(`, `addDiasT(` → `addDias(`. (Hay usos en `checkProximaSemana`, `renderTurnos`, `bindNav` — líneas ~187–229.)

En `assets/js/admin/turnos.js`, hacer lo mismo: importar `lunesDe, ymd, addDias` desde `../semana.mjs` y borrar las definiciones locales equivalentes.

- [ ] **Step 7: Verificar que todo sigue compilando y los tests pasan**

Run: `node --check assets/js/app.js && node --check assets/js/admin/turnos.js && node --test`
Expected: sin errores; todos los tests PASS.

- [ ] **Step 8: Commit**

```bash
git add package.json assets/js/semana.mjs assets/js/semana.test.mjs assets/js/app.js assets/js/admin/turnos.js
git commit -m "test: extrae helpers de semana a semana.mjs + pruebas con node --test

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git push
```

### Task 2.2: GitHub Actions CI

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Escribir el workflow**

```yaml
name: CI
on:
  push:
    branches: [main]
  pull_request:
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '22' }
      - run: npm run check
      - run: npm test
```

- [ ] **Step 2: Verificar localmente que ambos comandos pasan**

Run: `npm run check && npm test`
Expected: sin errores de sintaxis; todos los tests PASS.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: corre node --check y node --test en push y PR

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git push
```

- [ ] **Step 4: Confirmar que el workflow corre en verde**

Run: `gh run list --workflow=ci.yml --limit 1`
Expected: estado `completed` / `success` en el commit recién subido.

---

## Phase 3 — Retardos desde `turnos_dia`

**Problema:** El cálculo de retardos/asistencia (`tableroMes` en `historial-calc.mjs` y la vista por empleado) usa la plantilla **recurrente** `horarios_semana` (por `dia_semana` 1–7), no la distribución real por fecha `turnos_dia` (migración 0020). Si RH cambia el turno de alguien un día concreto, el retardo se evalúa contra el turno equivocado.

**Enfoque:** `tableroMes` acepta un parámetro nuevo `turnosDia` y, por cada celda (empleado×fecha), resuelve el turno esperado así:
1. ¿Hay fila en `turnos_dia` para ese empleado y fecha? → ese turno.
2. ¿No hay fila, pero esa semana del empleado sí está planificada en `turnos_dia`? → **descanso** (sin turno; no es retardo).
3. ¿Esa semana no está en `turnos_dia` (datos aún no migrados)? → cae a la plantilla recurrente (comportamiento actual).

Así `turnos_dia` manda donde existe, y `horarios_semana` queda como respaldo retro-compatible para fechas anteriores a la adopción del grid.

> **ponytail:** en `turnos_dia`, "sin fila" = descanso, así que no se distingue "descanso explícito" de "semana no planificada" salvo por la heurística *¿hay alguna fila esa semana?*. Es explicable y suficiente. Si RH necesitara marcar descanso aislado en una semana sin más turnos, habría que añadir un tipo de fila "descanso" — no lo necesita hoy.

### Task 3.1: `tableroMes` prioriza `turnos_dia`

**Files:**
- Modify: `assets/js/admin/historial-calc.mjs` (firma de `tableroMes` + lookup en líneas ~134, ~165-166)
- Modify: `assets/js/admin/historial-calc.test.mjs` (caso nuevo)
- Test: `assets/js/admin/historial-calc.test.mjs`

**Interfaces:**
- Consumes: `lunesDe`, `ymd` de `assets/js/semana.mjs` (Fase 2).
- Produces: `tableroMes(empleados, registros, incidencias, horarios, turnos, rango, hoy = new Date(), turnosDia = []) → { dias, filas }`. `turnosDia` = `[{ id_empleado, fecha:'YYYY-MM-DD', turno_id }]`. Misma forma de retorno que antes (parámetro nuevo opcional y retro-compatible).

- [ ] **Step 1: Escribir la prueba que falla**

Añadir a `assets/js/admin/historial-calc.test.mjs` (usa el runner que ya tenga; si el archivo usa asserts sueltos en `node:test`, sigue ese patrón). Caso: un empleado con plantilla recurrente turno A (entra 09:00), pero `turnos_dia` lo pone en turno B (entra 14:00) un día concreto; una checada a las 13:00 NO debe ser retardo bajo el turno B.

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tableroMes } from './historial-calc.mjs';

test('tableroMes: turnos_dia tiene prioridad sobre la plantilla recurrente', () => {
  const turnos = [
    { id: 1, nombre: 'Mañana', hora_entrada: '09:00', hora_salida: '17:00' },
    { id: 2, nombre: 'Tarde',  hora_entrada: '14:00', hora_salida: '22:00' },
  ];
  const empleados = [{ id: 10, nombre: 'Lalo', plaza_id: 1, activo: true }];
  // Plantilla recurrente: lunes (dia_semana 1) → turno 1 (entra 09:00).
  const horarios = [{ id_empleado: 10, dia_semana: 1, turno_id: 1 }];
  // turnos_dia: ese lunes concreto lo movieron al turno 2 (entra 14:00).
  const turnosDia = [{ id_empleado: 10, fecha: '2026-06-15', turno_id: 2 }];
  // Checada de entrada 13:00 del lunes 2026-06-15.
  const registros = [{ id_empleado: 10, tipo: 'entrada', hora: '2026-06-15T13:00:00' }];
  const rango = { desde: '2026-06-15', hasta: '2026-06-15' };

  const t = tableroMes(empleados, registros, [], horarios, turnos, rango,
                       new Date(2026, 5, 16), turnosDia);
  const celda = t.filas[0].celdas['2026-06-15'];
  assert.equal(celda.tarde, false, '13:00 no es retardo bajo el turno 2 (14:00)');
});
```
(Ajusta los nombres de propiedades —`celdas`, `tarde`— a los que ya devuelve `estadoCelda`/`tableroMes`; revísalos en `historial-calc.mjs` antes de escribir el assert.)

- [ ] **Step 2: Correr la prueba y verificar que falla**

Run: `node --test assets/js/admin/historial-calc.test.mjs`
Expected: FAIL — hoy `tableroMes` ignora `turnosDia` y usa turno 1 (09:00), marcando 13:00 como retardo.

- [ ] **Step 3: Implementar el override en `tableroMes`**

En `historial-calc.mjs`:

1. Importar al inicio del archivo:
```js
import { lunesDe, ymd } from '../semana.mjs';
```
2. Cambiar la firma (línea ~de la declaración de `tableroMes`):
```js
export function tableroMes(empleados, registros, incidencias, horarios, turnos, rango, hoy = new Date(), turnosDia = []) {
```
3. Tras construir `horarioDe` (línea ~134), añadir los índices por fecha:
```js
  const diaDe   = new Map(turnosDia.map((d) => [`${d.id_empleado}-${d.fecha}`, d.turno_id]));
  const semPlan = new Set(turnosDia.map((d) => `${d.id_empleado}-${ymd(lunesDe(new Date(d.fecha + 'T12:00:00')))}`));
```
4. En el lookup del turno por día (líneas ~165-166), reemplazar:
```js
        const diaSem = d.dow === 0 ? 7 : d.dow;
        const turno = turnoDe.get(horarioDe.get(`${e.id}-${diaSem}`));
```
por:
```js
        const diaSem = d.dow === 0 ? 7 : d.dow;
        const tidDia = diaDe.get(`${e.id}-${d.ymd}`);
        let turno;
        if (tidDia != null)
          turno = turnoDe.get(tidDia);                                   // turnos_dia manda
        else if (semPlan.has(`${e.id}-${ymd(lunesDe(new Date(d.ymd + 'T12:00:00')))}`))
          turno = undefined;                                             // semana planificada, sin fila = descanso
        else
          turno = turnoDe.get(horarioDe.get(`${e.id}-${diaSem}`));       // respaldo: plantilla recurrente
```
(Si la variable de fecha de la celda no es `d.ymd` sino otra, úsala — confírmalo en el bucle de `diasCalendario`/`tableroMes`.)

- [ ] **Step 4: Correr la prueba y verificar que pasa**

Run: `node --test assets/js/admin/historial-calc.test.mjs`
Expected: PASS — incluido el caso nuevo y los self-checks previos del archivo.

- [ ] **Step 5: Commit**

```bash
git add assets/js/admin/historial-calc.mjs assets/js/admin/historial-calc.test.mjs
git commit -m "fix(retardos): tableroMes prioriza turnos_dia sobre plantilla recurrente

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git push
```

### Task 3.2: Cargar `turnos_dia` en la vista de asistencia

**Files:**
- Modify: `assets/js/admin/asistencia.js:150-157`

**Interfaces:**
- Consumes: `api.getTurnosDia({ desde, hasta })` (ya existe, Fase previa) → `[{ id_empleado, fecha, turno_id }]`; `tableroMes(..., turnosDia)` (Task 3.1).

- [ ] **Step 1: Cargar `turnos_dia` del rango y pasarlo a `tableroMes`**

En `asistencia.js`, dentro de `load()` (líneas 150-157):
```js
    const [empleados, horarios, turnos, registros, incidencias, turnosDia] = await Promise.all([
      api.getEmpleados(), api.getHorarios(), api.getTurnos(),
      api.getRegistrosRango(rango), api.getIncidenciasRango(rango),
      api.getTurnosDia(rango),
    ]);
    const activos = filterByPlaza(empleados.filter(e => e.activo), e => e.plaza_id);
    if (!activos.length) { wrap.innerHTML = `<div class="ad-empty">${t('No hay empleados activos en esta plaza.')}</div>`; return; }

    _tablero = tableroMes(activos, registros, incidencias, horarios, turnos, rango, new Date(), turnosDia);
```
Nota: `getTurnosDia` espera `{ desde, hasta }`; `rangoMes(_mes)` ya devuelve `{ desde, hasta }`, así que `api.getTurnosDia(rango)` es directo.

- [ ] **Step 2: Verificar sintaxis**

Run: `node --check assets/js/admin/asistencia.js`
Expected: sin salida (OK).

- [ ] **Step 3: Commit**

```bash
git add assets/js/admin/asistencia.js
git commit -m "feat(asistencia): alimenta tableroMes con turnos_dia del rango

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git push
```

### Task 3.3: Vista por empleado — turno esperado por día

**Files:**
- Modify: `assets/js/admin/historial-empleado.js:188-201` (cargar `turnos_dia` del rango) y los usos de `esRetardo` (líneas 346, 394)

**Interfaces:**
- Consumes: `api.getTurnosDia({ desde, hasta })`, `api.getTurnos()`, `esRetardo(horaEntrada, turno)`.
- Produces: `_ctx.turnoDe(ymdStr) → turno|null` — resuelve el turno esperado de un día con la misma prioridad de Task 3.1.

> Esta vista hoy usa un único `_ctx.turno = emp?.turnos` para todo el rango. El KPI agregado de "Retardos" puede seguir usándolo como aproximación (es un resumen), pero el marcado **por día** (líneas 346 y 394) debe usar el turno real de esa fecha.

- [ ] **Step 1: Cargar turnos del día y el catálogo de turnos**

En `cargar()` (líneas 188-201), añadir a las cargas y al `_ctx`:
```js
    const [emp, registros, incidencias, turnosDia, turnos] = await Promise.all([
      api.getEmpleado(idEmpleado),
      api.getRegistrosEmpleado(idEmpleado, rango),
      api.getIncidencias(idEmpleado, rango),
      api.getTurnosDia({ desde: rango.desde, hasta: rango.hasta }),
      api.getTurnos(),
    ]);
    const desdeEf = (emp?.fecha_ingreso && emp.fecha_ingreso > rango.desde) ? emp.fecha_ingreso : rango.desde;
    _ctx.emp = emp;
    _ctx.turno = emp?.turnos ?? null;                       // respaldo / KPI agregado
    const turnoPorId = new Map(turnos.map(t => [t.id, t]));
    const turnoDiaDe = new Map(turnosDia
      .filter(d => d.id_empleado === idEmpleado)
      .map(d => [d.fecha, turnoPorId.get(d.turno_id) ?? null]));
    // Turno esperado de un día: turnos_dia si existe esa fecha, si no el del empleado.
    _ctx.turnoDe = (ymdStr) => turnoDiaDe.has(ymdStr) ? turnoDiaDe.get(ymdStr) : _ctx.turno;
```

- [ ] **Step 2: Usar el turno por fecha en el marcado de retardo por día**

En las dos líneas que marcan retardo por día (346 y 394), `reg` corresponde a un día concreto cuya clave `ymd` ya se está iterando (`ymdKey`/equivalente). Reemplazar `_ctx.turno` por el turno de esa fecha:
```js
    const tarde = reg.entrada && esRetardo(reg.entrada, _ctx.turnoDe(ymdKey));
```
(Usa la variable de fecha que tengas en ese scope — confírmala leyendo el bucle alrededor de cada línea.)

- [ ] **Step 3: Verificar sintaxis y que la suite sigue verde**

Run: `node --check assets/js/admin/historial-empleado.js && node --test`
Expected: sin errores; tests PASS.

- [ ] **Step 4: Commit**

```bash
git add assets/js/admin/historial-empleado.js
git commit -m "fix(historial): marca retardo por día con el turno real de esa fecha

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git push
```

---

## Phase 4 — Camino seguro HMAC (Edge Functions)

**Problema (techo MVP conocido):** El cliente inserta en `registros` directo por REST (`anon_insert_registros with check(true)`), enviando `id_empleado` desde el cliente → un cliente manipulado puede fichar como otro. Los buckets `fotos`/`firmas` son públicos. Las RPCs de historial confían en el `id_empleado` del cliente.

**Enfoque:** Activar el camino HMAC ya escrito en `supabase/functions/`: `verificar-pin` emite un token firmado (id dentro del token, no del cliente); `guardar-registro` y `obtener-historial` validan el token y usan el service role. El frontend deja de mandar `id_empleado` y de subir a Storage directo. Una vez migrado el cliente, `0022` endurece RLS/Storage.

> **Alcance:** Esta fase cubre el camino de **escritura de `registros` + historial + PIN** (datos sensibles y PII). Las RPCs de sólo lectura de turnos (`turnos_plaza_rango`, etc.) quedan como follow-up (riesgo menor: lectura, sin PII). Marcado abajo.
>
> **Orden crítico de despliegue:** desplegar funciones → cambiar frontend → verificar en producción → SÓLO ENTONCES aplicar `0022`. Si se aplica `0022` antes de que el cliente nuevo esté en vivo, se rompe el fichaje.

### Task 4.1: Desplegar las Edge Functions

**Files:** (sin cambios de código; ya existen `verificar-pin/`, `guardar-registro/`, `obtener-historial/`, `_shared/`)

- [ ] **Step 1: Fijar el secreto del token (NUNCA en config.js)**

Run:
```bash
supabase secrets set TOKEN_SECRET="$(openssl rand -hex 32)"
```
Expected: secreto guardado en el proyecto Supabase.

- [ ] **Step 2: Desplegar las tres funciones**

Run:
```bash
supabase functions deploy verificar-pin
supabase functions deploy guardar-registro
supabase functions deploy obtener-historial
```
Expected: tres deploys `Deployed Function`.

- [ ] **Step 3: Smoke test de `verificar-pin`**

Run (sustituye `<REF>` y `<ANON_KEY>`):
```bash
curl -s -X POST "https://<REF>.supabase.co/functions/v1/verificar-pin" \
  -H "Authorization: Bearer <ANON_KEY>" -H "Content-Type: application/json" \
  -d '{"pin":"1234"}'
```
Expected: JSON `{"ok":true,"idEmpleado":...,"nombre":"María...","token":"..."}`.

### Task 4.2: Reconectar el frontend al camino HMAC

**Files:**
- Modify: `assets/js/config.js` (exportar `FUNCTIONS_BASE`)
- Modify: `assets/js/api.js` (`verificarPin`, `guardarRegistro`, `obtenerHistorial`)

**Interfaces:**
- Consumes: funciones desplegadas (4.1). `verificar-pin` → `{ok, idEmpleado, nombre, token}`; `guardar-registro` y `obtener-historial` requieren header `x-checador-token`.
- Produces: `api.js` guarda el `token` (en `sessionStorage`, junto a la sesión) y lo manda en cada llamada; **deja de enviar `id_empleado` desde el cliente**.

- [ ] **Step 1: Exportar `FUNCTIONS_BASE` en config.js**

```js
export const FUNCTIONS_BASE = `${SUPABASE_URL}/functions/v1`;
```

- [ ] **Step 2: `verificarPin` llama a la Edge Function y guarda el token**

Reescribir `verificarPin(pin)` en `api.js` para hacer POST a `${FUNCTIONS_BASE}/verificar-pin` con `Authorization: Bearer ${SUPABASE_ANON_KEY}` y body `{pin}`. Al recibir `{ok:true, idEmpleado, nombre, token}`: guardar `token` (p.ej. `sessionStorage.setItem('eqs_token', token)`) y `setIdEmpleado(idEmpleado)`. Mantener el mapeo de error de bloqueo (la función propaga el mismo error de rate-limit). Conservar el contrato de retorno `{ok, ...perfil}` que `app.js` ya consume.

- [ ] **Step 3: `guardarRegistro` usa la Edge Function con el token**

Reescribir `guardarRegistro({tipoChecada, foto, firma, latitud, longitud})` para POST a `${FUNCTIONS_BASE}/guardar-registro` con headers `Authorization: Bearer ${SUPABASE_ANON_KEY}` y `x-checador-token: ${sessionStorage.getItem('eqs_token')}`, body `{tipo: tipoChecada, foto, firma, latitud, longitud}`. **Quitar** el insert REST directo y la subida a Storage desde el cliente: la función sube las imágenes con el service role y pone `hora` server-side. **No** enviar `id_empleado` (sale del token).

- [ ] **Step 4: `obtenerHistorial` usa la Edge Function con el token**

Reescribir `obtenerHistorial()` para POST a `${FUNCTIONS_BASE}/obtener-historial` con `x-checador-token`. La función devuelve los registros del id del token con URLs firmadas (1 h). Quitar el `id_empleado` del cliente.

- [ ] **Step 5: Verificar sintaxis**

Run: `node --check assets/js/config.js && node --check assets/js/api.js`
Expected: sin salida (OK).

- [ ] **Step 6: Prueba manual en HTTPS (Vercel/preview o túnel)**

Login con PIN → Checar (entrada con foto+firma+ubicación) → Ver historial. Verificar en la tabla `registros` que la fila quedó con `id_empleado` correcto y `hora` server-side, y que el historial muestra la foto vía URL firmada.

- [ ] **Step 7: Commit**

```bash
git add assets/js/config.js assets/js/api.js
git commit -m "feat(seguridad): frontend usa Edge Functions HMAC (token en vez de id de cliente)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git push
```

### Task 4.3: Endurecer RLS y Storage (sólo tras 4.2 en vivo)

**Files:**
- Create: `supabase/migrations/0022_hmac_lockdown.sql`

- [ ] **Step 1: Escribir la migración de endurecimiento**

```sql
-- 0022_hmac_lockdown.sql
-- Tras migrar el cliente al camino HMAC: quitar el insert anónimo directo y
-- cerrar Storage. El service role (Edge Functions) sigue teniendo acceso total.
-- ponytail: NO aplicar hasta que el frontend HMAC esté en producción (rompe el fichaje si no).

-- 1) registros: ya no se inserta con la anon key directo.
drop policy if exists anon_insert_registros on registros;

-- 2) Storage privado: revertir el público de 0005 y quitar acceso anónimo.
update storage.buckets set public = false where id in ('fotos', 'firmas');
drop policy if exists "anon insert fotos"  on storage.objects;
drop policy if exists "anon read fotos"    on storage.objects;
drop policy if exists "anon insert firmas" on storage.objects;
drop policy if exists "anon read firmas"   on storage.objects;
-- (Usa los nombres EXACTOS de las políticas de 0005 — verifícalos antes:
--  select policyname from pg_policies where tablename = 'objects';)

-- 3) verificar_pin y las RPCs de historial: que sólo las llame el service role
--    (las Edge Functions). El anon ya no las necesita.
revoke execute on function verificar_pin(text)             from anon;
revoke execute on function obtener_historial(bigint, int)  from anon;
revoke execute on function ultima_entrada(bigint)          from anon;
-- Nota: si la firma exacta difiere, ajústala (\df verificar_pin / obtener_historial).
```

> **Follow-up explícito (no en esta migración):** `turnos_plaza_rango` y demás RPCs de turnos siguen con grant anon (lectura). Migrarlas al token HMAC es trabajo posterior; al revocarles el grant aquí se rompería "Mi turno" en el checador.

- [ ] **Step 2: Confirmar los nombres reales de las políticas de Storage de 0005**

Run:
```bash
supabase db query --linked --file - <<'SQL'
select policyname from pg_policies where schemaname='storage' and tablename='objects';
SQL
```
Ajustar los `drop policy` del Step 1 a los nombres exactos.

- [ ] **Step 3: Aplicar y verificar que el camino HMAC sigue funcionando y el directo ya no**

Run: `supabase db push`
Luego, prueba manual: fichar por la app (Edge Function) debe seguir funcionando; un insert REST directo con la anon key a `registros` debe ser rechazado por RLS.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0022_hmac_lockdown.sql
git commit -m "feat(seguridad): cierra insert anónimo, Storage privado, RPCs sólo service_role (P0)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git push
```

---

## Self-Review

- **Cobertura de la auditoría:** (1) Rate-limit PIN → Fase 1. (2) Path HMAC + Storage privado → Fase 4. (3) Retardos desde `turnos_dia` → Fase 3. (4) Tests + CI → Fase 2. Los 4 hallazgos tienen tarea.
- **Sin placeholders:** SQL completo en 0021 y 0022; código real en helpers, tests y diffs. Donde la calc/historial usan nombres de propiedad internos (`celdas`/`tarde`, `ymdKey`), se instruye confirmarlos en el archivo antes del assert — porque dependen de código no mostrado en este plan, no por vaguedad.
- **Consistencia de tipos:** `lunesDe`/`ymd`/`addDias`/`proxLunes` definidos en Task 2.1 y consumidos por igual en app.js, turnos.js y la calc. `getTurnosDia({desde,hasta})` y `tableroMes(..., turnosDia)` usan la misma forma `{id_empleado, fecha, turno_id}` en Fase 3.
- **Orden y seguridad:** Fase 4 lleva aviso explícito de no aplicar `0022` antes de que el cliente HMAC esté en vivo. Migraciones idempotentes y nuevas (0021, 0022); no se editan migraciones aplicadas. No se tocan `mi_rol()`/`mi_plaza_id()`/`perfiles_admin.rol`.
