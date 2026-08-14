-- Palabras clave (positivas y negativas) para Alertas — ver conversación de
-- diseño de agosto 2026. Complementan (no reemplazan) el matching por
-- categoría UNSPSC, para casos donde el texto real de una licitación no usa
-- el mismo código que el usuario esperaría.
ALTER TABLE alert_configs ADD COLUMN palabras_clave TEXT[];
ALTER TABLE alert_configs ADD COLUMN palabras_clave_excluir TEXT[];

-- Cuota de llamadas a la IA para sugerir palabras clave — tabla simple de
-- contador (mismo espíritu que analisis_ia_consumos), sin ciclo mensual ni
-- nada elaborado: el costo por llamada es bajo (un puñado de palabras, no
-- documentos completos como Análisis de Procesos), así que alcanza con
-- contar filas de HOY para el tope diario. El tope por alerta se controla
-- del lado de la aplicación (se manda el conteo actual de esa alerta en el
-- request), no hace falta guardar a qué alerta pertenece cada sugerencia acá.
CREATE TABLE sugerencias_palabras_clave_consumos (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sugerencias_palabras_clave_user_fecha ON sugerencias_palabras_clave_consumos (user_id, created_at);
