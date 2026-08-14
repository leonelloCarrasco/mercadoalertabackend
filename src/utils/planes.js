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
 * limiteCategorias: cuántas categorías/productos puede elegir el usuario
 * POR ALERTA — a diferencia del resto de los límites, esto no es "más
 * cupo total", es "una alerta puede cubrir más de un producto/rubro a la
 * vez". Escalonado por plan (Trial 1, Basic 2, Full 3) como un segundo eje
 * de valor entre planes, además de las cantidades — antes estaba fijo en 1
 * para los tres, decisión que se revisó y se abrió a partir de este cambio.
 * La categoría/producto sigue siendo OBLIGATORIA (no puede quedar vacía),
 * ver alerts.routes.js.
 * limiteBusquedas (migración 033): cuántas búsquedas guardadas puede tener el
 * usuario en total (no hay concepto de "activa/pausada" acá, a diferencia de
 * las alertas — todas las guardadas cuentan contra el límite).
 * limiteRecordatorios / limiteSeguimientos (migración 035, sección
 * "Oportunidades"): mismo criterio que limiteBusquedas (todos cuentan, sin
 * "activo/pausado"). limiteSeguimientos es más chico a propósito — cada
 * licitación seguida le cuesta una llamada a la API rate-limited al job de
 * seguimiento cada vez que corre, mientras que un recordatorio es
 * prácticamente gratis (solo lee datos ya locales).
 *
 * trial: activo por DIAS_TRIAL días, después la empresa queda bloqueada
 * hasta que se pase a un plan pago (ver requireEmpresaActiva.middleware.js).
 *
 * basico/full: "monto" es el precio de lanzamiento vigente HOY. El precio
 * que efectivamente paga cada empresa queda "congelado" en empresas.monto_mensual
 * al momento de contratar — si el precio de lista cambia después (ver T&C),
 * no afecta a empresas que ya contrataron.
 *
 * accesoAnalisisPrecios: gatea /api/analisis/* (ver analisis.routes.js) —
 * Basic y Full tienen acceso, Trial no. El NIVEL de detalle lo define
 * detalleAnalisisPrecios ('resumen' | 'completo'): 'resumen' (Basic) solo
 * devuelve el rango de precios (mínimo/máximo/promedio) en /precios, sin la
 * lista de registros individuales (proveedor, organismo, precio exacto por
 * contrato) ni acceso a /proveedores, /rechazos, /organismos — esos cuatro
 * puntos son la "inteligencia competitiva" que se reserva para Full.
 * portafolio: gatea POST /api/pipeline (ver pipeline.routes.js) — hoy es
 * true en los tres planes; lo que varía es la cantidad. Trial tiene su
 * propio limitePortafolio (2, para poder probar la función antes de pagar
 * sin regalar acceso completo); Basic/Full no tienen limitePortafolio
 * propio, así que comparten cupo con limiteSeguimientos (ver
 * pipeline.routes.js — cada ítem de Licitación en pipeline consume un
 * seguimiento por detrás, tiene sentido que compartan el límite).
 * mensajeria: string informativo (no un array) para mostrar en el landing y
 * en la sección de Mensajería de Mi Perfil — se detecta si incluye
 * "WhatsApp" para saber si mostrar ese canal como disponible en el plan.
 *
 * accesoPalabrasClave (migración 050): a diferencia de accesoAnalisisPrecios,
 * los TRES planes tienen acceso (incluido Trial) — la idea es que se conozca
 * la función desde la prueba gratuita, con una cuota más chica.
 * limiteSugerenciasIAAlerta / limiteSugerenciasIADia: topes sobre el botón
 * "Sugerir palabras clave" (llamada a la IA) — por alerta (dentro de la
 * misma sesión de creación, se controla en el frontend) y por día (total,
 * sumando todas las alertas, controlado en el backend vía
 * sugerencias_palabras_clave_consumos). Sin ciclo mensual como Análisis IA
 * — el costo por llamada acá es bajo (una lista corta de palabras, no un
 * documento), así que un contador diario simple alcanza.
 * limitePalabrasClave: tope de palabras por lista (positivas y negativas,
 * por separado) — igual para los tres planes a propósito, no es lo que
 * controla el costo (eso lo hacen los dos límites de arriba).
 */
const PLANES = {
  trial: {
    nombreDisplay: 'Trial',
    descripcion: '14 días gratis para probar antes de decidir.',
    limiteUsuarios: 1,
    limiteAlertas: 3,
    limiteCategorias: 1,
    limiteBusquedas: 5,
    limiteRecordatorios: 5,
    limiteSeguimientos: 5,
    limiteAnalisisIA: 3, // por CICLO ROTATIVO de 1 mes desde el primer uso — no mes calendario, no se arrastra lo no usado (ver analisis-ia.queries.js)
    accesoAnalisisPrecios: false, // "análisis de precios de Mercado Público" — exclusivo de planes pagos
    requierePago: false,
    monto: null,
    diasTrial: 14,
    mensajeria: "Email y Telegram",
    portafolio: true,
    limitePortafolio: 2, // solo Trial tiene este campo — "prueba antes de pagar", no comparte cupo con limiteSeguimientos como sí hacen Basic/Full
    accesoPalabrasClave: true,
    limiteSugerenciasIAAlerta: 2,
    limiteSugerenciasIADia: 5,
    limitePalabrasClave: 5,
  },
  basico: {
    nombreDisplay: 'Basic',
    descripcion: 'Para equipos chicos que ya postulan seguido.',
    limiteUsuarios: 1,
    limiteAlertas: 10,
    limiteCategorias: 2,
    limiteBusquedas: 15,
    limiteRecordatorios: 10,
    limiteSeguimientos: 10,
    limiteAnalisisIA: 10,
    accesoAnalisisPrecios: true,
    detalleAnalisisPrecios: 'resumen', // solo rango de precios en /precios — sin registros individuales ni /proveedores, /rechazos, /organismos
    requierePago: true,
    monto: 9990, // IVA incluido
    montoRegular: 14990, // solo informativo, para mostrar "antes/ahora" en la landing — IVA incluido
    mensajeria: "Email, Telegram y WhatsApp",
    portafolio: true,
    accesoPalabrasClave: true,
    limiteSugerenciasIAAlerta: 5,
    limiteSugerenciasIADia: 20,
    limitePalabrasClave: 5,
  },
  full: {
    nombreDisplay: 'Full',
    descripcion: 'Para equipos que postulan a diario.',
    limiteUsuarios: 1,
    limiteAlertas: 20,
    limiteCategorias: 3,
    limiteBusquedas: 30,
    limiteRecordatorios: 20,
    limiteSeguimientos: 20,
    limiteAnalisisIA: 20,
    accesoAnalisisPrecios: true,
    detalleAnalisisPrecios: 'completo',
    requierePago: true,
    monto: 16990, // IVA incluido
    montoRegular: 22990, // IVA incluido
    mensajeria: "Email, Telegram y WhatsApp",
    portafolio: true,
    accesoPalabrasClave: true,
    limiteSugerenciasIAAlerta: 5,
    limiteSugerenciasIADia: 20,
    limitePalabrasClave: 5,
  },
};

// Object.hasOwn (en vez de PLANES[nombrePlan] directo) es la parte crítica
// acá: un objeto literal como PLANES hereda de Object.prototype, así que
// nombrePlan = "constructor", "toString" o "__proto__" devolvería un método
// heredado (truthy, no undefined) con el lookup directo — bastaba mandar
// plan: "constructor" en POST /auth/register para que pasara la validación
// "if (!configPlan)" con un objeto sin monto/requierePago/diasTrial reales,
// lo que terminaba creando una empresa con estado_pago 'activo' y sin fecha
// de expiración de trial (bypass completo del pago). Object.hasOwn descarta
// cualquier propiedad heredada, solo reconoce las 3 claves propias del objeto.
function obtenerPlan(nombrePlan) {
  if (typeof nombrePlan !== 'string' || !Object.hasOwn(PLANES, nombrePlan)) {
    return null;
  }
  return PLANES[nombrePlan];
}

/**
 * ¿Este usuario puede recibir un mensaje de WhatsApp ahora mismo? Requiere
 * número vinculado y verificado, Y que su plan actual incluya WhatsApp en
 * su mensajería (hoy Básico/Full sí, Trial no). Se revisa el plan en cada
 * envío (no solo al vincular) porque pudo haber bajado de plan después.
 *
 * Centralizada acá porque la usan los tres puntos que mandan WhatsApp:
 * alerting.service.js (licitaciones/Compras Ágiles nuevas),
 * seguimiento-estado.js (cambio de estado) y recordatorio-cierre.js
 * (recordatorio de cierre) — todos reciben una fila con los mismos nombres
 * de campo (whatsapp_verificado, whatsapp_numero, plan) porque sus queries
 * hacen el mismo JOIN con empresas.
 */
function puedeRecibirWhatsapp(fila) {
  if (!fila.whatsapp_verificado || !fila.whatsapp_numero) return false;
  const plan = obtenerPlan(fila.plan);
  return Boolean(plan?.mensajeria?.includes('WhatsApp'));
}

module.exports = { PLANES, obtenerPlan, puedeRecibirWhatsapp };
