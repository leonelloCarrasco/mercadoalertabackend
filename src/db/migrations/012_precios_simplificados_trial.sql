-- Migración: simplificar el modelo de precios.
--
-- Antes: monto_mensual_promo / monto_mensual_regular / fecha_fin_promocion,
-- pensado como "sube de precio a los 3 meses".
--
-- Ahora: un solo monto_mensual (el precio de lanzamiento vigente al momento
-- de contratar, congelado para esa empresa) + fecha_expiracion_trial (para
-- bloquear el trial a los 7 días si no se pasa a un plan pago).
--
-- Correr esto en el SQL Editor de Supabase (una sola vez).

ALTER TABLE empresas
  ADD COLUMN monto_mensual NUMERIC,
  ADD COLUMN fecha_expiracion_trial TIMESTAMP;

-- Migrar lo que ya existía en monto_mensual_promo (si alguna empresa ya
-- había contratado basic/full con el modelo anterior)
UPDATE empresas SET monto_mensual = monto_mensual_promo WHERE monto_mensual_promo IS NOT NULL;

-- A las empresas trial ya existentes les damos 7 días desde ahora (no desde
-- su fecha de creación original, para no bloquearlas de sorpresa apenas
-- se aplique esta migración)
UPDATE empresas SET fecha_expiracion_trial = NOW() + INTERVAL '7 days' WHERE plan = 'trial';

ALTER TABLE empresas
  DROP COLUMN monto_mensual_promo,
  DROP COLUMN monto_mensual_regular,
  DROP COLUMN fecha_fin_promocion;
