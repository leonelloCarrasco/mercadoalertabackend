-- Corrige la misma clase de bug de zona horaria que la migración 051, pero
-- para columnas de un origen distinto: estas NO vienen de la API de
-- Mercado Público (esas ya se arreglaron en 051, con AT TIME ZONE
-- 'America/Santiago') — se generan con NOW() de Postgres o new Date() de
-- JS, bajo una sesión/proceso que en producción siempre estuvo en UTC. Por
-- eso acá el USING es AT TIME ZONE 'UTC', no de Chile — mezclar los dos
-- criterios corrompería los datos en vez de arreglarlos.
--
-- El bug concreto (confirmado en agosto 2026, con el driver real `pg`):
-- una columna TIMESTAMP (sin zona) se lee interpretando sus dígitos crudos
-- según la zona horaria del PROCESO que está leyendo, no una convención
-- fija. En producción (proceso siempre en UTC, tanto al guardar como al
-- leer) los dos pasos se cancelan entre sí y el resultado sale bien — pero
-- es una casualidad de la configuración actual, no algo garantizado. En
-- cualquier proceso que corra con otra zona horaria (confirmado: un
-- ambiente local con el sistema operativo en hora de Chile), leer la
-- misma columna da un resultado corrido 3-4 horas, sin que nada tire
-- error. TIMESTAMPTZ elimina esta fragilidad de raíz: siempre guarda y
-- devuelve el instante real, sin importar qué zona horaria tenga quien
-- esté leyendo.
--
-- Se agrupan los ALTER por tabla (una sola sentencia por tabla, más
-- barato que uno por columna).

ALTER TABLE empresas
  ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC',
  ALTER COLUMN fecha_expiracion_trial TYPE TIMESTAMPTZ USING fecha_expiracion_trial AT TIME ZONE 'UTC',
  ALTER COLUMN suscripcion_cancelada_en TYPE TIMESTAMPTZ USING suscripcion_cancelada_en AT TIME ZONE 'UTC';

ALTER TABLE users
  ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC',
  ALTER COLUMN acepta_terminos_at TYPE TIMESTAMPTZ USING acepta_terminos_at AT TIME ZONE 'UTC';

ALTER TABLE alert_configs
  ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC';

ALTER TABLE licitaciones_vistas
  ALTER COLUMN fecha_ultima_revision TYPE TIMESTAMPTZ USING fecha_ultima_revision AT TIME ZONE 'UTC',
  ALTER COLUMN primera_vez_vista TYPE TIMESTAMPTZ USING primera_vez_vista AT TIME ZONE 'UTC';

ALTER TABLE compras_agiles_vistas
  ALTER COLUMN fecha_ultima_revision TYPE TIMESTAMPTZ USING fecha_ultima_revision AT TIME ZONE 'UTC',
  ALTER COLUMN primera_vez_vista TYPE TIMESTAMPTZ USING primera_vez_vista AT TIME ZONE 'UTC';

ALTER TABLE password_reset_tokens
  ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC',
  ALTER COLUMN used_at TYPE TIMESTAMPTZ USING used_at AT TIME ZONE 'UTC';

ALTER TABLE alerts_sent
  ALTER COLUMN sent_at TYPE TIMESTAMPTZ USING sent_at AT TIME ZONE 'UTC';

ALTER TABLE analisis_ia
  ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC',
  ALTER COLUMN updated_at TYPE TIMESTAMPTZ USING updated_at AT TIME ZONE 'UTC';

ALTER TABLE analisis_ia_consumos
  ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC';

ALTER TABLE sugerencias_palabras_clave_consumos
  ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC';

ALTER TABLE busquedas_guardadas
  ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC';

ALTER TABLE mensajes_soporte
  ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC';

ALTER TABLE pipeline_oportunidades
  ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC',
  ALTER COLUMN updated_at TYPE TIMESTAMPTZ USING updated_at AT TIME ZONE 'UTC';

ALTER TABLE historico_precios
  ALTER COLUMN archivado_at TYPE TIMESTAMPTZ USING archivado_at AT TIME ZONE 'UTC';

ALTER TABLE whatsapp_envios
  ALTER COLUMN sent_at TYPE TIMESTAMPTZ USING sent_at AT TIME ZONE 'UTC';

ALTER TABLE recordatorios_cierre
  ALTER COLUMN notificado_at TYPE TIMESTAMPTZ USING notificado_at AT TIME ZONE 'UTC',
  ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC';

ALTER TABLE seguimientos_licitacion
  ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC';
