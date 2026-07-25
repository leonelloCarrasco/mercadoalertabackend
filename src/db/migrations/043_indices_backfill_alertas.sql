-- Índices para listarLicitacionesPublicadasVigentes / listarComprasAgilesPublicadasVigentes
-- (ver alerting.service.js — procesarBackfillNuevaAlerta), que corren cada vez
-- que se crea una alerta nueva y filtran por exactamente estas dos columnas
-- juntas: WHERE estado = '...' AND (fecha_cierre IS NULL OR fecha_cierre > NOW()).
--
-- Sin este índice, cada alerta nueva creada dispara un seq scan completo de
-- licitaciones_vistas / compras_agiles_vistas — no es un problema hoy con
-- pocos miles de filas, pero conviene tenerlo antes de que la tabla crezca y
-- se vuelva notorio (crear una alerta seguiría respondiendo rápido igual,
-- porque el backfill corre en segundo plano — pero tardaría cada vez más en
-- mandar la notificación).

CREATE INDEX idx_licitaciones_vistas_estado_cierre
  ON licitaciones_vistas (estado, fecha_cierre);

CREATE INDEX idx_compras_agiles_vistas_estado_cierre
  ON compras_agiles_vistas (estado, fecha_cierre);
