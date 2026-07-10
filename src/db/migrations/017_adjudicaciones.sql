-- Migración: soporte para revisar licitaciones/Compras Ágiles cerradas
-- pendientes de adjudicación, y guardar el resultado cuando aparezca.
-- Correr en el SQL Editor de Supabase.

ALTER TABLE licitaciones_vistas
  ADD COLUMN estado VARCHAR(50),
  ADD COLUMN fecha_adjudicacion TIMESTAMP,
  ADD COLUMN numero_oferentes INTEGER,
  ADD COLUMN resuelta BOOLEAN DEFAULT false,
  ADD COLUMN fecha_ultima_revision TIMESTAMP;

ALTER TABLE compras_agiles_vistas
  ADD COLUMN id_orden_compra VARCHAR(100),
  ADD COLUMN resuelta BOOLEAN DEFAULT false,
  ADD COLUMN fecha_ultima_revision TIMESTAMP;
