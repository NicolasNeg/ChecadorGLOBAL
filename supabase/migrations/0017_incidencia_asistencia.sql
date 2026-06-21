-- 0017_incidencia_asistencia.sql — añade 'asistencia' a los tipos de incidencia
-- (override manual del admin: marcar un día sin checada como asistencia). Idempotente.
alter table incidencias drop constraint if exists incidencias_tipo_check;
alter table incidencias add constraint incidencias_tipo_check
  check (tipo in ('falta', 'permiso', 'justificacion', 'vacaciones', 'festivo', 'asistencia'));
