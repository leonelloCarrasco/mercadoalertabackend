-- Migración: mensajes de contacto del panel de Ayuda.
--
-- Se guardan SIEMPRE en esta tabla, tenga o no configurado un correo de
-- soporte todavía (el usuario mencionó explícitamente que el correo de
-- destino "por ahora no lo tiene definido") — así ningún mensaje se pierde
-- mientras se decide/configura eso. El envío de correo (ver
-- soporte.routes.js) es un paso ADICIONAL que se intenta solo si
-- SUPPORT_EMAIL está configurada en el .env; si no lo está, el mensaje
-- igual queda guardado acá y se puede revisar directo en la base.

CREATE TABLE mensajes_soporte (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  email VARCHAR(255) NOT NULL, -- se captura el de ese momento, por si el usuario cambia de correo después
  nombre VARCHAR(255),
  asunto VARCHAR(255) NOT NULL,
  mensaje TEXT NOT NULL,
  email_enviado BOOLEAN NOT NULL DEFAULT false, -- true si además se pudo notificar por correo (SUPPORT_EMAIL configurada y el envío no falló)
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_mensajes_soporte_user_id ON mensajes_soporte (user_id);
