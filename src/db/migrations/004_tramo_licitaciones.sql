-- Migración: guardar el tipo de licitación y su tramo de monto en UTM,
-- para usarlo cuando no hay MontoEstimado exacto publicado.
-- Correr esto en el SQL Editor de Supabase (una sola vez).

ALTER TABLE licitaciones_vistas
  ADD COLUMN tipo_licitacion VARCHAR(10),
  ADD COLUMN monto_utm_min NUMERIC,
  ADD COLUMN monto_utm_max NUMERIC;
