-- Migración: soporte para licitaciones de tipo Obras (O1/O2), que usan un
-- sistema de códigos propio de 9 dígitos, no el estándar UNSPSC de 8.
--
-- A diferencia de UNSPSC, no es una taxonomía rica — en la práctica existen
-- solo 3 categorías reales (confirmado con datos propios: Obra, Consultoría,
-- Obra MINVU), sin sub-jerarquía. El match para estas siempre es EXACTO
-- (ver matching.service.js), nunca por prefijo.
--
-- Correr en el SQL Editor de Supabase.

ALTER TABLE categorias_unspsc ALTER COLUMN codigo TYPE VARCHAR(10);

INSERT INTO categorias_unspsc (codigo, titulo, nivel) VALUES
  ('101000000', 'Licitación Pública de Obra', 'obra'),
  ('102000000', 'Licitación Pública de Consultoría', 'obra'),
  ('104000000', 'Licitación Pública de Obra MINVU', 'obra')
ON CONFLICT (codigo) DO UPDATE SET titulo = EXCLUDED.titulo, nivel = EXCLUDED.nivel;
