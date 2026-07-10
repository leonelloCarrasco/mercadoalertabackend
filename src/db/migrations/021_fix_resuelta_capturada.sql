-- Corrección de datos: Compras Ágiles que la captura inicial guardó con
-- estado='proveedor_seleccionado' (ya resueltas desde que las vimos por
-- primera vez) pero resuelta quedó en false por defecto, porque el INSERT
-- original no evaluaba el estado. Corregido en compra-agil.queries.js —
-- esto solo arregla lo que ya se había guardado antes del fix.
-- Correr en el SQL Editor de Supabase.

UPDATE compras_agiles_vistas
SET resuelta = true
WHERE resuelta = false AND estado = 'proveedor_seleccionado';
