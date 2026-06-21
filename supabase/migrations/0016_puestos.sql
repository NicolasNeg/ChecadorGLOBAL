-- ═══════════════════════════════════════════════════════════════════════════
-- 0016: catálogo de puestos (Configuración → Puestos). El select del formulario
-- de empleado se llena desde aquí; empleados.puesto sigue siendo texto (guarda
-- el nombre elegido), así no hace falta migrar la columna existente.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists puestos (
  id         bigserial primary key,
  nombre     text not null unique,
  created_at timestamptz not null default now()
);

-- Auditoría (mismo patrón que plazas/turnos/empleados).
drop trigger if exists audit_puestos on puestos;
create trigger audit_puestos
  after insert or update or delete on puestos
  for each row execute function fn_audit_log();

-- ── RLS ────────────────────────────────────────────────────────────────────
alter table puestos enable row level security;

-- Cualquier admin autenticado puede leer (para poblar el select).
drop policy if exists "auth_read_puestos" on puestos;
create policy "auth_read_puestos" on puestos
  for select to authenticated using (true);

-- Sólo RH crea/edita/borra (es Configuración, data-rh-only en el panel).
drop policy if exists "rh_write_puestos" on puestos;
create policy "rh_write_puestos" on puestos
  for all to authenticated
  using (mi_rol() = 'rh')
  with check (mi_rol() = 'rh');
