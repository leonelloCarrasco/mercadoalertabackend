/**
 * Fuente única de verdad para los planes. OJO: el trigger de Postgres
 * (migración 007) también hardcodea los límites de usuarios por plan —
 * si cambias algo acá, cámbialo también ahí (no hay forma automática de
 * mantenerlos sincronizados todavía).
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
    limiteAlertas: 3,
    limiteCategorias: 1,
    requierePago: false,
    monto: null,
    diasTrial: 7,
  },
  basico: {
    limiteUsuarios: 2,
    limiteAlertas: 10,
    limiteCategorias: 3,
    requierePago: true,
    monto: 8990,
    montoRegular: 12990, // solo informativo, para mostrar "antes/ahora" en la landing
  },
  full: {
    limiteUsuarios: 5,
    limiteAlertas: 20,
    limiteCategorias: 5,
    requierePago: true,
    monto: 14990,
    montoRegular: 18990,
  },
};

function obtenerPlan(nombrePlan) {
  return PLANES[nombrePlan] || null;
}

module.exports = { PLANES, obtenerPlan };
