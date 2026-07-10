-- Corrección de datos: antes de ajustar el criterio de Compra Ágil para ser
-- conservador (ver revisar-resoluciones.js — ahora solo "proveedor_seleccionado"
-- se considera un resultado final confirmado), se habían marcado como resueltas
-- Compras Ágiles con cualquier otro estado distinto de "publicada" — lo cual
-- podía incluir estados intermedios desconocidos. Esto las reabre para que el
-- cron diario (03:00) las vuelva a revisar.
--
-- OJO: si alguna ya tiene fecha_cierre de hace más de 90 días, el cron no la
-- va a volver a tomar — revisa el diagnóstico (020a) primero.
--
-- Correr en el SQL Editor de Supabase.

UPDATE compras_agiles_vistas
SET resuelta = false
WHERE resuelta = true AND (estado IS DISTINCT FROM 'proveedor_seleccionado');
