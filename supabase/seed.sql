-- Datos de prueba (re-ejecutable).
-- María López PIN 1234 · Carlos Pérez PIN 5678
--
-- Nota: se asigna turno_id (para mostrar horario) pero NO plaza_id, de modo que
-- el trigger de geocerca NO bloquee las pruebas de check-in desde cualquier lugar.
-- Para probar la geocerca, asigna plaza_id a un empleado desde el panel admin.

-- Limpia datos de demo previos (idempotente)
delete from registros where id_empleado in (
  select id from empleados where nombre in ('María López','Carlos Pérez')
);
delete from empleados where nombre in ('María López','Carlos Pérez');

-- Plaza + turno de ejemplo y empleados con perfil profesional
with p as (
  insert into plazas (nombre, ciudad, latitud, longitud, radio_metros)
  values ('Oficina Central', 'Ciudad de México', 19.4326, -99.1332, 150)
  returning id
),
t as (
  insert into turnos (plaza_id, nombre, hora_entrada, hora_salida)
  select id, 'Matutino', '09:00', '18:00' from p
  returning id
)
insert into empleados
  (nombre, pin_hash, activo, numero_empleado, puesto, email, telefono, fecha_ingreso, rol, turno_id)
select v.nombre, crypt(v.pin, gen_salt('bf')), true,
       v.numero_empleado, v.puesto, v.email, v.telefono, v.fecha_ingreso::date, v.rol, t.id
from (values
  ('María López',  '1234', 'EQS-001', 'Recepcionista',       'maria@empresa.com',  '55-1234-5678', '2024-03-01', 'empleado'),
  ('Carlos Pérez', '5678', 'EQS-002', 'Supervisor de Piso',  'carlos@empresa.com', '55-8765-4321', '2023-08-15', 'supervisor')
) as v(nombre, pin, numero_empleado, puesto, email, telefono, fecha_ingreso, rol)
cross join t;
