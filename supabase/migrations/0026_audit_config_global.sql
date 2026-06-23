-- 0026_audit_config_global.sql — audita cambios de configuración de empresa
-- (nombre, dirección, RFC, logo, tolerancia, jornada) en el audit_log, para que
-- aparezcan en el Log de Auditoría como "se modificó la configuración".
--
-- fn_audit_log() usa NEW.id, pero config_global se llavea por 'clave', así que
-- necesita su propia función. Replica la captura de IP de 0015_audit_ip.
-- Idempotente: create or replace + drop trigger if exists.

create or replace function fn_audit_config_global()
returns trigger language plpgsql security definer as $$
declare
  v_ip text;
begin
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
    'config_global',
    TG_OP,
    coalesce(NEW.clave, OLD.clave),
    case when TG_OP != 'INSERT' then to_jsonb(OLD) end,
    case when TG_OP != 'DELETE' then to_jsonb(NEW) end,
    auth.uid(),
    v_ip
  );
  return coalesce(NEW, OLD);
end;
$$;

drop trigger if exists audit_config_global on config_global;
create trigger audit_config_global
  after insert or update or delete on config_global
  for each row execute function fn_audit_config_global();
