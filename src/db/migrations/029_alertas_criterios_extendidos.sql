-- Migración: nuevos criterios opcionales para las alertas, y cambio de regla
-- de negocio sobre cuáles campos son obligatorios.
--
-- - tipos_proceso: 'licitacion' y/o 'compra_agil'. NULL o array vacío = ambos
--   (mismo criterio "vacío = todos" que ya usan regiones).
-- - tramos_licitacion: códigos de TRAMOS_LICITACION (L1, LE, LP, LQ, LR, LS,
--   O1, E2, CO, B2, H2, I2, CI, DC, CI2, DC2 — ver tramos-licitacion.js).
--   NULL o vacío = todos los tramos. Es el ÚNICO criterio de monto para
--   Licitaciones (un tramo YA define un rango de monto por definición) — en
--   el formulario solo aparece si se selecciona "Licitaciones".
-- - organismos: nombres EXACTOS de organismo comprador (elegidos desde un
--   buscador con autocompletado sobre los organismos ya vistos en
--   licitaciones_vistas.nombre_organismo / compras_agiles_vistas.nombre_institucion,
--   no texto libre). NULL o vacío = todos los organismos.
-- - monto_maximo: junto con monto_minimo (ya existía), pasan a ser un criterio
--   EXCLUSIVO de Compra Ágil — en el formulario solo aparecen si se selecciona
--   "Compras Ágiles". Para Licitaciones el rango de monto se cubre con
--   tramos_licitacion, así que matchLicitacion (matching.service.js) DEJA de
--   mirar monto_minimo — el filtrado de monto para licitaciones pasa a ser
--   100% vía tramo. matchCompraAgil pasa a mirar monto_minimo Y monto_maximo.
--
-- OJO: esto es un cambio de comportamiento para configuraciones ya existentes
-- que tenían monto_minimo configurado — ese monto_minimo deja de filtrar
-- licitaciones a partir de este cambio (van a empezar a llegar más
-- notificaciones de licitaciones si no se configura también un tramo).
--
-- Además, cambia la regla de negocio (no el esquema): el único campo
-- obligatorio ahora es el producto/rubro (categorias) — monto y regiones
-- vuelven a ser opcionales. Ver validarCamposObligatorios en alerts.routes.js.
--
-- Correr esto en el SQL Editor de Supabase (una sola vez).

ALTER TABLE alert_configs
  ADD COLUMN monto_maximo NUMERIC,
  ADD COLUMN tipos_proceso TEXT[],
  ADD COLUMN tramos_licitacion TEXT[],
  ADD COLUMN organismos TEXT[];
