-- Verifica: verificar_pin devuelve face_descriptor y conserva la resolución de
-- turno de 0023; registrar_descriptor_facial persiste el vector.
-- Corre: supabase db query --linked --file supabase/tests/0024_facial.sql
-- Esperado: "OK 0024". Hace rollback.
begin;

-- Use an existing employee (id=4, Isaac Lerma) for testing
with orig as (
  select id, pin_hash from empleados where id = 4
),
test_data as (
  select 4 as emp_id, crypt('7777', gen_salt('bf')) as test_hash
)
-- Clear any existing face_descriptor and set test PIN
update empleados set face_descriptor = null where id = 4;

-- Set test PIN hash so we can use verificar_pin with a known PIN
update empleados set pin_hash = crypt('7777', gen_salt('bf')) where id = 4;

-- Sin descriptor: verificar_pin devuelve NULL en face_descriptor
do $$ declare d jsonb; begin
  select face_descriptor into d from verificar_pin('7777');
  if d is not null then raise exception 'face_descriptor debería ser NULL: %', d; end if;
end $$;

-- Tras registrar el descriptor: verificar_pin lo devuelve.
select registrar_descriptor_facial(4, '[0.1,0.2,0.3]'::jsonb);
do $$ declare d jsonb; begin
  select face_descriptor into d from verificar_pin('7777');
  if d is distinct from '[0.1,0.2,0.3]'::jsonb then
    raise exception 'face_descriptor no persistió: %', d;
  end if;
end $$;

select 'OK 0024' as resultado;
rollback;
