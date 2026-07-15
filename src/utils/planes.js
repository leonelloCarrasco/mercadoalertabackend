/**
 * Fuente única de verdad para los planes.
 *
 * Desde la migración 023, el límite de usuarios por empresa es 1 para TODOS
 * los planes (modelo "1 usuario = 1 empresa"). El trigger de Postgres
 * (migración 023, reemplaza al de la 007) hardcodea ese mismo límite —
 * si algún día se vuelve a un modelo multi-usuario, hay que cambiarlo también ahí.
 *
 * limiteAlertas: cuántas configuraciones de alerta ACTIVAS puede tener el
 * usuario en simultáneo (las pausadas no cuentan, ver contarConfigsActivasDeUsuario).
 * limiteCategorias: cuántas categorías/productos puede elegir por alerta —
 * ahora es 1 para todos los planes (antes variaba); además, desde este cambio
 * la categoría/producto es OBLIGATORIA (no puede quedar vacía), ver alerts.routes.js.
 * limiteBusquedas (migración 033): cuántas búsquedas guardadas puede tener el
 * usuario en total (no hay concepto de "activa/pausada" acá, a diferencia de
 * las alertas — todas las guardadas cuentan contra el límite).
 *
 * trial: activo por DIAS_TRIAL días, después la empresa queda bloqueada
 * hasta que se pase a un plan pago (ver requireEmpresaActiva.middleware.js).
 *
 * basico/full: "monto" es el precio de lanzamiento vigente HOY. El precio
 * que efectivamente paga cada empresa queda "congelado" en empresas.monto_mensual
 * al momento de contratar — si el precio de lista cambia después (ver T&C),
 * no afecta a empresas que ya contrataron.
 */
const PLANES = {
  trial: {
    limiteUsuarios: 1,
    limiteAlertas: 1,
    limiteCategorias: 1,
    limiteBusquedas: 5,
    requierePago: false,
    monto: null,
    diasTrial: 14,
  },
  basico: {
    limiteUsuarios: 1,
    limiteAlertas: 10,
    limiteCategorias: 1,
    limiteBusquedas: 10,
    requierePago: true,
    monto: 8990,
    montoRegular: 12990, // solo informativo, para mostrar "antes/ahora" en la landing
  },
  full: {
    limiteUsuarios: 1,
    limiteAlertas: 15,
    limiteCategorias: 1,
    limiteBusquedas: 20,
    requierePago: true,
    monto: 14990,
    montoRegular: 18990,
  },
};

function obtenerPlan(nombrePlan) {
  return PLANES[nombrePlan] || null;
}

module.exports = { PLANES, obtenerPlan };
