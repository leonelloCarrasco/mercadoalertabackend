CREATE TABLE empresas (
  id SERIAL PRIMARY KEY,
  rut VARCHAR(20) UNIQUE NOT NULL CHECK (rut ~ '^[0-9]{7,8}-[0-9K]$'),
  nombre_empresa VARCHAR(255),
  rut_validado BOOLEAN DEFAULT false,
  declara_emt BOOLEAN DEFAULT false,
  responsable_nombre VARCHAR(100),
  responsable_apellido VARCHAR(100),
  email_contacto VARCHAR(255),
  telefono_contacto VARCHAR(30),
  plan VARCHAR(50) DEFAULT 'trial',
  monto_mensual NUMERIC,
  fecha_expiracion_trial TIMESTAMP,
  estado_pago VARCHAR(20) DEFAULT 'activo',
  mercadopago_subscription_id VARCHAR(100),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  nombre VARCHAR(100),
  apellido VARCHAR(100),
  empresa_id INTEGER NOT NULL REFERENCES empresas(id),
  telegram_chat_id VARCHAR(50),
  created_at TIMESTAMP DEFAULT NOW()
);

-- Límite de usuarios por empresa según su plan (trial=1, basico=2, full=5),
-- aplicado de forma atómica vía trigger — ver migración 007 para el detalle.
CREATE OR REPLACE FUNCTION verificar_limite_usuarios_por_empresa()
RETURNS TRIGGER AS $$
DECLARE
  plan_empresa VARCHAR(50);
  limite INTEGER;
  usuarios_actuales INTEGER;
BEGIN
  SELECT plan INTO plan_empresa FROM empresas WHERE id = NEW.empresa_id;

  limite := CASE plan_empresa
    WHEN 'trial' THEN 1
    WHEN 'basico' THEN 2
    WHEN 'full' THEN 5
    ELSE 1
  END;

  SELECT COUNT(*) INTO usuarios_actuales FROM users WHERE empresa_id = NEW.empresa_id;

  IF usuarios_actuales >= limite THEN
    RAISE EXCEPTION 'limite_usuarios_empresa_excedido' USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_limite_usuarios_empresa
  BEFORE INSERT ON users
  FOR EACH ROW EXECUTE FUNCTION verificar_limite_usuarios_por_empresa();

CREATE TABLE alert_configs (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  categorias TEXT[],
  monto_minimo NUMERIC,
  region VARCHAR(100),
  activo BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE licitaciones_vistas (
  codigo_externo VARCHAR(100) PRIMARY KEY,
  nombre TEXT,
  categoria VARCHAR(255),
  codigo_categoria VARCHAR(50),
  monto_estimado NUMERIC,
  region VARCHAR(100),
  nombre_organismo VARCHAR(255),
  fecha_publicacion TIMESTAMP,
  fecha_cierre TIMESTAMP,
  tipo_licitacion VARCHAR(10),
  monto_utm_min NUMERIC,
  monto_utm_max NUMERIC,
  items JSONB,
  estado VARCHAR(50),
  fecha_adjudicacion TIMESTAMP,
  numero_oferentes INTEGER,
  url_acta TEXT,
  resuelta BOOLEAN DEFAULT false,
  fecha_ultima_revision TIMESTAMP,
  primera_vez_vista TIMESTAMP DEFAULT NOW()
);

CREATE TABLE compras_agiles_vistas (
  codigo_externo VARCHAR(100) PRIMARY KEY,
  nombre TEXT,
  categoria VARCHAR(255),
  monto_estimado NUMERIC,
  region VARCHAR(100),
  rut_institucion VARCHAR(20),
  nombre_institucion VARCHAR(255),
  estado VARCHAR(50),
  fecha_publicacion TIMESTAMP,
  fecha_cierre TIMESTAMP,
  proveedores_cotizando JSONB,
  productos_solicitados JSONB,
  id_orden_compra VARCHAR(100),
  resuelta BOOLEAN DEFAULT false,
  fecha_ultima_revision TIMESTAMP,
  primera_vez_vista TIMESTAMP DEFAULT NOW()
);

CREATE TABLE password_reset_tokens (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  token_hash VARCHAR(64) UNIQUE NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE alerts_sent (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  codigo_externo VARCHAR(100),
  tipo_proceso VARCHAR(20),
  sent_at TIMESTAMP DEFAULT NOW(),
  canal VARCHAR(20),
  UNIQUE (user_id, codigo_externo, canal)
);

-- Catálogo de búsqueda para el picker de categorías/productos en las alertas.
-- Mezcla nivel 3 (categoría, código termina en "00") y nivel 4 (producto específico).
-- Se puebla con scripts/seed-categorias-unspsc.js, no con INSERTs acá.
CREATE TABLE categorias_unspsc (
  codigo VARCHAR(10) PRIMARY KEY,
  titulo TEXT NOT NULL,
  nivel VARCHAR(20)
);

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX idx_categorias_unspsc_titulo ON categorias_unspsc USING gin (titulo gin_trgm_ops);
