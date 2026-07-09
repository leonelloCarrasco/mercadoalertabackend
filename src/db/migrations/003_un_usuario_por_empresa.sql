-- Migración: hacer cumplir "1 usuario por empresa" a nivel de base de datos
-- para el plan trial, como respaldo atómico ante condiciones de carrera
-- (dos registros con el mismo RUT llegando casi al mismo tiempo).
--
-- Solo cubre 'trial' porque es el único plan alcanzable hoy (no existe flujo
-- de upgrade todavía). Los límites de 'basico' (2 usuarios) y 'full' (5 usuarios)
-- se validan a nivel de aplicación en auth.routes.js — un índice único simple
-- no puede expresar "máximo N filas", solo "máximo 1". Cuando se construya el
-- flujo de upgrade de plan (v2), ahí conviene sumar un trigger que cuente y
-- rechace si se supera el límite de cada plan, para blindar basic/full también
-- contra condiciones de carrera.
--
-- Correr esto en el SQL Editor de Supabase (una sola vez).

CREATE UNIQUE INDEX users_rut_empresa_unico_planes_limitados
  ON users (rut_empresa)
  WHERE plan = 'trial';
