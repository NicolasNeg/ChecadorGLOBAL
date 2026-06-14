-- EQS Checador — schema inicial
create extension if not exists pgcrypto;

-- Empleados
create table empleados (
  id         bigint generated always as identity primary key,
  nombre     text    not null,
  pin_hash   text    not null,
  activo     boolean not null default true,
  created_at timestamptz default now()
);

-- Registros de asistencia
create table registros (
  id          bigint generated always as identity primary key,
  id_empleado bigint not null references empleados(id),
  tipo        text   not null check (tipo in ('entrada','salida')),
  hora        timestamptz not null default now(),
  latitud     double precision,
  longitud    double precision,
  ruta_foto   text,
  ruta_firma  text,
  created_at  timestamptz default now()
);

create index registros_empleado_hora_idx on registros (id_empleado, hora desc);

-- RLS deny-by-default (las Edge Functions usan service role)
alter table empleados enable row level security;
alter table registros  enable row level security;
-- Sin policies → anon no puede leer ni escribir nada

-- RPC interna para verificar PIN
create function verificar_pin(p_pin text)
returns table(id bigint, nombre text)
language sql security definer set search_path = public
as $$
  select e.id, e.nombre
  from   empleados e
  where  e.activo = true
    and  e.pin_hash = crypt(p_pin, e.pin_hash)
  limit 1;
$$;

revoke all on function verificar_pin(text) from public, anon, authenticated;
grant  execute on function verificar_pin(text) to service_role;

-- Storage buckets privados
insert into storage.buckets (id, name, public)
values ('fotos','fotos',false), ('firmas','firmas',false)
on conflict do nothing;
