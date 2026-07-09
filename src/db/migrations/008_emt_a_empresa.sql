-- Migración: la declaración de EMT es un atributo de la EMPRESA, no de cada
-- usuario individual — se mueve de users a empresas.
-- Correr esto en el SQL Editor de Supabase (una sola vez).

ALTER TABLE empresas ADD COLUMN declara_emt BOOLEAN DEFAULT false;

-- Si algún usuario ya la había declarado (bajo el modelo viejo), se traslada
-- a su empresa antes de borrar la columna de users.
UPDATE empresas e
SET declara_emt = true
WHERE EXISTS (
  SELECT 1 FROM users u WHERE u.empresa_id = e.id AND u.declara_emt = true
);

ALTER TABLE users DROP COLUMN declara_emt;
