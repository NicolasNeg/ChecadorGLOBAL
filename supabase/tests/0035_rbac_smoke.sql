-- Smoke de RBAC 0035. Correr con:
--   supabase db query --linked --file supabase/tests/0035_rbac_smoke.sql
-- Hace rollback al final: no persiste nada. Requiere los 4 roles ya sembrados.
begin;

-- Plazas y perfiles ficticios (ids uuid fijos para el test).
insert into plazas (id, nombre, ciudad, latitud, longitud)
  values (90001,'P-A','X',0,0),(90002,'P-B','X',0,0) on conflict do nothing;

insert into perfiles_admin (id, nombre, email, rol, plaza_id, activo) values
  ('00000000-0000-0000-0000-0000000000a4','SA','sa@t','super_admin',null,true),
  ('00000000-0000-0000-0000-0000000000a3','RH','rh@t','rh',null,true),
  ('00000000-0000-0000-0000-0000000000a2','JA','ja@t','jefe',90001,true),
  ('00000000-0000-0000-0000-0000000000b2','JB','jb@t','jefe',90002,true),
  ('00000000-0000-0000-0000-0000000000a1','SV','sv@t','supervisor',90001,true)
on conflict (id) do nothing;

-- Simula sesión del jefe A.
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a2"}';

do $$
begin
  -- jefe tiene empleados.editar por default, NO config.editar.
  assert tiene_permiso('empleados.editar'), 'jefe deberia tener empleados.editar';
  assert not tiene_permiso('config.editar'), 'jefe NO deberia tener config.editar';
  -- golden rules:
  assert not puede_gestionar('00000000-0000-0000-0000-0000000000a2'), 'no a si mismo';
  assert not puede_gestionar('00000000-0000-0000-0000-0000000000a3'), 'no a superior (rh)';
  assert puede_gestionar('00000000-0000-0000-0000-0000000000a1'), 'si a supervisor de su plaza';
  assert not puede_gestionar('00000000-0000-0000-0000-0000000000b2'), 'no a par (otro jefe)';
end $$;

-- Override: revoca empleados.editar al jefe A → tiene_permiso debe respetarlo.
set local role postgres;
insert into perfil_permisos (perfil_id, permiso, concedido)
  values ('00000000-0000-0000-0000-0000000000a2','empleados.editar',false)
  on conflict (perfil_id,permiso) do update set concedido = excluded.concedido;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a2"}';
do $$
begin
  assert not tiene_permiso('empleados.editar'), 'override revoke debe ganar al default';
end $$;

rollback;
