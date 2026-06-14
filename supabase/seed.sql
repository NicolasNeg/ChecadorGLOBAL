-- Empleados de prueba
-- Para agregar más: copiar el patrón crypt('<PIN>', gen_salt('bf'))
insert into empleados (nombre, pin_hash, activo) values
  ('María López', crypt('1234', gen_salt('bf')), true),
  ('Carlos Pérez', crypt('5678', gen_salt('bf')), true);
