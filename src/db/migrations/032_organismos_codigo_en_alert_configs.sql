-- Migración de DATOS (no de esquema — alert_configs.organismos ya es TEXT[],
-- solo cambia lo que representa cada elemento del array).
--
-- Hasta ahora, alert_configs.organismos guardaba el NOMBRE exacto del
-- organismo elegido en el picker del formulario de alertas (migración 029),
-- y el matching (matching.service.js) comparaba por nombre. A partir de este
-- cambio, alert_configs.organismos pasa a guardar el CÓDIGO (codigo_organismo,
-- el mismo de organismos_compradores.codigo / migración 030), y el matching
-- compara por código — más robusto ante variaciones de mayúsculas/espacios en
-- el nombre real que reporta cada proceso.
--
-- El picker del formulario NO cambia (sigue siendo por nombre, sin tocar
-- frontend): la traducción nombre <-> código ahora la hace el backend en
-- ambos sentidos — ver alerts.routes.js (traducirOrganismosACodigos al
-- guardar, adjuntarNombresOrganismos al leer).
--
-- Correr esto en el SQL Editor de Supabase (una sola vez), DESPUÉS de
-- desplegar el código que traduce nombre<->código.

-- Paso 1 — diagnóstico ANTES del update: por cada config con organismos
-- elegidos, cuántos nombres tenía y cuántos van a poder traducirse a un
-- código (si "resueltos" < "actuales", hay al menos un nombre que no calza
-- con el catálogo ni siquiera normalizando — revisar esas filas a mano).
SELECT
  ac.id,
  ac.organismos AS nombres_actuales,
  array_length(ac.organismos, 1) AS cantidad_actual,
  (
    SELECT ARRAY_AGG(DISTINCT oc.codigo)
    FROM unnest(ac.organismos) AS nombre_organismo
    JOIN organismos_compradores oc
      ON TRIM(UPPER(oc.nombre)) = TRIM(UPPER(nombre_organismo))
  ) AS codigos_resueltos
FROM alert_configs ac
WHERE ac.organismos IS NOT NULL AND array_length(ac.organismos, 1) > 0;

-- Paso 2 — el UPDATE real: reemplaza organismos (nombres) por sus códigos
-- resueltos. Si algún nombre no calza con el catálogo, simplemente se omite
-- de la lista resultante (no debería pasar — el picker solo ofrece nombres
-- que vienen de esta misma tabla — pero por seguridad no rompe la migración
-- por un caso puntual sin match). Las configs sin organismos elegidos
-- (NULL) quedan intactas.
UPDATE alert_configs ac
SET organismos = sub.codigos
FROM (
  SELECT ac2.id, ARRAY_AGG(DISTINCT oc.codigo) AS codigos
  FROM alert_configs ac2
  CROSS JOIN LATERAL unnest(ac2.organismos) AS nombre_organismo
  JOIN organismos_compradores oc
    ON TRIM(UPPER(oc.nombre)) = TRIM(UPPER(nombre_organismo))
  WHERE ac2.organismos IS NOT NULL AND array_length(ac2.organismos, 1) > 0
  GROUP BY ac2.id
) sub
WHERE ac.id = sub.id;

-- Paso 3 — diagnóstico DESPUÉS: configs que SÍ tenían organismos elegidos
-- (según el Paso 1) pero terminaron sin ningún código resuelto — esa alerta
-- quedó, sin querer, sin filtro de organismo (equivalente a "todos"). Volver
-- a correr el Paso 1 y comparar manualmente contra este resultado.
SELECT id, organismos
FROM alert_configs
WHERE organismos IS NULL OR array_length(organismos, 1) IS NULL;
