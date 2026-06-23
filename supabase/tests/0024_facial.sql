-- Verifica: verificar_pin devuelve face_descriptor y conserva la resolución de
-- turno de 0023; registrar_descriptor_facial persiste el vector.
-- Corre: supabase db query --linked --file supabase/tests/0024_facial.sql
-- Esperado: "OK 0024". Hace rollback.
begin;

do $$ declare
  v_turno_id bigint;
  v_emp_id bigint;
  v_turno_nombre text;
  v_descriptor jsonb;
begin
  -- Inserta turno de prueba en plaza 1
  insert into turnos (plaza_id, nombre, hora_entrada, hora_salida, dias_semana)
  values (1, 'TEST T 0024', '08:00'::time, '16:00'::time, '{1,2,3,4,5}'::int[])
  returning id into v_turno_id;

  -- Inserta empleado de prueba con ese turno
  insert into empleados (nombre, pin_hash, turno_id, activo, numero_empleado, puesto)
  values ('Test Facial', crypt('8888', gen_salt('bf')), v_turno_id, true, 'TST-0024', 'test')
  returning id into v_emp_id;

  -- Asserción 1: verificar_pin devuelve el nombre de turno correcto
  select turno_nombre into v_turno_nombre from verificar_pin('8888');
  if v_turno_nombre is distinct from 'TEST T 0024' then
    raise exception 'turno_nombre debería ser TEST T 0024, pero es: %', v_turno_nombre;
  end if;

  -- Asserción 2: Sin descriptor, verificar_pin devuelve NULL en face_descriptor
  select face_descriptor into v_descriptor from verificar_pin('8888');
  if v_descriptor is not null then
    raise exception 'face_descriptor debería ser NULL inicialmente: %', v_descriptor;
  end if;

  -- Registrar descriptor facial
  perform registrar_descriptor_facial(v_emp_id, '[0.1,0.2,0.3]'::jsonb);

  -- Asserción 3: Tras registrar el descriptor, verificar_pin lo devuelve
  select face_descriptor into v_descriptor from verificar_pin('8888');
  if v_descriptor is distinct from '[0.1,0.2,0.3]'::jsonb then
    raise exception 'face_descriptor no persistió: %', v_descriptor;
  end if;
end $$;

select 'OK 0024' as resultado;
rollback;
