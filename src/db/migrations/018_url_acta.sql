-- Migración: guardar la URL del acta de adjudicación de cada licitación,
-- para poder linkearla desde el análisis de datos.
-- Correr en el SQL Editor de Supabase.

ALTER TABLE licitaciones_vistas
  ADD COLUMN url_acta TEXT;
