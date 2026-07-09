-- Migración: soporte para planes pagos (basic/full) vía MercadoPago.
-- Correr esto en el SQL Editor de Supabase (una sola vez).

ALTER TABLE empresas
  ADD COLUMN monto_mensual_promo NUMERIC,
  ADD COLUMN monto_mensual_regular NUMERIC,
  ADD COLUMN fecha_fin_promocion DATE,
  ADD COLUMN estado_pago VARCHAR(20) DEFAULT 'activo',
  ADD COLUMN mercadopago_subscription_id VARCHAR(100);

-- Las empresas trial existentes ya quedan con estado_pago = 'activo' (default),
-- que es correcto: trial no requiere pago.
