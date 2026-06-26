-- Borrado lógico de empleados (solo RH desde la UI): el empleado se oculta de
-- los listados pero la fila persiste para no romper referencias (registros, log,
-- turnos). verificar_pin ya filtra activo=true, así que al marcar eliminado
-- también ponemos activo=false → no puede iniciar sesión.
-- ponytail: solo soft-delete; el hard-delete físico se omite (rompería FKs/log).
--   Si algún día se requiere purgar de verdad, hacerlo manualmente en Supabase
--   tras confirmar que no hay referencias.
alter table empleados add column if not exists eliminado boolean not null default false;
