-- Migración: panel de administrador (acceso interno, restringido a un usuario
-- admin puntual — no confundir con las rutas /api/admin/* existentes, que se
-- protegen con una API key compartida para triggers de cron, no con login de
-- usuario). Este panel usa el mismo login (email/password) de siempre, pero
-- solo lo puede ver quien tenga es_admin = true.
--
-- Después de correr esta migración, hay que activar el flag a mano para tu
-- propio usuario (reemplaza el email):
--
--   UPDATE users SET es_admin = true WHERE email = 'tu-email@dominio.cl';
--
-- Correr esto en el SQL Editor de Supabase (una sola vez).

ALTER TABLE users ADD COLUMN es_admin BOOLEAN NOT NULL DEFAULT false;
