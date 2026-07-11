-- Migración: vuelta al modelo "1 usuario = 1 empresa" para TODOS los planes
-- (trial, basico, full), y nuevo flujo de registro con confirmación de email
-- antes de poder usar la cuenta (y, para planes pagos, antes de pasar a pago).
--
-- Contexto: las migraciones 003/007 habían separado "empresa" de "usuario"
-- para soportar múltiples usuarios por empresa en planes basic/full. Ese
-- modelo se descarta: ahora cada empresa tiene un único usuario, así que se
-- elimina el flujo de pre-registro de empresa y el panel de gestión de
-- empresa (ver empresa-gestion.routes.js, eliminado en este cambio).
--
-- Se agrega a `users`:
--   - telefono: dato de contacto del usuario/responsable (antes vivía en
--     empresas.telefono_contacto, que queda en desuso pero no se elimina).
--   - estado: 'pendiente_email' -> 'pendiente_pago' (solo basic/full) -> 'activo'.
--     Reemplaza la necesidad de una tabla de "gestión de empresa" separada:
--     ahora el propio usuario lleva el estado de su registro.
--   - acepta_terminos / acepta_terminos_at: registro del check de T&C
--     aceptado al momento de crear la cuenta.
--
-- Correr esto en el SQL Editor de Supabase (una sola vez).

ALTER TABLE users
  ADD COLUMN telefono VARCHAR(30),
  ADD COLUMN estado VARCHAR(30) NOT NULL DEFAULT 'pendiente_email',
  ADD COLUMN acepta_terminos BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN acepta_terminos_at TIMESTAMP;

-- Los usuarios que ya existían antes de este cambio ya están usando la app
-- normalmente — se marcan como 'activo' para no bloquearlos de sorpresa.
UPDATE users SET estado = 'activo', acepta_terminos = true WHERE estado = 'pendiente_email';

-- El límite de usuarios por empresa ahora es 1 para TODOS los planes (antes:
-- trial=1, basico=2, full=5). Se simplifica el trigger de la migración 007.
CREATE OR REPLACE FUNCTION verificar_limite_usuarios_por_empresa()
RETURNS TRIGGER AS $$
DECLARE
  usuarios_actuales INTEGER;
BEGIN
  SELECT COUNT(*) INTO usuarios_actuales FROM users WHERE empresa_id = NEW.empresa_id;

  IF usuarios_actuales >= 1 THEN
    RAISE EXCEPTION 'limite_usuarios_empresa_excedido' USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- El trigger (creado en la migración 007) sigue apuntando a esta función, no
-- hace falta recrearlo.

-- NOTA: las columnas empresas.responsable_nombre, responsable_apellido,
-- email_contacto, telefono_contacto y declara_emt (migraciones 008/009)
-- quedan en desuso (el nuevo flujo no las llena), pero no se eliminan acá
-- para no perder datos históricos de las empresas que ya se registraron
-- bajo el modelo anterior.
