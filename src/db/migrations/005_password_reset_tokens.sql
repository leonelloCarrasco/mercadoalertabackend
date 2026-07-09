-- Migración: tabla para tokens de recuperación de contraseña.
-- Se guarda un hash (sha256) del token, nunca el token en texto plano — igual
-- criterio que password_hash en users: si la base se filtra, no se puede
-- usar directamente para resetear contraseñas de otros usuarios.
-- Correr esto en el SQL Editor de Supabase (una sola vez).

CREATE TABLE password_reset_tokens (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  token_hash VARCHAR(64) UNIQUE NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);
