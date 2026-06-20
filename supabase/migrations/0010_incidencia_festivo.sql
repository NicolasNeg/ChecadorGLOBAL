-- 0010_incidencia_festivo.sql — añade 'festivo' a los tipos de incidencia. Idempotente.
alter table incidencias drop constraint if exists incidencias_tipo_check;
alter table incidencias add constraint incidencias_tipo_check
  check (tipo in ('falta', 'permiso', 'justificacion', 'vacaciones', 'festivo'));
