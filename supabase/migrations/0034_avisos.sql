-- ═══════════════════════════════════════════════════════════════════════════
-- AVISOS / ANUNCIOS
-- El admin diseña un aviso (editor drag-and-drop) → se guarda el modelo (diseno)
-- y su PNG renderizado (imagen_url, bucket público). El empleado ve los vigentes
-- de su plaza vía RPC. RLS por rol (rh todo / jefe su plaza). Idempotente.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists avisos (
  id          uuid primary key default gen_random_uuid(),
  titulo      text not null,
  plaza_id    bigint references plazas(id) on delete cascade,   -- null = todas las plazas
  inicia_en   date,                                             -- null = sin inicio
  termina_en  date,                                             -- null = sin fin
  imagen_url  text,                                             -- PNG renderizado (público)
  diseno      jsonb not null default '{}'::jsonb,               -- modelo de elementos (re-editar)
  activo      boolean not null default true,
  creado_por  uuid references auth.users(id) default auth.uid(),-- server-side, no se confía del cliente
  creado_en   timestamptz not null default now()
);

create index if not exists avisos_plaza_idx on avisos(plaza_id);

alter table avisos enable row level security;

-- RLS admin (reusa mi_rol()/mi_plaza_id() de 0004). Sin políticas anon: el
-- empleado entra solo por el RPC avisos_vigentes.
drop policy if exists "rh_all_avisos"   on avisos;
drop policy if exists "jefe_plaza_avisos" on avisos;
create policy "rh_all_avisos" on avisos
  for all to authenticated
  using (mi_rol() = 'rh') with check (mi_rol() = 'rh');
create policy "jefe_plaza_avisos" on avisos
  for all to authenticated
  using  (mi_rol() = 'jefe' and plaza_id = mi_plaza_id())
  with check (mi_rol() = 'jefe' and plaza_id = mi_plaza_id());

-- RPC empleado: avisos vigentes de su plaza (o globales), por fechas. SECURITY
-- DEFINER → salta la RLS y devuelve solo campos públicos. Patrón de 0033.
drop function if exists avisos_vigentes(bigint);
create function avisos_vigentes(p_plaza_id bigint)
returns table(id uuid, titulo text, imagen_url text, creado_en timestamptz)
language sql security definer set search_path = public
as $$
  select a.id, a.titulo, a.imagen_url, a.creado_en
  from avisos a
  where a.activo
    and (a.plaza_id is null or a.plaza_id = p_plaza_id)
    and (a.inicia_en  is null or a.inicia_en  <= current_date)
    and (a.termina_en is null or a.termina_en >= current_date)
  order by a.creado_en desc;
$$;
revoke all on function avisos_vigentes(bigint) from public, anon, authenticated;
grant  execute on function avisos_vigentes(bigint) to anon, service_role;

-- Storage: bucket público para lectura; escritura solo authenticated (admins).
-- Más estricto que fotos/firmas (los empleados no suben avisos).
insert into storage.buckets (id, name, public) values ('avisos','avisos',true)
  on conflict (id) do update set public = excluded.public;
drop policy if exists "public_read_avisos" on storage.objects;
drop policy if exists "auth_write_avisos"  on storage.objects;
create policy "public_read_avisos" on storage.objects
  for select to public using (bucket_id = 'avisos');
create policy "auth_write_avisos" on storage.objects
  for all to authenticated
  using (bucket_id = 'avisos') with check (bucket_id = 'avisos');
