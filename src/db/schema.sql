CREATE TABLE empresas (
  id SERIAL PRIMARY KEY,
  rut VARCHAR(20) UNIQUE NOT NULL CHECK (rut ~ '^[0-9]{7,8}-[0-9K]$'),
  nombre_empresa VARCHAR(255),
  rut_validado BOOLEAN DEFAULT false,
  -- declara_emt y responsable_*/*_contacto quedan en desuso desde la migración
  -- 023 (modelo 1 usuario = 1 empresa): el responsable ES el usuario de la
  -- empresa, sus datos de contacto viven en `users`. No se eliminan las
  -- columnas para no perder datos históricos de empresas del modelo anterior.
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
  telefono VARCHAR(30),
  empresa_id INTEGER NOT NULL REFERENCES empresas(id),
  telegram_chat_id VARCHAR(50),
  -- Estado del flujo de registro (migración 023): pendiente_email -> (solo
  -- basic/full) pendiente_pago -> activo. Los usuarios no pueden iniciar
  -- sesión hasta llegar a 'activo'.
  estado VARCHAR(30) NOT NULL DEFAULT 'pendiente_email',
  acepta_terminos BOOLEAN NOT NULL DEFAULT false,
  acepta_terminos_at TIMESTAMP,
  -- Acceso al panel de administrador interno (migración 028) — se activa a
  -- mano en la base de datos, no hay flujo de auto-registro para esto.
  es_admin BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Límite de usuarios por empresa: 1, para todos los planes (migración 023 —
-- antes era trial=1/basico=2/full=5, del modelo multi-usuario descartado).
-- Aplicado de forma atómica vía trigger, como respaldo ante condiciones de
-- carrera (ver también la verificación a nivel de aplicación en auth.routes.js).
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

CREATE TRIGGER trigger_limite_usuarios_empresa
  BEFORE INSERT ON users
  FOR EACH ROW EXECUTE FUNCTION verificar_limite_usuarios_por_empresa();

CREATE TABLE alert_configs (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  -- Único campo obligatorio (migración 029): producto o rubro, máximo 1.
  categorias TEXT[],
  -- Opcionales — NULL o array vacío significa "sin filtrar por esto" en todos
  -- los casos (ver matching.service.js):
  monto_minimo NUMERIC,
  -- monto_minimo/monto_maximo (migración 029) son un criterio EXCLUSIVO de
  -- Compra Ágil — para Licitaciones el rango de monto se cubre con
  -- tramos_licitacion (un tramo YA define un rango de monto por definición).
  monto_maximo NUMERIC,
  -- Selección múltiple de regiones (migración 024). NULL o array vacío
  -- significa "todas las regiones" — ver matching.service.js.
  regiones TEXT[],
  tipos_proceso TEXT[],           -- 'licitacion' y/o 'compra_agil' (migración 029); vacío = ambos
  tramos_licitacion TEXT[],       -- códigos de TRAMOS_LICITACION (migración 029); solo aplica a licitaciones
  -- codigo_organismo (migración 032, antes guardaba nombre — migración 029): el
  -- picker del formulario sigue siendo por nombre (no cambia el frontend), pero
  -- el backend traduce a codigo_organismo al guardar (ver alerts.routes.js /
  -- traducirOrganismosACodigos) — el matching (matching.service.js) compara por
  -- código, no por texto.
  organismos TEXT[],
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
  -- codigo_organismo (migración 031): CodigoOrganismo oficial de la API de Mercado
  -- Público, mismo identificador que organismos_compradores.codigo. Permite que el
  -- matching de alertas compare por código en vez de por nombre_organismo (texto) —
  -- ver matching.service.js. Filas guardadas antes de la 031 se completan con el
  -- backfill 031a_backfill_codigo_organismo.sql.
  codigo_organismo VARCHAR(20),
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

CREATE INDEX idx_licitaciones_vistas_codigo_organismo ON licitaciones_vistas (codigo_organismo);

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

-- Tabla de tokens de un solo uso, reutilizada para varios propósitos
-- distinguidos por `tipo`: 'reset_password' (default, recuperación de clave),
-- 'confirmacion_cuenta' (migración 023, confirmar email al registrarse).
CREATE TABLE password_reset_tokens (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  empresa_id INTEGER REFERENCES empresas(id) ON DELETE CASCADE,
  tipo VARCHAR(30) NOT NULL DEFAULT 'reset_password',
  token_hash VARCHAR(64) UNIQUE NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE alerts_sent (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  -- Qué alerta específica del usuario generó este envío (migración 027) — un
  -- usuario puede tener varias alertas activas a la vez. SET NULL en vez de
  -- CASCADE: si se borra la alerta, el historial de envíos ya hechos se conserva.
  alert_config_id INTEGER REFERENCES alert_configs(id) ON DELETE SET NULL,
  codigo_externo VARCHAR(100),
  tipo_proceso VARCHAR(20),
  sent_at TIMESTAMP DEFAULT NOW(),
  canal VARCHAR(20),
  UNIQUE (user_id, codigo_externo, canal)
);

-- Catálogo de búsqueda para el picker de categorías/productos en las alertas.
-- Mezcla nivel 3 (categoría/"rubro", código termina en "00") y nivel 4 (producto
-- específico). nivel1 (segmento) y nivel2 (familia) permiten armar el árbol de
-- navegación por rubro (migración 025). `hijos` (migración 026) guarda, para
-- los códigos de 9 dígitos de la sección Obras/Consultoría que agrupan otros
-- códigos, la lista completa de códigos hoja descendientes — esa sección no
-- sigue la convención de prefijo de UNSPSC, así que el matching jerárquico
-- necesita la lista explícita en vez de poder inferirla del código.
-- Se puebla con scripts/seed-categorias-unspsc.js, no con INSERTs acá.
CREATE TABLE categorias_unspsc (
  codigo VARCHAR(10) PRIMARY KEY,
  titulo TEXT NOT NULL,
  nivel VARCHAR(20),
  nivel1 VARCHAR(255),
  nivel2 VARCHAR(255),
  hijos TEXT[]
);

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX idx_categorias_unspsc_titulo ON categorias_unspsc USING gin (titulo gin_trgm_ops);
CREATE INDEX idx_categorias_unspsc_nivel1_nivel2 ON categorias_unspsc (nivel1, nivel2) WHERE nivel = 'categoria';

-- Catálogo propio de organismos compradores (migración 030), poblado desde el
-- listado oficial de ChileCompra en vez de derivarse de lo que ya se haya
-- importado en licitaciones_vistas/compras_agiles_vistas. `codigo` es el
-- CodigoOrganismo oficial de la API de Mercado Público — no se usa todavía
-- para matching (que sigue siendo por nombre exacto), pero queda listo para
-- esa mejora futura. Se puebla con scripts/seed-organismos-compradores.js.
CREATE TABLE organismos_compradores (
  codigo VARCHAR(20) PRIMARY KEY,
  nombre TEXT NOT NULL,
  sector VARCHAR(100)
);

CREATE INDEX idx_organismos_compradores_nombre ON organismos_compradores USING gin (nombre gin_trgm_ops);
