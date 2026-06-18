-- api.js llama verificar_pin con la anon key via REST.
-- La función es SECURITY DEFINER: sólo devuelve id/nombre si el hash coincide,
-- así que es seguro exponerla a anon.
grant execute on function verificar_pin(text) to anon;
