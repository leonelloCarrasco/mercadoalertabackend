-- Cola de Compras Ágiles descubiertas (aparecen en estado=publicada) pero
-- cuyo detalle no se alcanzó a pedir/guardar todavía — por un corte de
-- cuota a mitad de una corrida, o por una falla puntual en un ítem.
--
-- Por qué hace falta esto (ver conversación de agosto 2026): el listado
-- está ordenado por más-reciente-primero, y el corte temprano de paginación
-- para apenas encuentra una página 100% conocida. Si una corrida se corta
-- a mitad del loop de detalles, lo que quedó sin guardar sigue "publicada"
-- pero ahora está enterrado bajo lo que sí se guardó bien en esa misma
-- corrida — la corrida siguiente encuentra esa página de "ya guardados"
-- primero, corta ahí, y nunca vuelve a bajar lo suficiente como para
-- encontrar el hueco real. Caso real en producción: 7.685 nuevas
-- descubiertas, se guardaron 752 antes de un 504, la corrida siguiente solo
-- alcanzó a ver 40 genuinas nuevas antes de toparse con esos 752 y cortar
-- — las otras ~6.933 quedaron invisibles para siempre sin este mecanismo.
--
-- Se procesa AL PRINCIPIO de cada corrida de poll-compra-agil, antes de
-- salir a descubrir cosas nuevas — así nunca depende de que el corte
-- temprano las vuelva a encontrar solas.
CREATE TABLE compra_agil_pendientes_detalle (
  codigo_externo TEXT PRIMARY KEY,
  agregado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
