-- Migración: separar "empresa" como entidad propia, distinta de "usuario".
--
-- Antes: cada usuario tenía su propio rut_empresa/nombre_empresa/rut_validado/plan,
-- y se revalidaba contra Mercado Público en cada registro, incluso para el
-- segundo o tercer usuario de una empresa ya validada.
--
-- Ahora: la empresa se pre-registra y valida UNA sola vez (endpoint nuevo
-- /api/empresas/pre-registro), y los usuarios se asocian a una empresa ya existente
-- sin volver a golpear la API de Mercado Público.
--
-- Correr esto en el SQL Editor de Supabase, en orden, una sola vez.

-- 1. Tabla de empresas
CREATE TABLE empresas (
  id SERIAL PRIMARY KEY,
  rut VARCHAR(20) UNIQUE NOT NULL,
  nombre_empresa VARCHAR(255),
  rut_validado BOOLEAN DEFAULT false,
  plan VARCHAR(50) DEFAULT 'trial',
  created_at TIMESTAMP DEFAULT NOW()
);

-- 2. Migrar las empresas ya existentes a partir de los usuarios actuales
--    (toma los datos del usuario mas antiguo de cada RUT)
INSERT INTO empresas (rut, nombre_empresa, rut_validado, plan)
SELECT DISTINCT ON (rut_empresa) rut_empresa, nombre_empresa, rut_validado, plan
FROM users
ORDER BY rut_empresa, id ASC;

-- 3. Agregar la referencia en users y completarla con los datos migrados
ALTER TABLE users ADD COLUMN empresa_id INTEGER REFERENCES empresas(id);

UPDATE users u
SET empresa_id = e.id
FROM empresas e
WHERE u.rut_empresa = e.rut;

ALTER TABLE users ALTER COLUMN empresa_id SET NOT NULL;

-- 4. Sacar de users las columnas que ahora viven en empresas
DROP INDEX IF EXISTS users_rut_empresa_unico_planes_limitados;

ALTER TABLE users
  DROP COLUMN rut_empresa,
  DROP COLUMN nombre_empresa,
  DROP COLUMN rut_validado,
  DROP COLUMN plan;

-- 5. Trigger: hacer cumplir el limite de usuarios por empresa segun su plan,
--    de forma atomica. Reemplaza al indice unico parcial que teniamos antes
--    (que solo podia expresar "maximo 1", no "maximo N") - ahora si podemos
--    blindar basic (2) y full (5) tambien, no solo trial.
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
