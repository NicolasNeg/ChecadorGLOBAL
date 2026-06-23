-- ═══════════════════════════════════════════════════════════════════════════
-- 0025: rostro_verificado pasa a NULLABLE (sin default).
-- 0024 lo creó como `not null default false`, lo que rellenó TODAS las checadas
-- previas a la función con false → el badge "Sin verificar" salía en todo el
-- histórico. Semántica correcta:
--   NULL  = checada anterior al reconocimiento facial (sin badge)
--   false = se omitió/falló la verificación en esta checada (badge ámbar)
--   true  = identidad verificada
-- El cliente (guardarRegistro) siempre manda un boolean real para filas nuevas,
-- así que solo las filas históricas quedan en NULL.
-- ═══════════════════════════════════════════════════════════════════════════

alter table registros alter column rostro_verificado drop not null;
alter table registros alter column rostro_verificado drop default;

-- ponytail: limpieza única del backfill de 0024. Válida porque el gate aún no
-- está en producción: toda fila con false hoy es histórica. Tras el lanzamiento
-- no re-ejecutar este UPDATE manualmente (borraría verificaciones omitidas reales);
-- las migraciones aplicadas no se re-corren con `supabase db push`.
update registros set rostro_verificado = null where rostro_verificado = false;
