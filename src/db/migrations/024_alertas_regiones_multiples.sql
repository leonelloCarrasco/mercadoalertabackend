-- Migración: alertas — regiones múltiples, monto mínimo y categoría/producto
-- obligatorios, y nuevos límites de alertas activas por plan.
--
-- 1) alert_configs.region (VARCHAR único) -> alert_configs.regiones (TEXT[]).
--    Selección múltiple de regiones (checkboxes en el frontend). Un array
--    vacío o NULL significa "todas las regiones" (mismo comportamiento que
--    tenía `region IS NULL` antes), ver matching.service.js.
--
-- 2) Los nuevos límites de plan (trial=1, basico=5, full=10 alertas activas;
--    máximo 1 categoría/producto por alerta para todos los planes) viven en
--    código (src/utils/planes.js), no en la base de datos — no requieren
--    migración de esquema. La obligatoriedad de monto_minimo y categorias
--    también se valida a nivel de aplicación (alerts.routes.js), no como
--    constraint NOT NULL, para no romper configuraciones ya existentes que
--    se crearon antes de este cambio con esos campos vacíos.
--
-- Correr esto en el SQL Editor de Supabase (una sola vez).

ALTER TABLE alert_configs ADD COLUMN regiones TEXT[];

-- Migra los datos existentes: la única región (si había) pasa a ser el único
-- elemento del array nuevo.
UPDATE alert_configs
SET regiones = ARRAY[TRIM(region)]
WHERE region IS NOT NULL AND TRIM(region) != '';

ALTER TABLE alert_configs DROP COLUMN region;
