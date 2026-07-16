-- Migración: agrega los filtros de Compra Ágil de la API v2
-- (api2.mercadopublico.cl/v2/compra-agil) a busquedas_guardadas.
--
-- La API v2 combina libremente estos filtros entre sí (no son modos
-- excluyentes como en Licitaciones): texto libre (q), región (código
-- numérico INE, no el nombre — ver src/utils/regiones-compra-agil.js),
-- estado (uno o más), y "nuevas en las últimas N horas" (ttl_cambio_ms).
-- Por eso Compra Ágil pasa a tener solo DOS modos:
--   'codigo'  -> codigo_externo         (detalle por código, ignora el resto)
--   'listado' -> texto_libre / regiones / estados / horas_recientes,
--                combinables entre sí como el usuario quiera.
--
-- regiones (ya existía, TEXT[]) se reutiliza para Compra Ágil: guarda el
-- NOMBRE de la región (igual que en el resto de la app) — la traducción a
-- código numérico se hace recién al ejecutar la búsqueda, no al guardarla.

ALTER TABLE busquedas_guardadas
  ADD COLUMN texto_libre VARCHAR(255),
  ADD COLUMN estados TEXT[],
  ADD COLUMN horas_recientes INTEGER;

ALTER TABLE busquedas_guardadas DROP CONSTRAINT busquedas_guardadas_modo_check;
ALTER TABLE busquedas_guardadas ADD CONSTRAINT busquedas_guardadas_modo_check
  CHECK (modo IN ('codigo', 'estado_fecha', 'proveedor', 'organismo', 'listado'));
