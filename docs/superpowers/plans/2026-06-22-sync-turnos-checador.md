# Sincronizar turno del día con el checador — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que `verificar_pin` devuelva el turno asignado a HOY (no el turno fijo legacy del empleado).

**Architecture:** Una sola migración nueva (`0023`) redefine la RPC `verificar_pin` con una cascada de resolución de turno por fecha. El frontend no cambia: `api.js` y `checador.js` ya consumen `turno_nombre/entrada/salida` y muestran "Sin turno asignado" cuando vienen nulos.

**Tech Stack:** Supabase Postgres (PL/pgSQL + SQL), pgcrypto `crypt()`. Sin build.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-06-22-sync-turnos-checador-design.md`.
- Migración nueva, numerada, **idempotente** (`drop function if exists` + `create`). Nunca editar una migración ya aplicada.
- La RPC mantiene **exactamente** la misma firma de retorno que `0006` (13 columnas, mismo orden y tipos): `id bigint, nombre text, numero_empleado text, puesto text, email text, telefono text, rol text, plaza_id bigint, turno_id bigint, plaza_nombre text, turno_nombre text, turno_entrada time, turno_salida time`.
- `verificar_pin` es SECURITY DEFINER, `set search_path = public, extensions`, grant a `service_role, anon`, revoke de `public, anon, authenticated` antes del grant (patrón de `0006`).
- Prioridad de turno (decisión aprobada "híbrido inteligente"): `turnos_dia[hoy]` → si el empleado tiene otras filas en `turnos_dia` pero ninguna hoy = descanso (turno nulo) → `horarios_semana[isodow(hoy)]` → `empleados.turno_id` fijo.
- `horarios_semana.dia_semana`: 1=lunes…7=domingo = `extract(isodow from current_date)::int`.
- `supabase db push` está pendiente de autorización del usuario; los pasos de prueba SQL corren después del push.

---

### Task 1: Redefinir `verificar_pin` con resolución de turno por fecha

**Files:**
- Create: `supabase/migrations/0023_sync_turno_dia.sql`
- Test: `supabase/tests/0023_verificar_pin_turno.sql` (script de verificación, transacción con rollback)

**Interfaces:**
- Consumes: tablas `empleados`, `turnos`, `plazas`, `turnos_dia` (de `0020`), `horarios_semana` (de `0011`); extensión pgcrypto `crypt()`.
- Produces: `verificar_pin(p_pin text)` con las 13 columnas del contrato `0006`, pero `turno_id`/`turno_nombre`/`turno_entrada`/`turno_salida` reflejan el turno **efectivo de hoy**.

- [ ] **Step 1: Escribir la migración**

Crear `supabase/migrations/0023_sync_turno_dia.sql`:

```sql
-- ═══════════════════════════════════════════════════════════════════════════
-- 0023: verificar_pin resuelve el TURNO DE HOY, no el turno fijo del empleado.
-- Cascada (híbrido inteligente):
--   1. turnos_dia[empleado, current_date]            → asignación real por fecha
--   2. si tiene otras filas en turnos_dia pero no hoy → descanso (turno nulo)
--   3. horarios_semana[empleado, isodow(hoy)]         → plantilla recurrente
--   4. empleados.turno_id                             → turno fijo (legacy)
-- Misma firma de retorno que 0006 (no cambian columnas para no romper api.js).
-- ═══════════════════════════════════════════════════════════════════════════

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
  turno_salida    time
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
            then null  -- usa el sistema por fecha y hoy no tiene turno → descanso
          else coalesce(
            (select h.turno_id from horarios_semana h
              where h.id_empleado = emp.id
                and h.dia_semana = extract(isodow from current_date)::int),
            emp.turno_id  -- turno fijo legacy
          )
        end
      ) as turno_efectivo_id
    from emp
  )
  select r.id, r.nombre, r.numero_empleado, r.puesto, r.email, r.telefono, r.rol,
         r.plaza_id, r.turno_efectivo_id,
         p.nombre, t.nombre, t.hora_entrada, t.hora_salida
  from   resuelto r
  left join plazas p on p.id = r.plaza_id
  left join turnos t on t.id = r.turno_efectivo_id;
$$;

revoke all on function verificar_pin(text) from public, anon, authenticated;
grant  execute on function verificar_pin(text) to service_role, anon;
```

- [ ] **Step 2: Escribir el script de verificación (las 4 ramas de la cascada)**

Crear `supabase/tests/0023_verificar_pin_turno.sql`. Corre en una transacción y hace `rollback` al final, así no ensucia datos. Usa `raise exception` para fallar si una rama no resuelve el turno esperado.

```sql
-- Verifica las 4 ramas de resolución de turno de verificar_pin (0023).
-- Corre: supabase db query --linked --file supabase/tests/0023_verificar_pin_turno.sql
-- Esperado: "OK 0023" sin excepciones. Hace rollback (no persiste nada).
begin;

-- Plaza, dos turnos y un empleado de prueba con PIN conocido.
insert into plazas (id, nombre) values (9001, 'TEST PLAZA 0023')
  on conflict (id) do nothing;
insert into turnos (id, nombre, hora_entrada, hora_salida)
  values (9101, 'TEST MATUTINO', '08:00', '16:00'),
         (9102, 'TEST VESPERTINO', '14:00', '22:00')
  on conflict (id) do nothing;
insert into empleados (id, nombre, pin_hash, activo, plaza_id, turno_id)
  values (9001, 'TEST 0023', crypt('9999', gen_salt('bf')), true, 9001, 9102)
  on conflict (id) do nothing;

-- Rama 4 (sin turnos_dia ni horarios_semana): turno fijo = VESPERTINO (9102).
do $$ declare v text; begin
  select turno_nombre into v from verificar_pin('9999');
  if v is distinct from 'TEST VESPERTINO' then
    raise exception 'Rama 4 (fijo) falló: % (esperaba TEST VESPERTINO)', v;
  end if;
end $$;

-- Rama 3 (horarios_semana para hoy): plantilla = MATUTINO (9101).
insert into horarios_semana (id_empleado, dia_semana, turno_id)
  values (9001, extract(isodow from current_date)::int, 9101);
do $$ declare v text; begin
  select turno_nombre into v from verificar_pin('9999');
  if v is distinct from 'TEST MATUTINO' then
    raise exception 'Rama 3 (plantilla) falló: % (esperaba TEST MATUTINO)', v;
  end if;
end $$;

-- Rama 1 (turnos_dia de hoy): asignación por fecha = VESPERTINO (9102), gana sobre plantilla.
insert into turnos_dia (id_empleado, fecha, turno_id)
  values (9001, current_date, 9102);
do $$ declare v text; begin
  select turno_nombre into v from verificar_pin('9999');
  if v is distinct from 'TEST VESPERTINO' then
    raise exception 'Rama 1 (turnos_dia hoy) falló: % (esperaba TEST VESPERTINO)', v;
  end if;
end $$;

-- Rama 2 (descanso): tiene turnos_dia (mañana) pero no hoy → turno nulo.
delete from turnos_dia where id_empleado = 9001 and fecha = current_date;
insert into turnos_dia (id_empleado, fecha, turno_id)
  values (9001, current_date + 1, 9101);
do $$ declare v text; begin
  select turno_nombre into v from verificar_pin('9999');
  if v is not null then
    raise exception 'Rama 2 (descanso) falló: % (esperaba NULL)', v;
  end if;
end $$;

select 'OK 0023' as resultado;
rollback;
```

- [ ] **Step 3: Aplicar la migración**

Run: `supabase db push`
Expected: aplica `0023_sync_turno_dia.sql` (junto con cualquier migración pendiente previa) sin error. Reemplaza `verificar_pin`.

> Si el usuario aún no autoriza `db push`, detente aquí y pídelo; el resto depende de la DB viva.

- [ ] **Step 4: Correr la verificación**

Run: `supabase db query --linked --file supabase/tests/0023_verificar_pin_turno.sql`
Expected: una fila `OK 0023`, sin excepciones. (Si alguna rama falla, sale `ERROR: Rama N … falló`.)

- [ ] **Step 5: Verificación manual en el checador**

Asignar a un empleado real un `turnos_dia` para hoy distinto de su `turno_id` fijo (desde admin/turnos o SQL). Checar entrada con su PIN en el checador (HTTPS). Confirmar que la tarjeta de jornada y la pantalla de éxito muestran el turno de HOY, no el fijo.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/0023_sync_turno_dia.sql supabase/tests/0023_verificar_pin_turno.sql
git commit -m "fix(db): verificar_pin resuelve el turno del día (turnos_dia → plantilla → fijo)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git push
```

---

## Self-Review

- **Cobertura del spec:** causa raíz (join estático en 0006) → Task 1 Step 1; cascada híbrida con descanso → Step 1 (CASE + EXISTS); `isodow` → usado; 4 casos de prueba → Step 2; sin cambios de frontend → confirmado en Global Constraints; acoplamiento con 0024 → documentado en el spec facial (no es tarea de este plan). Sin huecos.
- **Placeholders:** ninguno; todo el SQL es ejecutable.
- **Consistencia de tipos:** la firma de retorno (13 columnas) coincide con `0006` y con el mapeo de `api.js verificarPin` (`turno_nombre`, `turno_entrada`, `turno_salida`).
