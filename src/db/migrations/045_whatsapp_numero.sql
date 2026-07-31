-- Vinculación de WhatsApp (WhatsApp Cloud API) — a diferencia de Telegram
-- (donde el usuario inicia el contacto escribiéndole al bot y ahí se
-- captura el chat_id), en WhatsApp Business Cloud API el negocio es quien
-- inicia el contacto con una plantilla pre-aprobada. Por eso la vinculación
-- acá es por código de verificación (como un OTP), no por deep-link:
-- el usuario ingresa su número, se le manda un código por WhatsApp, y lo
-- confirma en el dashboard. whatsapp_verificado queda en false hasta que
-- ese código se confirma correctamente.
ALTER TABLE users ADD COLUMN whatsapp_numero VARCHAR(20);
ALTER TABLE users ADD COLUMN whatsapp_verificado BOOLEAN NOT NULL DEFAULT false;
