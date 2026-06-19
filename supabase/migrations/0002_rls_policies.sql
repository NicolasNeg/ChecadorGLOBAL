-- RLS policies: anon puede INSERT y SELECT, pero NO UPDATE ni DELETE.
-- Esto protege los registros de borrado accidental o malicioso desde el cliente.

-- registros: insertar nuevas asistencias
drop policy if exists "anon_insert_registros" on registros;
create policy "anon_insert_registros"
  on registros
  for insert
  to anon
  with check (true);

-- registros: leer para el historial
drop policy if exists "anon_select_registros" on registros;
create policy "anon_select_registros"
  on registros
  for select
  to anon
  using (true);

-- empleados: leer nombre para el JOIN del historial
drop policy if exists "anon_select_empleados" on empleados;
create policy "anon_select_empleados"
  on empleados
  for select
  to anon
  using (true);
