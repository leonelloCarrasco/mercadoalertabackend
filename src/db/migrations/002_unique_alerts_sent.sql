-- Migración: prevenir alertas duplicadas a nivel de base de datos.
-- Correr esto en el SQL Editor de Supabase (una sola vez).

-- 1. Por si ya existieran duplicados de pruebas anteriores (ej. por el choque
--    entre el cron automático y una corrida manual), los limpiamos primero,
--    dejando solo el registro más antiguo de cada combinación.
DELETE FROM alerts_sent a USING alerts_sent b
WHERE a.id > b.id
  AND a.user_id = b.user_id
  AND a.codigo_externo = b.codigo_externo
  AND a.canal = b.canal;

-- 2. Agregamos el constraint que impide que vuelva a pasar.
ALTER TABLE alerts_sent
  ADD CONSTRAINT alerts_sent_unico UNIQUE (user_id, codigo_externo, canal);
