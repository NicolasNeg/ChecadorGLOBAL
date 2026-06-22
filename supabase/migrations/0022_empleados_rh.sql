-- 0022_empleados_rh.sql — datos extra de empleado para coordinación / RH.
-- Idempotente: add column if not exists. Sin cambios de RLS (el PATCH del admin
-- ya pasa por las políticas authenticated existentes sobre empleados).
alter table empleados add column if not exists fecha_nacimiento     date;
alter table empleados add column if not exists curp                 text;
alter table empleados add column if not exists rfc                  text;
alter table empleados add column if not exists nss                  text;
alter table empleados add column if not exists contacto_emergencia  text;
alter table empleados add column if not exists telefono_emergencia  text;
