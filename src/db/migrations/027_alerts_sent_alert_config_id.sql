-- Migración: asocia cada notificación enviada (alerts_sent) con la configuración
-- de alerta (alert_configs) que la generó. Antes solo se sabía a qué usuario
-- se le envió, no cuál de sus alertas específicas hizo match — relevante para
-- un usuario con varias alertas activas a la vez.
--
-- ON DELETE SET NULL (no CASCADE): si el usuario borra la alerta después,
-- el historial de notificaciones ya enviadas se conserva igual, solo pierde
-- la referencia a cuál era.
--
-- Correr esto en el SQL Editor de Supabase (una sola vez).

ALTER TABLE alerts_sent ADD COLUMN alert_config_id INTEGER REFERENCES alert_configs(id) ON DELETE SET NULL;
