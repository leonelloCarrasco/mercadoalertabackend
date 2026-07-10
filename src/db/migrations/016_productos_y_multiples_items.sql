-- Migración: soporte para alertas por producto específico, no solo por categoría.
--
-- 1. categorias_unspsc ahora mezcla nivel 3 (categoría) y nivel 4 (producto) —
--    se agrega la columna `nivel` para distinguirlos en el buscador.
-- 2. licitaciones_vistas ahora guarda TODOS los ítems (antes solo se guardaba
--    la categoría del primer ítem — una licitación puede tener varios productos
--    de categorías distintas, y nos estábamos perdiendo matches reales).
--
-- Correr en el SQL Editor de Supabase.

ALTER TABLE categorias_unspsc
  ADD COLUMN nivel VARCHAR(20);

ALTER TABLE licitaciones_vistas
  ADD COLUMN items JSONB;
