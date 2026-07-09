-- Migración: limpiar RUTs de empresas guardados con formato inconsistente
-- (algunos con puntos, heredados de antes de que existiera normalizarRut()),
-- y fusionar cualquier duplicado que esto revele.
-- Correr esto en el SQL Editor de Supabase (una sola vez).

-- 1. Sacar los puntos de cualquier RUT que los tenga
UPDATE empresas SET rut = REPLACE(rut, '.', '');

-- 2. Si al normalizar quedaron dos filas con el mismo RUT (como en este caso:
--    "70.783.100-6" y "70783100-6" eran la misma empresa duplicada), fusionarlas:
--    los usuarios de la fila más nueva se re-asignan a la más antigua, y se
--    borra la duplicada.
DO $$
DECLARE
  fila RECORD;
  id_sobreviviente INTEGER;
BEGIN
  FOR fila IN
    SELECT rut, MIN(id) AS id_min, array_agg(id) AS ids
    FROM empresas
    GROUP BY rut
    HAVING COUNT(*) > 1
  LOOP
    id_sobreviviente := fila.id_min;

    UPDATE users SET empresa_id = id_sobreviviente
    WHERE empresa_id = ANY(fila.ids) AND empresa_id != id_sobreviviente;

    DELETE FROM empresas WHERE id = ANY(fila.ids) AND id != id_sobreviviente;
  END LOOP;
END $$;

-- 3. Blindaje a futuro: el formato de rut siempre debe ser "dígitos-verificador",
--    sin puntos. Si algún código nuevo intenta guardar algo mal formado, esto
--    lo rechaza a nivel de base de datos en vez de permitir que se cuele de nuevo.
ALTER TABLE empresas
  ADD CONSTRAINT rut_formato_valido CHECK (rut ~ '^[0-9]{7,8}-[0-9K]$');
