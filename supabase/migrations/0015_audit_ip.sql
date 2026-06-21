-- 0015_audit_ip.sql — el trigger de auditoría ahora guarda la IP del cliente.
-- PostgREST expone los headers de la petición como GUC 'request.headers';
-- X-Forwarded-For trae la IP real del usuario (inet_client_addr() solo daría
-- la IP interna del pooler de Supabase). Idempotente: create or replace.

create or replace function fn_audit_log()
returns trigger language plpgsql security definer as $$
declare
  v_ip text;
begin
  -- X-Forwarded-For puede venir como "ip_cliente, proxy1, proxy2" → 1ª parte.
  begin
    v_ip := split_part(
      coalesce(current_setting('request.headers', true)::json ->> 'x-forwarded-for', ''),
      ',', 1
    );
  exception when others then
    v_ip := null;
  end;
  if v_ip = '' then v_ip := null; end if;

  insert into audit_log (tabla, operacion, registro_id, datos_antes, datos_despues, admin_id, ip_address)
  values (
    TG_TABLE_NAME,
    TG_OP,
    coalesce(NEW.id::text, OLD.id::text),
    case when TG_OP != 'INSERT' then to_jsonb(OLD) end,
    case when TG_OP != 'DELETE' then to_jsonb(NEW) end,
    auth.uid(),
    v_ip
  );
  return coalesce(NEW, OLD);
end;
$$;
-- ponytail: guarda IP, no ciudad; un geo-IP lookup (servicio externo) se añade
-- aparte si se necesita mostrar ubicación geográfica en vez de la IP.
