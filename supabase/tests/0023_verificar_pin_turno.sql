-- Verifica las 4 ramas de resolución de turno de verificar_pin (0023).
-- Corre: supabase db query --linked --file supabase/tests/0023_verificar_pin_turno.sql
-- Esperado: "OK 0023" sin excepciones. Hace rollback (no persiste nada).
begin;

-- Plaza, dos turnos y un empleado de prueba con PIN conocido.
insert into plazas (id, nombre, ciudad, latitud, longitud, radio_metros, activo)
  overriding system value
  values (9001, 'TEST PLAZA 0023', 'TEST CITY', 0.0, 0.0, 100, true)
  on conflict (id) do nothing;
insert into turnos (id, plaza_id, nombre, hora_entrada, hora_salida, activo)
  overriding system value
  values (9101, 9001, 'TEST MATUTINO', '08:00', '16:00', true),
         (9102, 9001, 'TEST VESPERTINO', '14:00', '22:00', true)
  on conflict (id) do nothing;
insert into empleados (id, nombre, pin_hash, activo, plaza_id, turno_id)
  overriding system value
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
