-- Migración: agregar nombre y apellido del usuario (persona), separado del
-- nombre de la empresa (que ya viene de la validación con Mercado Público).
-- Correr esto en el SQL Editor de Supabase (una sola vez).

ALTER TABLE users
  ADD COLUMN nombre VARCHAR(100),
  ADD COLUMN apellido VARCHAR(100);
