-- Fase 1 del plan de retención de datos: tabla liviana, SIN JSON, que
-- archiva solo los campos de precio que necesita Análisis de Precios.
--
-- Se llena en DOS momentos (ver historico-precios.queries.js):
--  1. En el momento en que revisar-resoluciones.js confirma que algo se
--     resolvió (camino principal, más rápido).
--  2. Como red de seguridad, justo antes de que el cron de limpieza borre
--     una licitación/Compra Ágil vieja — por si llegó a resolverse por otro
--     camino que nunca pasó por (1) (ej. algo que se guarda YA resuelto
--     desde el principio, ver guardarLicitacion/guardarCompraAgil).
--
-- A propósito no reemplaza todavía a licitaciones_vistas/compras_agiles_vistas
-- como fuente de /api/analisis/precios — el menú de Análisis de Precios
-- sigue deshabilitado. Por ahora solo archiva en silencio.
CREATE TABLE historico_precios (
  id SERIAL PRIMARY KEY,
  codigo_externo VARCHAR(100) NOT NULL,
  fuente VARCHAR(20) NOT NULL CHECK (fuente IN ('licitacion', 'compra_agil')),
  codigo_producto VARCHAR(20) NOT NULL,
  nombre_producto TEXT,
  proceso_nombre TEXT,
  organismo TEXT,
  fecha_adjudicacion TIMESTAMP,
  rut_proveedor VARCHAR(30),
  nombre_proveedor TEXT,
  precio_unitario NUMERIC,
  cantidad NUMERIC,
  gano BOOLEAN NOT NULL DEFAULT true,
  motivo_rechazo TEXT,
  numero_oferentes INTEGER,
  url_acta TEXT,
  archivado_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- codigo_producto: para el filtro por producto/categoría (exacto o por
-- prefijo con LIKE, mismo criterio que ya usa /api/analisis/precios).
CREATE INDEX idx_historico_precios_codigo_producto ON historico_precios (codigo_producto);
-- fecha_adjudicacion: para ordenar "más reciente primero".
CREATE INDEX idx_historico_precios_fecha ON historico_precios (fecha_adjudicacion);
-- codigo_externo: para el chequeo "¿ya está archivado?" que hace la red de
-- seguridad antes de borrar (evita archivar dos veces el mismo proceso).
CREATE INDEX idx_historico_precios_codigo_externo ON historico_precios (codigo_externo);
