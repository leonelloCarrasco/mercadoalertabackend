-- Migración: árbol de rubros para el buscador de alertas.
--
-- El usuario conoce el concepto "Rubro" más que "Categoría UNSPSC" — es el
-- mismo nivel 3 (categoria, código termina en "00") que ya existía en
-- categorias_unspsc, solo que ahora se expone también su jerarquía completa
-- (Nivel1 = Segmento, Nivel2 = Familia) para poder navegarlo como árbol:
-- Segmento -> Familia -> Rubro (nivel3, seleccionable).
--
-- Se agregan nivel1/nivel2 a la tabla existente en vez de crear una tabla
-- aparte, porque siguen siendo filas del mismo catálogo (mismo codigo/titulo/nivel
-- de antes) — solo se les suma el dato de a qué segmento/familia pertenecen.
-- Quedan NULL para las 3 categorías "obra" (migración 022, códigos de 9 dígitos,
-- taxonomía propia sin jerarquía real) — no aplican al árbol.
--
-- Después de correr esta migración, hay que re-correr el seed para poblar los
-- datos nuevos (regenerado desde el Excel de rubros con la jerarquía completa):
--   node scripts/seed-categorias-unspsc.js
--
-- Correr esto en el SQL Editor de Supabase (una sola vez).

ALTER TABLE categorias_unspsc
  ADD COLUMN nivel1 VARCHAR(255),
  ADD COLUMN nivel2 VARCHAR(255);

CREATE INDEX idx_categorias_unspsc_nivel1_nivel2 ON categorias_unspsc (nivel1, nivel2) WHERE nivel = 'categoria';
