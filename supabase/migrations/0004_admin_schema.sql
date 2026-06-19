-- ═══════════════════════════════════════════════════════════════════════════
-- 0004_admin_schema.sql
-- Dashboard administrativo: plazas (geocercas), turnos, RBAC de admins,
-- validación de geocerca por trigger, audit log completo.
--
-- Prerequisitos:
--   1. Habilitar Supabase Auth (email/password) en el dashboard.
--   2. Crear usuarios admin en Auth → Users.
--   3. Luego insertar su UUID en perfiles_admin con el rol correcto.
--      Ejemplo:
--        INSERT INTO perfiles_admin (id, nombre, email, rol)
--        VALUES ('<uuid-del-auth>', 'Recursos Humanos', 'rh@empresa.com', 'rh');
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Plazas (geocercas / centros de trabajo) ───────────────────────────────
create table if not exists plazas (
  id           bigserial primary key,
  nombre       text not null,
  ciudad       text not null,
  latitud      double precision not null,
  longitud     double precision not null,
  radio_metros int not null default 100 check (radio_metros between 10 and 5000),
  activo       boolean not null default true,
  created_at   timestamptz not null default now()
);

-- ── Turnos ────────────────────────────────────────────────────────────────
create table if not exists turnos (
  id                      bigserial primary key,
  plaza_id                bigint not null references plazas(id) on delete cascade,
  nombre                  text not null,
  hora_entrada            time not null,
  hora_salida             time not null,
  tolerancia_entrada_min  int not null default 15 check (tolerancia_entrada_min >= 0),
  tolerancia_salida_min   int not null default 10  check (tolerancia_salida_min >= 0),
  -- dias_semana: 1=lun … 7=dom  (array de ints)
  dias_semana             int[] not null default '{1,2,3,4,5}',
  activo                  boolean not null default true,
  created_at              timestamptz not null default now()
);

-- ── Extender empleados con plaza y turno ──────────────────────────────────
alter table empleados
  add column if not exists plaza_id bigint references plazas(id),
  add column if not exists turno_id bigint references turnos(id);

-- ── Extender registros con resultado de geocerca ──────────────────────────
alter table registros
  add column if not exists geocerca_valida  boolean,
  add column if not exists distancia_metros int;

-- ── Perfiles de administrador (vinculados a auth.users de Supabase) ───────
create table if not exists perfiles_admin (
  id         uuid primary key references auth.users(id) on delete cascade,
  nombre     text not null,
  email      text not null,
  rol        text not null check (rol in ('rh', 'jefe')),
  plaza_id   bigint references plazas(id),   -- sólo obligatorio para 'jefe'
  activo     boolean not null default true,
  created_at timestamptz not null default now(),
  constraint jefe_necesita_plaza check (
    rol = 'rh' or plaza_id is not null
  )
);

-- ── Audit log (historial de cambios) ─────────────────────────────────────
create table if not exists audit_log (
  id            bigserial primary key,
  tabla         text not null,
  operacion     text not null,               -- INSERT | UPDATE | DELETE
  registro_id   text,
  datos_antes   jsonb,
  datos_despues jsonb,
  admin_id      uuid references auth.users(id),
  ip_address    text,
  created_at    timestamptz not null default now()
);

-- ═══════════════════════════════════════════════════════════════════════════
-- FUNCIONES AUXILIARES DE RBAC
-- ═══════════════════════════════════════════════════════════════════════════

-- Rol del admin autenticado actual ('rh' | 'jefe' | null)
create or replace function mi_rol()
returns text language sql stable security definer as $$
  select rol from perfiles_admin
  where id = auth.uid() and activo = true
  limit 1;
$$;

-- Plaza asignada al jefe actual (null si es RH)
create or replace function mi_plaza_id()
returns bigint language sql stable security definer as $$
  select plaza_id from perfiles_admin
  where id = auth.uid() and activo = true
  limit 1;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- FUNCIÓN DE DISTANCIA (Haversine, sin PostGIS)
-- Devuelve distancia en metros entre dos coordenadas geográficas.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function calcular_distancia_metros(
  lat1 double precision, lon1 double precision,
  lat2 double precision, lon2 double precision
)
returns double precision language sql immutable as $$
  select 6371000.0 * acos(
    least(1.0, greatest(-1.0,
      cos(radians(lat1)) * cos(radians(lat2))
      * cos(radians(lon2) - radians(lon1))
      + sin(radians(lat1)) * sin(radians(lat2))
    ))
  );
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- TRIGGER: validar geocerca ANTES de insertar un registro
-- Si el empleado tiene plaza asignada y está fuera del radio → RECHAZAR.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function fn_validar_geocerca()
returns trigger language plpgsql security definer as $$
declare
  v_plaza        plazas%rowtype;
  v_distancia    double precision;
begin
  -- Buscar plaza del empleado
  select p.* into v_plaza
  from plazas p
  join empleados e on e.plaza_id = p.id
  where e.id = NEW.id_empleado and p.activo = true;

  -- Sin plaza asignada: marcar sin validación y permitir
  if not found then
    NEW.geocerca_valida  := null;
    NEW.distancia_metros := null;
    return NEW;
  end if;

  -- Sin coordenadas: marcar inválida y BLOQUEAR
  if NEW.latitud is null or NEW.longitud is null then
    raise exception 'UBICACION_REQUERIDA: El registro requiere coordenadas de ubicación.';
  end if;

  v_distancia := calcular_distancia_metros(
    NEW.latitud, NEW.longitud,
    v_plaza.latitud, v_plaza.longitud
  );

  NEW.distancia_metros := round(v_distancia)::int;
  NEW.geocerca_valida  := v_distancia <= v_plaza.radio_metros;

  -- Bloquear si está fuera del radio
  if not NEW.geocerca_valida then
    raise exception 'FUERA_GEOCERCA: Estás a % metros de la plaza "%" (radio permitido: % m). Verifica tu ubicación.',
      round(v_distancia)::int,
      v_plaza.nombre,
      v_plaza.radio_metros;
  end if;

  return NEW;
end;
$$;

drop trigger if exists trg_validar_geocerca on registros;
create trigger trg_validar_geocerca
  before insert on registros
  for each row execute function fn_validar_geocerca();

-- ═══════════════════════════════════════════════════════════════════════════
-- TRIGGER: audit log automático para tablas críticas
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function fn_audit_log()
returns trigger language plpgsql security definer as $$
begin
  insert into audit_log (tabla, operacion, registro_id, datos_antes, datos_despues, admin_id)
  values (
    TG_TABLE_NAME,
    TG_OP,
    coalesce(NEW.id::text, OLD.id::text),
    case when TG_OP != 'INSERT' then to_jsonb(OLD) end,
    case when TG_OP != 'DELETE' then to_jsonb(NEW) end,
    auth.uid()
  );
  return coalesce(NEW, OLD);
end;
$$;

drop trigger if exists audit_plazas on plazas;
create trigger audit_plazas
  after insert or update or delete on plazas
  for each row execute function fn_audit_log();

drop trigger if exists audit_empleados on empleados;
create trigger audit_empleados
  after insert or update or delete on empleados
  for each row execute function fn_audit_log();

drop trigger if exists audit_turnos on turnos;
create trigger audit_turnos
  after insert or update or delete on turnos
  for each row execute function fn_audit_log();

-- ═══════════════════════════════════════════════════════════════════════════
-- FUNCIÓN SEGURA: crear empleado con PIN hasheado
-- Sólo accesible para admins autenticados.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function crear_empleado(
  p_nombre   text,
  p_pin      text,
  p_plaza_id bigint,
  p_turno_id bigint default null
)
returns empleados language plpgsql security definer set search_path = public, extensions as $$
declare
  v_rol  text := mi_rol();
  v_emp  empleados;
begin
  if v_rol is null then
    raise exception 'No autorizado';
  end if;
  if v_rol = 'jefe' and p_plaza_id != mi_plaza_id() then
    raise exception 'Solo puedes crear empleados en tu plaza';
  end if;

  insert into empleados (nombre, pin_hash, plaza_id, turno_id, activo)
  values (p_nombre, crypt(p_pin, gen_salt('bf')), p_plaza_id, p_turno_id, true)
  returning * into v_emp;

  insert into audit_log (tabla, operacion, registro_id, datos_despues, admin_id)
  values ('empleados', 'INSERT', v_emp.id::text,
          jsonb_build_object('nombre', p_nombre, 'plaza_id', p_plaza_id), auth.uid());

  return v_emp;
end;
$$;

grant execute on function crear_empleado(text, text, bigint, bigint) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- FUNCIÓN SEGURA: actualizar PIN de empleado
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function actualizar_pin_empleado(
  p_empleado_id bigint,
  p_nuevo_pin   text
)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare
  v_rol text := mi_rol();
begin
  if v_rol is null then
    raise exception 'No autorizado';
  end if;
  if v_rol = 'jefe' and not exists (
    select 1 from empleados where id = p_empleado_id and plaza_id = mi_plaza_id()
  ) then
    raise exception 'El empleado no pertenece a tu plaza';
  end if;

  update empleados
  set pin_hash = crypt(p_nuevo_pin, gen_salt('bf'))
  where id = p_empleado_id;

  insert into audit_log (tabla, operacion, registro_id, datos_despues, admin_id)
  values ('empleados', 'UPDATE_PIN', p_empleado_id::text,
          jsonb_build_object('pin_actualizado', true), auth.uid());
end;
$$;

grant execute on function actualizar_pin_empleado(bigint, text) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- RLS: POLÍTICAS DE SEGURIDAD
-- ═══════════════════════════════════════════════════════════════════════════

-- ── plazas ────────────────────────────────────────────────────────────────
alter table plazas enable row level security;

drop policy if exists "rh_all_plazas" on plazas;
create policy "rh_all_plazas" on plazas
  to authenticated
  using (mi_rol() = 'rh')
  with check (mi_rol() = 'rh');

drop policy if exists "jefe_select_plaza" on plazas;
create policy "jefe_select_plaza" on plazas
  for select to authenticated
  using (mi_rol() = 'jefe' and id = mi_plaza_id());

-- ── turnos ────────────────────────────────────────────────────────────────
alter table turnos enable row level security;

drop policy if exists "rh_all_turnos" on turnos;
create policy "rh_all_turnos" on turnos
  to authenticated
  using (mi_rol() = 'rh')
  with check (mi_rol() = 'rh');

drop policy if exists "jefe_select_turnos" on turnos;
create policy "jefe_select_turnos" on turnos
  for select to authenticated
  using (mi_rol() = 'jefe' and plaza_id = mi_plaza_id());

-- ── empleados (extender políticas existentes para autenticados) ───────────
-- Nota: las políticas anon existentes siguen vigentes para la app empleados.
drop policy if exists "rh_all_empleados" on empleados;
create policy "rh_all_empleados" on empleados
  to authenticated
  using (mi_rol() = 'rh')
  with check (mi_rol() = 'rh');

drop policy if exists "jefe_select_empleados" on empleados;
create policy "jefe_select_empleados" on empleados
  for select to authenticated
  using (mi_rol() = 'jefe' and plaza_id = mi_plaza_id());

drop policy if exists "jefe_update_empleados" on empleados;
create policy "jefe_update_empleados" on empleados
  for update to authenticated
  using (mi_rol() = 'jefe' and plaza_id = mi_plaza_id())
  with check (mi_rol() = 'jefe' and plaza_id = mi_plaza_id());

-- ── registros (extender políticas existentes) ─────────────────────────────
drop policy if exists "rh_all_registros" on registros;
create policy "rh_all_registros" on registros
  to authenticated
  using (mi_rol() = 'rh')
  with check (mi_rol() = 'rh');

drop policy if exists "jefe_select_registros" on registros;
create policy "jefe_select_registros" on registros
  for select to authenticated
  using (
    mi_rol() = 'jefe' and
    id_empleado in (
      select id from empleados where plaza_id = mi_plaza_id()
    )
  );

-- ── perfiles_admin ────────────────────────────────────────────────────────
alter table perfiles_admin enable row level security;

drop policy if exists "rh_all_perfiles" on perfiles_admin;
create policy "rh_all_perfiles" on perfiles_admin
  to authenticated
  using (mi_rol() = 'rh')
  with check (mi_rol() = 'rh');

drop policy if exists "self_select_perfil" on perfiles_admin;
create policy "self_select_perfil" on perfiles_admin
  for select to authenticated
  using (id = auth.uid());

-- ── audit_log (sólo RH puede leer) ───────────────────────────────────────
alter table audit_log enable row level security;

drop policy if exists "rh_select_audit" on audit_log;
create policy "rh_select_audit" on audit_log
  for select to authenticated
  using (mi_rol() = 'rh');

-- ── Índices de performance ────────────────────────────────────────────────
create index if not exists idx_empleados_plaza  on empleados(plaza_id);
create index if not exists idx_registros_hora   on registros(hora desc);
create index if not exists idx_registros_emp    on registros(id_empleado);
create index if not exists idx_audit_log_ts     on audit_log(created_at desc);
create index if not exists idx_turnos_plaza     on turnos(plaza_id);
