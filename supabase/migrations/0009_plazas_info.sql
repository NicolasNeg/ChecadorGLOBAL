-- 0009_plazas_info.sql — información general de la plaza (dirección, contacto, notas).
-- RLS y trigger de auditoría ya cubren `plazas` desde 0004. Idempotente.

alter table plazas
  add column if not exists direccion   text,
  add column if not exists telefono    text,
  add column if not exists responsable text,
  add column if not exists notas       text;
