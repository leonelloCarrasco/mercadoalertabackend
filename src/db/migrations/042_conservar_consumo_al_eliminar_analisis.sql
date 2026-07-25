-- Migración: al agregar el botón "Eliminar" en Mis Análisis (borrado desde
-- el listado del dashboard), nos dimos cuenta de que analisis_ia_consumos
-- tenía ON DELETE CASCADE hacia analisis_ia — es decir, borrar un análisis
-- borraba también el registro de que ese análisis había gastado cupo del
-- ciclo (regla B de la migración 040: "reprocesar/copiar igual gasta cupo").
--
-- Con CASCADE, alguien podría: analizar (gasta 1 cupo) → eliminarlo de la
-- lista → volver a tener cupo disponible en el mismo ciclo, sin límite. El
-- botón "Eliminar" es para ordenar el listado, no para recuperar cupo ya
-- gastado — así que el consumo tiene que sobrevivir al borrado del análisis.
--
-- SET NULL en vez de CASCADE: el registro de consumo se mantiene (sigue
-- contando para contarConsumosDelCiclo, que solo mira user_id + created_at),
-- pero su analisis_id queda en null si el análisis al que apuntaba ya no
-- existe. La columna ya era nullable desde la migración 040, así que no
-- hace falta tocar el tipo de dato.

ALTER TABLE analisis_ia_consumos
  DROP CONSTRAINT analisis_ia_consumos_analisis_id_fkey,
  ADD CONSTRAINT analisis_ia_consumos_analisis_id_fkey
    FOREIGN KEY (analisis_id) REFERENCES analisis_ia(id) ON DELETE SET NULL;
