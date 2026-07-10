-- Diagnóstico: Compras Ágiles marcadas resuelta=true con un estado que ya NO
-- consideramos confirmado como final (todo menos "proveedor_seleccionado").
-- Correr ANTES de la corrección (020), para ver el alcance.
SELECT estado, COUNT(*) AS cantidad,
       COUNT(*) FILTER (WHERE fecha_cierre > NOW() - INTERVAL '90 days') AS reabribles_dentro_de_90_dias
FROM compras_agiles_vistas
WHERE resuelta = true AND (estado IS DISTINCT FROM 'proveedor_seleccionado')
GROUP BY estado
ORDER BY cantidad DESC;
