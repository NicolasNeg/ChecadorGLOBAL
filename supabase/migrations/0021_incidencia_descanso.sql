-- 0021_incidencia_descanso.sql — añade 'descanso' a los tipos de incidencia
-- (override manual del admin: marcar un día como descanso desde Asistencia, p.ej.
-- un descanso excepcional fuera del calendario de turnos_dia). Idempotente.
alter table incidencias drop constraint if exists incidencias_tipo_check;
alter table incidencias add constraint incidencias_tipo_check
  check (tipo in ('falta', 'permiso', 'justificacion', 'vacaciones', 'festivo', 'asistencia', 'descanso'));
