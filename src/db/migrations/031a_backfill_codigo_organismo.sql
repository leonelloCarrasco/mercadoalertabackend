-- Backfill de licitaciones_vistas.codigo_organismo para filas YA guardadas
-- (las nuevas se guardan con código directo desde la API, ver migración 031).
--
-- Cruza nombre_organismo contra organismos_compradores.nombre. Se normaliza
-- con TRIM + UPPER porque el propio script de validación del catálogo
-- (scripts/validar-organismos.js) ya detectó que hay nombres que solo calzan
-- así (mayúsculas/espacios distintos), no exacto.
--
-- Correr esto DESPUÉS de la migración 031, en el SQL Editor de Supabase
-- (se puede correr más de una vez sin problema: solo toca filas con
-- codigo_organismo IS NULL).

-- Paso 1 — diagnóstico ANTES del update: cuántas filas van a quedar con
-- código y cuántas no, para tener una idea del alcance.
SELECT
  COUNT(*) FILTER (WHERE oc.codigo IS NOT NULL) AS con_match,
  COUNT(*) FILTER (WHERE oc.codigo IS NULL)     AS sin_match,
  COUNT(*)                                       AS total_con_nombre
FROM licitaciones_vistas lv
LEFT JOIN organismos_compradores oc
  ON TRIM(UPPER(oc.nombre)) = TRIM(UPPER(lv.nombre_organismo))
WHERE lv.nombre_organismo IS NOT NULL
  AND lv.codigo_organismo IS NULL;

-- Paso 2 — el UPDATE real.
UPDATE licitaciones_vistas lv
SET codigo_organismo = oc.codigo
FROM organismos_compradores oc
WHERE TRIM(UPPER(oc.nombre)) = TRIM(UPPER(lv.nombre_organismo))
  AND lv.nombre_organismo IS NOT NULL
  AND lv.codigo_organismo IS NULL;

-- Paso 3 — diagnóstico DESPUÉS: nombres que quedaron sin código (organismo
-- no encontrado en el catálogo ni siquiera normalizando) — para revisar a
-- mano si vale la pena agregarlos al catálogo o si es un caso raro/puntual.
SELECT nombre_organismo, COUNT(*) AS cantidad_licitaciones
FROM licitaciones_vistas
WHERE codigo_organismo IS NULL AND nombre_organismo IS NOT NULL
GROUP BY nombre_organismo
ORDER BY cantidad_licitaciones DESC;
