-- Corrección a la migración 005: expires_at estaba como TIMESTAMP (sin zona
-- horaria). Al insertar un Date de Node ahí, Postgres toma la hora "de reloj"
-- del proceso Node en vez de convertirla a UTC, así que expires_at terminaba
-- desfasado varias horas respecto al NOW() del servidor (según la zona horaria
-- de donde corra la app) — los tokens podían quedar expirados apenas se creaban.
-- Solución: usar TIMESTAMPTZ, que sí guarda el instante real sin ambigüedad.
-- Correr esto en el SQL Editor de Supabase si ya creaste la tabla con la
-- migración 005 original (una sola vez).

ALTER TABLE password_reset_tokens
  ALTER COLUMN expires_at TYPE TIMESTAMPTZ;
