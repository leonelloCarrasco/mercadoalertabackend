-- Tope mensual de mensajes de WhatsApp por empresa (ver spec:
-- tope-whatsapp). A propósito en `empresas`, NO en `users` — aunque hoy es
-- 1 usuario = 1 empresa, la cuota y el costo son de la empresa que paga el
-- plan, no de la persona que vincula el número. Si en el futuro se habilita
-- multi-usuario por empresa, el primer usuario en activar WhatsApp abre el
-- ciclo de TODA la empresa (ver asegurarCicloVigenteWhatsapp) — no hay que
-- volver a tocar este diseño.
--
-- whatsapp_ciclo_inicio: ancla del ciclo rotativo de 1 mes (NO mes
-- calendario, mismo patrón que analisis_ciclo_inicio en users). Se estampa
-- SOLO al vincular WhatsApp, y SOLO si no había un ciclo vigente — nunca se
-- reinicia por desvincular/re-vincular dentro del mismo ciclo (ver
-- asegurarCicloVigenteWhatsapp en whatsapp-cuota.queries.js).
--
-- whatsapp_aviso_80_enviado: evita mandar el correo de "vas en el 80% de tu
-- cupo" más de una vez por ciclo. Se resetea a false cada vez que arranca
-- un ciclo nuevo.
ALTER TABLE empresas ADD COLUMN whatsapp_ciclo_inicio TIMESTAMP;
ALTER TABLE empresas ADD COLUMN whatsapp_aviso_80_enviado BOOLEAN NOT NULL DEFAULT false;

-- Historial de envíos de WhatsApp — append-only, a propósito SIN ningún
-- endpoint de borrado expuesto (a diferencia de alerts_sent, que el usuario
-- puede limpiar desde el botón "Eliminar" de Notificaciones, y por eso no
-- sirve como fuente confiable para contar contra la cuota).
CREATE TABLE whatsapp_envios (
  id SERIAL PRIMARY KEY,
  empresa_id INTEGER REFERENCES empresas(id) ON DELETE CASCADE,
  sent_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_whatsapp_envios_empresa_fecha ON whatsapp_envios (empresa_id, sent_at);
