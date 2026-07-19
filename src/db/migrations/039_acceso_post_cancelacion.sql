-- Migración: acceso_hasta + avisos de corte de acceso tras cancelar una
-- suscripción (menú de perfil → Mi Suscripción → Cancelar).
--
-- acceso_hasta: se llena en el momento mismo de cancelar (POST /api/pagos/cancelar),
-- con el next_payment_date que tenía la suscripción ANTES de cancelarla — o
-- sea, la fecha hasta la que ya está pagado. A partir de ahí, todo el
-- criterio de "¿ya hay que cortar el acceso?" es una comparación de fecha
-- 100% local (acceso_hasta < NOW()), sin volver a consultar a MercadoPago —
-- mismo espíritu que fecha_expiracion_trial para el trial.
--
-- aviso_acceso_2dias_enviado / aviso_acceso_terminado_enviado: mismo
-- criterio que aviso_2dias_enviado/aviso_vencido_enviado de la migración 037
-- (no reenviar el aviso cada día que corre el job), pero para este caso.

ALTER TABLE empresas
  ADD COLUMN acceso_hasta TIMESTAMP,
  ADD COLUMN aviso_acceso_2dias_enviado BOOLEAN DEFAULT false,
  ADD COLUMN aviso_acceso_terminado_enviado BOOLEAN DEFAULT false;
