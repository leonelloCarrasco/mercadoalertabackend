-- Migración: datos de contacto de la empresa, capturados al momento del
-- pre-registro (distintos del email/nombre de cada usuario individual que
-- después se registre bajo esta empresa).
-- Correr esto en el SQL Editor de Supabase (una sola vez).

ALTER TABLE empresas
  ADD COLUMN responsable_nombre VARCHAR(100),
  ADD COLUMN responsable_apellido VARCHAR(100),
  ADD COLUMN email_contacto VARCHAR(255),
  ADD COLUMN telefono_contacto VARCHAR(30);
