-- Migración: sección "Análisis de Procesos" (IA) del dashboard.
--
-- Reglas de negocio acordadas:
-- A. Cuota MENSUAL ROTATIVA por usuario (no mes calendario) — arranca a
--    contar desde el primer análisis de cada ciclo, dura 1 mes justo desde
--    ahí, y lo que no se usa NO se acumula para el ciclo siguiente. Ver
--    users.analisis_ciclo_inicio más abajo.
-- B. Cada usuario ve y gestiona SUS PROPIOS análisis — puede reprocesar uno
--    ya hecho, pero eso gasta cupo de nuevo (no hay "gratis" para nadie).
-- C. Cada usuario tiene su copia independiente — si dos usuarios analizan
--    la misma licitación, son DOS filas separadas, no una compartida. Por
--    eso analisis_ia es único por (user_id, tipo_proceso, codigo_externo),
--    no por (tipo_proceso, codigo_externo) como en el diseño anterior.
--
-- Optimización de costo (sin romper la regla C): si el archivo que alguien
-- sube es BYTE POR BYTE idéntico a uno que otro usuario ya analizó para el
-- mismo proceso (mismo hash SHA-256), se copia ese resultado en vez de
-- volver a llamar a la IA — sigue gastando el cupo del usuario que lo pide
-- (regla B), solo se evita el costo/tiempo de un análisis redundante sobre
-- contenido idéntico. archivo_hash queda NULL en modo "sin adjuntos" (ahí
-- la fuente es la ficha pública, no un archivo — ver analisis-ia.routes.js
-- para el criterio de cuándo SÍ es seguro copiar ese caso también).

ALTER TABLE users ADD COLUMN analisis_ciclo_inicio TIMESTAMP;

CREATE TABLE analisis_ia (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tipo_proceso VARCHAR(20) NOT NULL CHECK (tipo_proceso IN ('licitacion', 'compra_agil')),
  codigo_externo VARCHAR(100) NOT NULL,
  nombre VARCHAR(510),
  contenido JSONB NOT NULL,
  sin_adjuntos BOOLEAN NOT NULL DEFAULT false,
  archivo_hash VARCHAR(64), -- SHA-256 en hex, NULL si sin_adjuntos=true
  fecha_cierre_snapshot TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE (user_id, tipo_proceso, codigo_externo)
);

-- Para el chequeo de "¿alguien ya analizó este mismo archivo para este mismo
-- proceso?" (copia por hash) sin tener que escanear toda la tabla.
CREATE INDEX idx_analisis_ia_hash ON analisis_ia (tipo_proceso, codigo_externo, archivo_hash) WHERE archivo_hash IS NOT NULL;
-- Para "Mis Análisis" (listado propio del usuario).
CREATE INDEX idx_analisis_ia_user_id ON analisis_ia (user_id);

CREATE TABLE analisis_ia_consumos (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  analisis_id INTEGER REFERENCES analisis_ia(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_analisis_ia_consumos_user_fecha ON analisis_ia_consumos (user_id, created_at);
