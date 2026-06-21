-- 0014_notas_meta.sql — las "incidencias" pasan a ser "notas": autor, edición e imagen.
-- No renombramos la tabla (rompería políticas/trigger/índices ya aplicados); solo
-- añadimos metadatos. Idempotente.

alter table incidencias add column if not exists autor_nombre   text;          -- quién la creó (denormalizado de la sesión admin)
alter table incidencias add column if not exists editor_nombre  text;          -- quién la editó por última vez
alter table incidencias add column if not exists actualizado_en timestamptz;   -- fecha de última modificación
alter table incidencias add column if not exists imagen_url     text;          -- adjunto opcional (bucket público 'fotos')
