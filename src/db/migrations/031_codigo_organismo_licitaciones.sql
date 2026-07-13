-- Migración: agrega codigo_organismo a licitaciones_vistas.
--
-- Contexto (ver migración 030): el catálogo organismos_compradores ya guarda
-- el CodigoOrganismo oficial de la API de Mercado Público, pero
-- licitaciones_vistas solo guardaba nombre_organismo (texto), así que el
-- matching de alertas (matching.service.js) comparaba por NOMBRE exacto —
-- fragil ante mayúsculas/espacios/variaciones de un mismo organismo.
--
-- Con esta columna, el matching pasa a comparar por código:
-- - Para licitaciones NUEVAS: guardarLicitacion (licitaciones.queries.js) ahora
--   guarda directo detalle.Comprador.CodigoOrganismo, que ya viene en la
--   respuesta de la API — no depende de ningún cruce por nombre.
-- - Para licitaciones YA guardadas (codigo_organismo NULL): correr el backfill
--   031a_backfill_codigo_organismo.sql, que lo completa cruzando
--   nombre_organismo contra organismos_compradores.nombre.
--
-- OJO: no se agrega FK contra organismos_compradores(codigo) a propósito —
-- si algún día la API reporta un CodigoOrganismo que todavía no está en
-- nuestro catálogo (organismo nuevo, catálogo desactualizado), no queremos
-- que eso rompa el guardado de la licitación completa. Se deja como columna
-- libre, nullable.
--
-- El filtro que ve el usuario en el formulario de alertas NO cambia: sigue
-- siendo el buscador de organismos por NOMBRE (organismos.queries.js /
-- GET /api/alerts/organismos/buscar). Lo único que cambia es CÓMO se
-- resuelve el match puertas adentro (ver matching.service.js).
--
-- Correr esto en el SQL Editor de Supabase (una sola vez), y después el
-- backfill (031a).

ALTER TABLE licitaciones_vistas
  ADD COLUMN codigo_organismo VARCHAR(20);

CREATE INDEX idx_licitaciones_vistas_codigo_organismo ON licitaciones_vistas (codigo_organismo);
