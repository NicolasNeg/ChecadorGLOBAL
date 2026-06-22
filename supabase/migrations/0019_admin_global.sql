-- 0019_admin_global.sql
-- Tercer concepto de rol: ADMIN_GLOBAL (super-admin por encima de rh/jefe).
-- NO toca perfiles_admin.rol ('rh'/'jefe') ni mi_rol(); es una bandera aparte
-- que habilita las secciones USUARIOS y ADMINISTRACION del panel.
-- Idempotente.

-- ── Bandera + foto de perfil del admin ──────────────────────────────────────
alter table perfiles_admin add column if not exists es_admin_global boolean not null default false;
alter table perfiles_admin add column if not exists foto_url        text;

-- Helper: ¿el usuario autenticado es admin global y activo?
create or replace function es_admin_global()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    (select es_admin_global from perfiles_admin where id = auth.uid() and activo = true),
    false);
$$;

-- El admin global gestiona TODOS los perfiles (alta/edición/baja/foto).
drop policy if exists "admin_global_all_perfiles" on perfiles_admin;
create policy "admin_global_all_perfiles" on perfiles_admin
  to authenticated
  using (es_admin_global())
  with check (es_admin_global());

-- ── Configuración global del trabajo (sección ADMINISTRACION) ────────────────
-- Clave/valor: simple y flexible. ponytail: KV en vez de columnas tipadas;
-- migrar a columnas si algún ajuste necesita validación/consulta server-side.
create table if not exists config_global (
  clave        text primary key,
  valor        text,
  actualizado_en timestamptz not null default now()
);

alter table config_global enable row level security;

drop policy if exists "todos_leen_config" on config_global;
create policy "todos_leen_config" on config_global
  for select to authenticated using (true);

drop policy if exists "admin_global_escribe_config" on config_global;
create policy "admin_global_escribe_config" on config_global
  to authenticated
  using (es_admin_global())
  with check (es_admin_global());

-- Ajustes por defecto (no se sobreescriben si ya existen).
insert into config_global (clave, valor) values
  ('nombre_empresa',         'EQS'),
  ('tolerancia_retardo_min', '10'),
  ('jornada_horas',          '8')
on conflict (clave) do nothing;
