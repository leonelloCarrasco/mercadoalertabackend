-- Migración: guardar productos_solicitados de cada Compra Ágil (JSONB),
-- para poder hacer matching de alertas por categoría — cada producto trae un
-- codigo_producto de 8 dígitos, mismo formato/nivel que usamos para licitaciones.
-- Correr en el SQL Editor de Supabase.

ALTER TABLE compras_agiles_vistas
  ADD COLUMN productos_solicitados JSONB;
