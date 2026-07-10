-- Diagnóstico: licitaciones marcadas resuelta=true con un estado que ya NO
-- consideramos confirmado como final (todo menos "Adjudicada"). Correr ANTES
-- de la corrección, para ver el alcance.
SELECT estado, COUNT(*) AS cantidad,
       COUNT(*) FILTER (WHERE fecha_cierre > NOW() - INTERVAL '90 days') AS reabribles_dentro_de_90_dias
FROM licitaciones_vistas
WHERE resuelta = true AND (estado IS DISTINCT FROM 'Adjudicada')
GROUP BY estado
ORDER BY cantidad DESC;
