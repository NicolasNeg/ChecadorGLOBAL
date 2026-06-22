# Sincronizar turno del día con el checador — Diseño

**Fecha:** 2026-06-22
**Estado:** Diseño aprobado en brainstorming, pendiente de revisión del spec escrito.
**Orden:** Va **antes** del reconocimiento facial. Migración `0023` (facial pasa a `0024`).

## Problema

Al checar entrada, el checador muestra un turno que **no corresponde al día de hoy**.

**Causa raíz:** `verificar_pin` (definido en `0006_empleados_perfil.sql`, líneas 49-51)
resuelve el turno con un join estático:

```sql
from   empleados e
left join plazas p on p.id = e.plaza_id
left join turnos t on t.id = e.turno_id   -- ← turno FIJO del empleado
```

Usa `empleados.turno_id` (el turno fijo legacy) e **ignora**:
- `turnos_dia` (`0020`) — la asignación real por fecha, con historial semanal.
- `horarios_semana` (`0011`) — la plantilla recurrente por día de la semana.

Por eso el checador nunca refleja el turno asignado para hoy.

## Solución

Redefinir `verificar_pin` en una migración nueva (`0023`) para que resuelva el turno
**de hoy** con prioridad **híbrida inteligente** (decisión aprobada):

```
turno_de_hoy =
  turnos_dia[id_empleado, current_date]        -- 1. asignación real por fecha
  ├─ existe → ese turno
  └─ no existe:
       ├─ el empleado tiene OTRAS filas en turnos_dia
       │     → DESCANSO (turno nulo; el checador ya muestra "Sin turno asignado")
       └─ no tiene ninguna fila en turnos_dia
             → horarios_semana[id_empleado, dow(current_date)]   -- 2. plantilla
                ├─ existe → ese turno
                └─ no     → empleados.turno_id                    -- 3. fijo (legacy)
```

**Por qué híbrido:** respeta los descansos reales de las plazas que cargan turnos por
fecha, sin romper las plazas que solo usan la plantilla semanal recurrente.

**`dow` ↔ `dia_semana`:** `horarios_semana.dia_semana` usa 1=lunes…7=domingo (ISO).
En Postgres eso es `extract(isodow from current_date)`.

### Implementación SQL (migración `0023_sync_turno_dia.sql`, idempotente)

`create or replace function verificar_pin(text)` con la **misma firma de retorno**
que `0006` (no cambian columnas), pero el turno se resuelve con un CTE/lateral que
elige `turno_efectivo_id` según la cascada de arriba, y luego se hace el join a
`turnos` con ese id (no con `e.turno_id`).

Esqueleto:

```sql
create or replace function verificar_pin(p_pin text)
returns table( ... mismas columnas que 0006 ... )
language sql security definer set search_path = public, extensions as $$
  with emp as (
    select * from empleados
    where pin_hash = crypt(p_pin, pin_hash) and activo
  ),
  resuelto as (
    select emp.*,
      coalesce(
        (select d.turno_id from turnos_dia d
          where d.id_empleado = emp.id and d.fecha = current_date),
        case
          when exists (select 1 from turnos_dia d where d.id_empleado = emp.id)
            then null   -- usa sistema por fecha y hoy no tiene → descanso
          else coalesce(
            (select h.turno_id from horarios_semana h
              where h.id_empleado = emp.id
                and h.dia_semana = extract(isodow from current_date)::int),
            emp.turno_id  -- fijo legacy
          )
        end
      ) as turno_efectivo_id
    from emp
  )
  select r.id, r.nombre, r.numero_empleado, r.puesto, r.email, r.telefono, r.rol,
         r.plaza_id, r.turno_efectivo_id as turno_id,
         p.nombre, t.nombre, t.hora_entrada, t.hora_salida
  from   resuelto r
  left join plazas p on p.id = r.plaza_id
  left join turnos t on t.id = r.turno_efectivo_id;
$$;
```

(La lista de columnas/orden exactos se copia verbatim de `0006` al escribir el plan,
para no alterar el contrato que ya consume `api.js verificarPin`.)

Grants idénticos a `0006`: `revoke all ... from public, anon, authenticated;`
`grant execute ... to anon, service_role;`

### Frontend

**Sin cambios.** `api.js verificarPin` ya mapea `turno_nombre/entrada/salida` y
`checador.js pintarTurno()` ya muestra "Sin turno asignado" cuando vienen nulos.
El arreglo es 100% en la RPC.

## Acoplamiento con el reconocimiento facial (`0024`)

`0024` también hace `create or replace function verificar_pin` para añadir
`face_descriptor` + `foto_url` al retorno. **`0024` debe partir del cuerpo de `0023`**
(la resolución de turno híbrida) y solo añadir las dos columnas nuevas — no volver al
join estático. Se marca explícitamente en el plan para no regresar este arreglo.

## Pruebas

`// ponytail:` la lógica no trivial es la cascada de resolución. Verificación:
- Caso 1: empleado con fila en `turnos_dia` para hoy → devuelve ese turno.
- Caso 2: empleado con filas en `turnos_dia` pero ninguna hoy → turno nulo (descanso).
- Caso 3: empleado sin `turnos_dia`, con `horarios_semana` para hoy → turno de la plantilla.
- Caso 4: empleado sin `turnos_dia` ni `horarios_semana` → `empleados.turno_id` fijo.

Se prueban con SQL directo contra la DB (insertar filas de prueba y llamar
`verificar_pin`) tras `supabase db push`. Verificación manual en el checador: checar
y confirmar que el turno mostrado es el de hoy.

## Fuera de alcance (YAGNI)

- Turnos que cruzan medianoche (ya marcado como ceiling en `checador.js:141`).
- Cambiar la UI de asignación de turnos (ya existe en admin/turnos).
