-- 0018: estado de jornada (entrada/salida) + unificación rol→puesto.
-- Reglas: no se puede checar entrada dos veces sin salida; no se puede checar
-- salida sin entrada abierta. Flags en empleados los mantiene SOLO el trigger.

-- ── 1. Columnas de estado de checada ────────────────────────────────────────
alter table empleados
  add column if not exists chequeo_entrada boolean not null default false,
  add column if not exists chequeo_salida  boolean not null default false;

-- Reconstruir el estado actual desde registros (idempotente):
-- dentro = el último registro del empleado es 'entrada'.
update empleados e set
  chequeo_entrada = coalesce((
    select r.tipo = 'entrada'
    from registros r where r.id_empleado = e.id
    order by r.hora desc limit 1
  ), false),
  chequeo_salida = false;

-- ── 2. BEFORE INSERT: validar el par entrada/salida ─────────────────────────
-- ponytail: única fuente de verdad de los flags = los triggers de abajo. El
-- cliente nunca los escribe, así no se desincronizan.
create or replace function fn_estado_checada()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_dentro boolean;
begin
  select chequeo_entrada into v_dentro from empleados where id = NEW.id_empleado;
  if NEW.tipo = 'entrada' and v_dentro then
    raise exception 'YA_TIENE_ENTRADA: Ya registraste tu entrada. Checa tu salida primero.';
  elsif NEW.tipo = 'salida' and not v_dentro then
    raise exception 'SIN_ENTRADA: No tienes una entrada abierta. Checa tu entrada primero.';
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_estado_checada on registros;
create trigger trg_estado_checada
  before insert on registros for each row execute function fn_estado_checada();

-- ── 3. AFTER INSERT: mantener flags ─────────────────────────────────────────
-- entrada → dentro; salida → reset ambos (queda listo para el próximo día).
create or replace function fn_actualizar_estado_checada()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if NEW.tipo = 'entrada' then
    update empleados set chequeo_entrada = true,  chequeo_salida = false where id = NEW.id_empleado;
  elsif NEW.tipo = 'salida' then
    update empleados set chequeo_entrada = false, chequeo_salida = false where id = NEW.id_empleado;
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_actualizar_estado_checada on registros;
create trigger trg_actualizar_estado_checada
  after insert on registros for each row execute function fn_actualizar_estado_checada();

-- ── 4. RPC para el checador (anon): estado actual + hora de entrada abierta ──
create or replace function estado_jornada(p_id_empleado bigint)
returns table(dentro boolean, hora_entrada timestamptz)
language sql security definer set search_path = public as $$
  select
    coalesce(e.chequeo_entrada, false),
    (select r.hora from registros r
      where r.id_empleado = p_id_empleado and r.tipo = 'entrada'
      order by r.hora desc limit 1)
  from empleados e where e.id = p_id_empleado;
$$;
revoke all on function estado_jornada(bigint) from public;
grant  execute on function estado_jornada(bigint) to anon, service_role;

-- ── 5. Unificar rol→puesto: respaldar el rol en puesto cuando falte ─────────
-- 'empleado' es el default genérico; sólo migramos los roles con significado.
insert into puestos (nombre)
  select distinct initcap(rol) from empleados
  where coalesce(puesto, '') = '' and rol in ('supervisor', 'gerente')
  on conflict (nombre) do nothing;
update empleados set puesto = initcap(rol)
  where coalesce(puesto, '') = '' and rol in ('supervisor', 'gerente');
