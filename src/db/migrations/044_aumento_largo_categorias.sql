-- ============================================================
-- Migración: 044_aumento_largo_categorias
-- Motivo: value too long for type character varying(255)
--         Registros afectados: 4050-2-LE26, 2410-142-LE25
--         Campo detectado: Categoria (274 caracteres)
--
-- Ajusta el nombre de la tabla licitaciones_vistas antes de ejecutar.
-- ============================================================

BEGIN;

ALTER TABLE licitaciones_vistas
    ALTER COLUMN categoria TYPE VARCHAR(500);
	
COMMIT;