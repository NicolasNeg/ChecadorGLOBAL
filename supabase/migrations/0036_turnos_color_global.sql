-- 0036_turnos_color_global.sql — color elegible por turno + turno global.
-- color: hex '#RRGGBB' (null → el front usa la paleta por id). plaza_id nullable:
-- null = turno disponible en todas las plazas. Idempotente.

alter table turnos add column if not exists color text;

-- plaza_id era NOT NULL (0004). Permitir null para turnos globales.
alter table turnos alter column plaza_id drop not null;
