-- Migración: reusar password_reset_tokens también para el "magic link" de
-- acceso al sitio de gestión de empresa (sin password, vía email + RUT).
-- Se distingue por la columna `tipo`. Correr en el SQL Editor de Supabase.

ALTER TABLE password_reset_tokens
  ADD COLUMN tipo VARCHAR(30) NOT NULL DEFAULT 'reset_password',
  ADD COLUMN empresa_id INTEGER REFERENCES empresas(id) ON DELETE CASCADE;

-- user_id ya era nullable (no tenía NOT NULL), así que los tokens de tipo
-- 'acceso_empresa' simplemente dejan user_id en NULL y usan empresa_id en su lugar.
