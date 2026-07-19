-- Migración: cancelación de suscripción, iniciada desde el menú de perfil.
--
-- suscripcion_cancelada_en: NULL mientras está activa. Se llena con la fecha
-- en que el usuario apretó "Cancelar" — NO se toca plan/estado_pago en ese
-- momento, porque MercadoPago documenta que cancelar no corta el acceso al
-- instante: la empresa sigue con acceso hasta el final del período YA
-- pagado, y recién ahí deja de renovar (ver PUT /preapproval/{id} con
-- status: "cancelled" en mercadopago.service.js).
--
-- OJO: esta migración deja registrada la cancelación, pero todavía NO existe
-- el job que efectivamente corte el acceso cuando ese período termine — ver
-- la nota en pagos.routes.js (POST /cancelar) para el detalle de por qué
-- quedó pendiente a propósito, no fue un olvido.

ALTER TABLE empresas ADD COLUMN suscripcion_cancelada_en TIMESTAMP;
