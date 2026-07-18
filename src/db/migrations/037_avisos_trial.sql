-- Migración: columnas en empresas para no reenviar los avisos de trial cada
-- día que corra el job (avisos-trial.js) — mismo criterio que notificado_at
-- en recordatorios_cierre (migración 035): una vez enviado, queda marcado.
--
-- aviso_2dias_enviado: correo "tu prueba termina en 2 días" (mismo umbral
-- que ya usa el banner del dashboard, mostrarBannerPlan en dashboard.js).
-- aviso_vencido_enviado: correo "tu prueba terminó, elige un plan".
--
-- Los dos se resetean a false cuando la empresa vuelve a trial de nuevo
-- (no debería pasar hoy — no hay flujo para "volver a trial" — pero si en
-- el futuro se agrega, conviene que no arrastre el estado de un trial viejo).

ALTER TABLE empresas
  ADD COLUMN aviso_2dias_enviado BOOLEAN DEFAULT false,
  ADD COLUMN aviso_vencido_enviado BOOLEAN DEFAULT false;
