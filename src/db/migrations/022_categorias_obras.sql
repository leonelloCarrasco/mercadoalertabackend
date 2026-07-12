-- Migración: soporte para licitaciones de tipo Obras (O1/O2), que usan un
-- sistema de códigos propio de 9 dígitos, no el estándar UNSPSC de 8.
--
-- A diferencia de UNSPSC, no es una taxonomía rica — en la práctica existen
-- solo 3 categorías reales (confirmado con datos propios: Obra, Consultoría,
-- Obra MINVU), sin sub-jerarquía. El match para estas siempre es EXACTO
-- (ver matching.service.js), nunca por prefijo.
--
-- ACTUALIZACIÓN (post-migración 025, árbol de rubros): el Excel de origen
-- resultó tener jerarquía real para estos códigos (Obras/Consultoría/Obras
-- MINVU sí tienen sub-niveles, con códigos específicos como "Licitación
-- Pública/Privada de Obra"). El seed (scripts/seed-categorias-unspsc.js)
-- ahora importa esa jerarquía completa y, vía ON CONFLICT DO UPDATE, actualiza
-- el título de estos 3 códigos al del grupo real ("Obras", "Consultoria",
-- "Obras MINVU") en vez del título de producto específico que se puso acá
-- a mano. Esto NO afecta el matching (sigue siendo por código exacto, no
-- cambia qué licitaciones matchean), solo el texto que se muestra en el
-- buscador/árbol de alertas. Este INSERT queda como respaldo por si algún
-- día se reinstala desde cero sin correr el seed.
--
-- Correr en el SQL Editor de Supabase.

ALTER TABLE categorias_unspsc ALTER COLUMN codigo TYPE VARCHAR(10);

INSERT INTO categorias_unspsc (codigo, titulo, nivel) VALUES
  ('101000000', 'Licitación Pública de Obra', 'obra'),
  ('102000000', 'Licitación Pública de Consultoría', 'obra'),
  ('104000000', 'Licitación Pública de Obra MINVU', 'obra')
ON CONFLICT (codigo) DO UPDATE SET titulo = EXCLUDED.titulo, nivel = EXCLUDED.nivel;
