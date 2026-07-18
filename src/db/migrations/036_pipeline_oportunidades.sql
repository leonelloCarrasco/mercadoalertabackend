-- Migración: pipeline_oportunidades — mini-CRM dentro de "Oportunidades".
-- A diferencia de recordatorios_cierre y seguimientos_licitacion, esta tabla
-- es 100% independiente de ellas: un ítem puede estar en el pipeline sin
-- tener recordatorio ni seguimiento, y viceversa. Responde una pregunta
-- distinta a las otras dos ("¿qué estoy haciendo YO con esto?", no "¿cambió
-- algo en Mercado Público?").
--
-- Aplica a los DOS tipos de proceso (a diferencia de seguimiento, que es
-- solo Licitaciones) — gestionar tu propio proceso de evaluación no depende
-- de qué tan rápido cambia de estado en Mercado Público.
--
-- Detección automática de ganado/perdido (solo Licitaciones, ver
-- seguimiento-estado.js): agregar algo al pipeline activa un seguimiento
-- por detrás si no lo tenía ya (columna `origen` nueva abajo), para poder
-- comparar el RUT del ganador contra el RUT de tu empresa cuando la
-- licitación llega a "Adjudicada", y mover la tarjeta sola a Ganada/Perdida.
-- Compra Ágil no tiene este mecanismo (no tiene seguimiento), así que ahí
-- el estado se actualiza siempre a mano.

CREATE TABLE pipeline_oportunidades (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  tipo_proceso VARCHAR(20) NOT NULL CHECK (tipo_proceso IN ('licitacion', 'compra_agil')),
  codigo_externo VARCHAR(100) NOT NULL,
  estado_personal VARCHAR(30) NOT NULL DEFAULT 'por_evaluar' CHECK (estado_personal IN (
    'por_evaluar', 'evaluando', 'preparando_oferta', 'oferta_enviada', 'ganada', 'perdida', 'descartada'
  )),
  -- Sin orden obligatorio a propósito: el usuario puede mover la tarjeta a
  -- cualquier columna del kanban en cualquier momento, incluida la detección
  -- automática de arriba (que puede saltar directo a 'ganada').
  nota TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE (user_id, tipo_proceso, codigo_externo)
);

CREATE INDEX idx_pipeline_oportunidades_user_id ON pipeline_oportunidades (user_id);

-- origen: distingue un seguimiento que el usuario activó a mano ('manual',
-- default — mismo comportamiento de siempre) de uno que el pipeline creó
-- solo por detrás ('pipeline'). Importa al eliminar: si sacás algo del
-- pipeline y su seguimiento era 'pipeline', se borra junto con el ítem — si
-- era 'manual' (lo habías activado vos aparte, antes o después), se deja,
-- porque seguís queriendo el aviso de cambio de estado por separado.
ALTER TABLE seguimientos_licitacion
  ADD COLUMN origen VARCHAR(20) NOT NULL DEFAULT 'manual' CHECK (origen IN ('manual', 'pipeline'));
