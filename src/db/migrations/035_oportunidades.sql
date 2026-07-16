-- Migración: sección "Oportunidades" del dashboard — dos funcionalidades
-- independientes entre sí, cada una con su propia tabla:
--
-- recordatorios_cierre: avisa X horas antes de que cierre una licitación o
-- Compra Ágil. Corre contra datos LOCALES (fecha_cierre ya sincronizada por
-- el polling normal) — no pega contra ninguna API en vivo, así que el job
-- (recordatorio-cierre.js) puede correr seguido (cada 15-30 min) sin costo.
--
-- seguimientos_licitacion: avisa en CADA cambio de estado de una licitación
-- puntual (Publicada -> Cerrada -> Adjudicada/Desierta/Revocada/Suspendida),
-- no solo el estado final. Solo aplica a Licitaciones (no Compra Ágil — su
-- ciclo de vida es demasiado corto, a veces de horas, para que el aviso de
-- "cambió de estado" llegue a tiempo de servir de algo). Requiere pedir el
-- detalle a la API para saber si cambió (seguimiento-estado.js), así que es
-- más caro que el recordatorio — de ahí que tenga su propia cuota, más chica.

CREATE TABLE recordatorios_cierre (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  tipo_proceso VARCHAR(20) NOT NULL CHECK (tipo_proceso IN ('licitacion', 'compra_agil')),
  codigo_externo VARCHAR(100) NOT NULL,
  -- Ventanas ofrecidas en el formulario: Licitación = 24/72/168 (1 día/3 días/
  -- 1 semana); Compra Ágil = 2/6/12 (su cierre suele ser cuestión de horas).
  -- No se valida un enum acá a propósito — el front ya restringe a esas 6
  -- opciones, y dejar la columna como INTEGER libre permite ajustar las
  -- opciones ofrecidas sin otra migración.
  horas_antes INTEGER NOT NULL,
  notificado_at TIMESTAMP, -- NULL = todavía pendiente de avisar
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE (user_id, tipo_proceso, codigo_externo)
);

CREATE INDEX idx_recordatorios_cierre_user_id ON recordatorios_cierre (user_id);
-- Único índice que de verdad usa el job (recordatorios pendientes, que son
-- siempre una fracción chica del total una vez que la mayoría ya se avisó).
CREATE INDEX idx_recordatorios_cierre_pendientes ON recordatorios_cierre (codigo_externo) WHERE notificado_at IS NULL;

CREATE TABLE seguimientos_licitacion (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  codigo_externo VARCHAR(100) NOT NULL,
  -- Se inicializa al estado que tenía la licitación en el momento en que el
  -- usuario empezó a seguirla (no NULL) — así el primer chequeo del job no
  -- dispara una notificación falsa por "cambió" de nada a su estado actual.
  ultimo_estado_notificado VARCHAR(30) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE (user_id, codigo_externo)
);

CREATE INDEX idx_seguimientos_licitacion_user_id ON seguimientos_licitacion (user_id);
-- El job arma la lista de códigos ÚNICOS a revisar con esto (varios usuarios
-- pueden seguir la misma licitación — se pide el detalle UNA sola vez).
CREATE INDEX idx_seguimientos_licitacion_codigo ON seguimientos_licitacion (codigo_externo);
