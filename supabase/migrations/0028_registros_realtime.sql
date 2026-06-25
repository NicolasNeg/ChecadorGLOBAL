-- Centro de Operaciones: publicar `registros` en Realtime para que el mapa del
-- admin reciba las checadas en vivo (INSERT). La RLS existente
-- (rh_all_registros / jefe_select_registros, 0004) ya scopea el SELECT por rol;
-- Realtime la honra para el rol `authenticated` con el JWT del admin.
-- Idempotente: ignora si la tabla ya es miembro de la publicación.
do $$
begin
  alter publication supabase_realtime add table registros;
exception
  when duplicate_object then null;  -- ya estaba publicada
  when undefined_object then        -- la publicación no existe (proyecto sin realtime)
    create publication supabase_realtime for table registros;
end $$;
