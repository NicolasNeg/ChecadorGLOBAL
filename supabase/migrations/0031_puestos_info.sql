-- Enriquece el catálogo de puestos con datos informativos: color (para la
-- etiqueta visual), descripción, área/departamento, nivel y permisos.
-- Los "permisos" son SOLO informativos (texto libre) — no se aplican como
-- control de acceso. El RBAC real sigue siendo rh/jefe.
-- ponytail: permisos = texto informativo; upgrade a RBAC por puesto si algún
-- día se necesita bloquear funciones por puesto.
alter table puestos
  add column if not exists color       text,
  add column if not exists descripcion text,
  add column if not exists area        text,
  add column if not exists nivel       text,
  add column if not exists permisos    text;
