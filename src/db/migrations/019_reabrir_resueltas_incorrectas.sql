-- Corrección de datos: antes de ajustar ESTADOS_FINALES_LICITACION para ser
-- conservador (ver revisar-resoluciones.js — ahora solo "Adjudicada" se
-- considera un resultado final confirmado), se habían marcado como resueltas
-- licitaciones con estado "Desierta", "Revocada", "Suspendida" o "Cerrada" —
-- estados que en realidad no están confirmados como finales. Esto las reabre
-- para que el cron diario (03:00) las vuelva a revisar.
--
-- OJO: si alguna de estas ya tiene fecha_cierre de hace más de 90 días, el
-- cron no la va a volver a tomar (queda fuera del rango de la consulta) aunque
-- quede en resuelta=false — revisa el diagnóstico (019a) para saber si aplica
-- tu caso, y si quieres, ajustamos el tope de días antes de correr esto.
--
-- Correr en el SQL Editor de Supabase.

UPDATE licitaciones_vistas
SET resuelta = false
WHERE resuelta = true AND (estado IS DISTINCT FROM 'Adjudicada');
