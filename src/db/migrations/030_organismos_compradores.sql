-- Migración: catálogo propio de organismos compradores (Listado oficial de
-- ChileCompra, ~1.179 instituciones), para dejar de depender de lo que ya se
-- haya importado en licitaciones_vistas/compras_agiles_vistas para poblar el
-- buscador de organismos del formulario de alertas.
--
-- Antes: buscarOrganismos (organismos.queries.js) hacía SELECT DISTINCT sobre
-- licitaciones_vistas.nombre_organismo / compras_agiles_vistas.nombre_institucion
-- — es decir, el buscador solo ofrecía organismos que YA hubiéramos visto en
-- algún proceso importado. Un organismo que nunca publicó nada (o que
-- solo publicó antes de que empezáramos a scrapear) no aparecía.
--
-- Ahora: se puebla esta tabla directamente desde el listado oficial (ver
-- scripts/seed-organismos-compradores.js), así el buscador ofrece el
-- universo completo de organismos registrados en Mercado Público, no solo
-- los que ya vimos.
--
-- `codigo` es el CodigoOrganismo oficial de la API de Mercado Público (campo
-- documentado: Listado/Comprador/CodigoOrganismo) — el mismo identificador
-- que usa la propia API para filtrar licitaciones por organismo
-- (?CodigoOrganismo=6945). Queda guardado acá pensando en una mejora futura:
-- hoy el matching de alertas (matching.service.js) sigue comparando por
-- NOMBRE exacto contra lo que reporta cada licitación/Compra Ágil, porque
-- licitaciones_vistas todavía no guarda el CodigoOrganismo de cada proceso.
-- Si más adelante se agrega esa columna, se podría matchear por código en vez
-- de por texto — mucho más robusto que comparar strings.
--
-- Después de correr esta migración, hay que correr el seed:
--   node scripts/seed-organismos-compradores.js
--
-- Correr esto en el SQL Editor de Supabase (una sola vez).

CREATE TABLE organismos_compradores (
  codigo VARCHAR(20) PRIMARY KEY,
  nombre TEXT NOT NULL,
  sector VARCHAR(100)
);

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX idx_organismos_compradores_nombre ON organismos_compradores USING gin (nombre gin_trgm_ops);
