-- Migración: tabla busquedas_guardadas — sección "Búsquedas" del dashboard.
-- Ejecuta DIRECTO contra las APIs en vivo de Mercado Público, sin base local
-- de por medio. Cada búsqueda es de UN tipo (licitacion o compra_agil).
--
-- Para LICITACIONES, la API solo admite 4 combinaciones reales de filtros
-- (ver https://api.mercadopublico.cl/modules/api.aspx) — por eso cada
-- búsqueda de este tipo elige un "modo" excluyente entre sí, y solo llena
-- las columnas que le corresponden a ese modo:
--
--   'codigo'       -> codigo_externo               (?codigo=X, ignora todo lo demás)
--   'estado_fecha' -> estado + fecha                (?fecha=X&estado=Y — si no hay
--                     fecha, se usa el día de HOY al momento de ejecutar, no un
--                     valor congelado; si no hay estado, se usa 'todos')
--   'proveedor'    -> rut_proveedor + fecha          (se resuelve el RUT a
--                     CodigoProveedor vía BuscarProveedor antes de llamar a
--                     licitaciones.json)
--   'organismo'    -> organismos (1 código)          (se busca en
--                     organismos_compradores por nombre para obtener el código,
--                     mismo criterio que alert_configs.organismos — migración 032)
--
-- Para COMPRA ÁGIL no hay "modo" — usa monto_minimo/monto_maximo, regiones (una)
-- y organismos, que sí vienen en el listado de cambios recientes sin
-- necesitar detalle por proceso (ver busqueda-ejecutor.service.js).
--
-- No hay concepto de "activo/pausado" — una búsqueda guardada no dispara
-- notificaciones, solo se ejecuta a pedido (ver POST /api/busquedas/:id/ejecutar).
-- El límite de cuántas puede guardar cada usuario según su plan vive en
-- src/utils/planes.js (limiteBusquedas).

CREATE TABLE busquedas_guardadas (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  nombre VARCHAR(150) NOT NULL,
  tipo VARCHAR(20) NOT NULL CHECK (tipo IN ('licitacion', 'compra_agil')),

  -- Solo Licitaciones:
  modo VARCHAR(20) CHECK (modo IN ('codigo', 'estado_fecha', 'proveedor', 'organismo')),
  codigo_externo VARCHAR(100),
  estado VARCHAR(20),
  fecha DATE,
  rut_proveedor VARCHAR(20),

  -- Compra Ágil (monto/regiones) + modo='organismo' de Licitaciones (organismos):
  monto_minimo NUMERIC,
  monto_maximo NUMERIC,
  regiones TEXT[],
  -- organismos: guarda CÓDIGO (no nombre), igual que alert_configs.organismos
  -- desde la migración 032 — el picker del formulario sigue siendo por nombre,
  -- el backend traduce (ver traducirOrganismosACodigos en organismos.queries.js).
  organismos TEXT[],

  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_busquedas_guardadas_user_id ON busquedas_guardadas (user_id);
