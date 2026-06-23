-- 0027_audit_ubicacion.sql — el audit_log guarda la ubicación GPS del admin.
-- El front pide la ubicación en el login y la manda en el header 'x-admin-loc'
-- ("lat,lon"). PostgREST expone los headers en el GUC 'request.headers', igual
-- que la IP (0015). Se muestra como dirección (reverse-geocode) en el Log de
-- Auditoría, en lugar de la IP.
-- ponytail: el header es falsificable por un cliente manipulado; es metadato de
-- auditoría, no un límite de seguridad. El upgrade es firmar la ubicación.
-- Idempotente: add column if not exists + create or replace + drop trigger.

alter table audit_log add column if not exists admin_ubicacion text;

-- Lee 'x-admin-loc' de los headers de la petición; null si no viene.
create or replace function _admin_loc()
returns text language plpgsql stable as $$
declare v text;
begin
  begin
    v := current_setting('request.headers', true)::json ->> 'x-admin-loc';
  exception when others then v := null; end;
  if v = '' then v := null; end if;
  return v;
end;
$$;

-- Trigger genérico (tablas con id) — ahora también guarda la ubicación.
create or replace function fn_audit_log()
returns trigger language plpgsql security definer as $$
declare v_ip text;
begin
  begin
    v_ip := split_part(
      coalesce(current_setting('request.headers', true)::json ->> 'x-forwarded-for', ''), ',', 1);
  exception when others then v_ip := null; end;
  if v_ip = '' then v_ip := null; end if;

  insert into audit_log (tabla, operacion, registro_id, datos_antes, datos_despues, admin_id, ip_address, admin_ubicacion)
  values (
    TG_TABLE_NAME, TG_OP, coalesce(NEW.id::text, OLD.id::text),
    case when TG_OP != 'INSERT' then to_jsonb(OLD) end,
    case when TG_OP != 'DELETE' then to_jsonb(NEW) end,
    auth.uid(), v_ip, _admin_loc()
  );
  return coalesce(NEW, OLD);
end;
$$;

-- Trigger de config_global (se llavea por 'clave') — mismo cambio.
create or replace function fn_audit_config_global()
returns trigger language plpgsql security definer as $$
declare v_ip text;
begin
  begin
    v_ip := split_part(
      coalesce(current_setting('request.headers', true)::json ->> 'x-forwarded-for', ''), ',', 1);
  exception when others then v_ip := null; end;
  if v_ip = '' then v_ip := null; end if;

  insert into audit_log (tabla, operacion, registro_id, datos_antes, datos_despues, admin_id, ip_address, admin_ubicacion)
  values (
    'config_global', TG_OP, coalesce(NEW.clave, OLD.clave),
    case when TG_OP != 'INSERT' then to_jsonb(OLD) end,
    case when TG_OP != 'DELETE' then to_jsonb(NEW) end,
    auth.uid(), v_ip, _admin_loc()
  );
  return coalesce(NEW, OLD);
end;
$$;
