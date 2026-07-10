-- Migración: tabla de categorías UNSPSC (nivel Commodity, 8 dígitos), para
-- que el usuario pueda buscar categorías por texto al crear una alerta, en
-- vez de tener que saberse el código de memoria.
--
-- Se puebla con el script scripts/seed-categorias-unspsc.js, NO con INSERTs
-- acá (son ~10.700 filas, demasiado para un archivo de migración SQL).
--
-- Correr esta migración primero, y DESPUÉS correr:
--   node scripts/seed-categorias-unspsc.js
--
-- Correr en el SQL Editor de Supabase.

CREATE TABLE categorias_unspsc (
  codigo VARCHAR(8) PRIMARY KEY,
  titulo TEXT NOT NULL
);

-- pg_trgm permite buscar por substring (no solo por prefijo) de forma rápida
-- incluso sobre las ~10.700 filas de esta tabla. Debe crearse ANTES del índice
-- que la usa.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX idx_categorias_unspsc_titulo ON categorias_unspsc USING gin (titulo gin_trgm_ops);
