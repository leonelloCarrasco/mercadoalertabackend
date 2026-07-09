-- Diagnóstico: correr ANTES de la migración 003, para ver qué usuarios
-- comparten el mismo RUT en plan trial (esperable si usaste RUTs de prueba repetidos).
SELECT rut_empresa, plan, COUNT(*) AS cantidad, array_agg(email) AS emails
FROM users
WHERE plan = 'trial'
GROUP BY rut_empresa, plan
HAVING COUNT(*) > 1
ORDER BY cantidad DESC;
