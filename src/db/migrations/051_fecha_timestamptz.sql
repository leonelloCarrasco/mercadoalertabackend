-- Corrige un bug de zona horaria (ver conversación de agosto 2026): estas
-- columnas guardaban TIMESTAMP (sin zona) con el string crudo que manda
-- Mercado Público — que viene en hora de Chile, sin ningún sufijo que lo
-- indique. Al comparar con NOW() (que Postgres interpreta según la zona
-- horaria de la SESIÓN — UTC en producción, sin configuración explícita),
-- esos dígitos de hora de Chile se malinterpretaban como si fueran UTC,
-- corriendo cualquier comparación 3-4 horas (según la época del año, por
-- el horario de verano). Afectaba recordatorios de cierre, la detección de
-- "pendiente de resolución", y el borrado por antigüedad.
--
-- El USING de acá abajo reinterpreta cada fila EXISTENTE asumiendo que sus
-- dígitos son hora de Chile (AT TIME ZONE 'America/Santiago', que resuelve
-- solo el offset -3 u -4 que correspondía a la fecha de CADA fila, no un
-- valor fijo para toda la tabla — importante porque hay filas guardadas
-- tanto en invierno como en verano).
--
-- El código de aplicación (guardarLicitacion, guardarCompraAgil,
-- revisar-resoluciones.js) ya se actualizó para convertir con
-- parsearFechaChile (utils/fecha-chile.js) ANTES de guardar cualquier
-- fecha nueva — así que de acá en adelante entra ya correcta, sin
-- depender de que la columna sea TIMESTAMPTZ para "arreglarse sola".

ALTER TABLE licitaciones_vistas
  ALTER COLUMN fecha_publicacion TYPE TIMESTAMPTZ USING fecha_publicacion AT TIME ZONE 'America/Santiago',
  ALTER COLUMN fecha_cierre TYPE TIMESTAMPTZ USING fecha_cierre AT TIME ZONE 'America/Santiago',
  ALTER COLUMN fecha_adjudicacion TYPE TIMESTAMPTZ USING fecha_adjudicacion AT TIME ZONE 'America/Santiago';

ALTER TABLE compras_agiles_vistas
  ALTER COLUMN fecha_publicacion TYPE TIMESTAMPTZ USING fecha_publicacion AT TIME ZONE 'America/Santiago',
  ALTER COLUMN fecha_cierre TYPE TIMESTAMPTZ USING fecha_cierre AT TIME ZONE 'America/Santiago';

-- historico_precios.fecha_adjudicacion recibe, para licitaciones, el mismo
-- valor (ya convertido en JS) que fecha_adjudicacion de licitaciones_vistas
-- — y para Compra Ágil, fecha_cierre (también ya convertido). Los datos ya
-- guardados acá vinieron de revisar-resoluciones.js, con el mismo bug de
-- origen que las tablas de arriba, así que se corrige con el mismo USING.
ALTER TABLE historico_precios
  ALTER COLUMN fecha_adjudicacion TYPE TIMESTAMPTZ USING fecha_adjudicacion AT TIME ZONE 'America/Santiago';
