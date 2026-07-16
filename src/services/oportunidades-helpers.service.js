const { licitacionYaVista, guardarLicitacion } = require('../db/licitaciones.queries');
const { compraAgilYaVista, guardarCompraAgil } = require('../db/compra-agil.queries');
const { obtenerDetalleLicitacion } = require('./mercadopublico.service');
const { obtenerDetalleCompraAgil } = require('./compraagil.service');

/**
 * "Oportunidades" (recordatorios/seguimientos) se agrega desde Notificaciones
 * o desde Búsquedas — pero Búsquedas consulta las APIs EN VIVO, no nuestra
 * base local: es perfectamente posible que el usuario quiera agendar un
 * recordatorio para una licitación que el polling normal todavía no capturó
 * (o nunca va a capturar, si no matchea ninguna alerta de nadie). Como el
 * recordatorio y el seguimiento dependen de tener el registro local (fecha_cierre
 * para el recordatorio, estado para inicializar el seguimiento), estas dos
 * funciones lo traen y lo guardan al vuelo si hace falta, ANTES de crear el
 * recordatorio/seguimiento — así el resto del flujo no tiene que preocuparse
 * de si ya existía o no.
 */
async function asegurarLicitacionLocal(codigoExterno) {
  const yaExiste = await licitacionYaVista(codigoExterno);
  if (yaExiste) return true;

  const detalle = await obtenerDetalleLicitacion(codigoExterno);
  if (!detalle) return false;

  await guardarLicitacion(detalle);
  return true;
}

async function asegurarCompraAgilLocal(codigoExterno) {
  const yaExiste = await compraAgilYaVista(codigoExterno);
  if (yaExiste) return true;

  const detalle = await obtenerDetalleCompraAgil(codigoExterno);
  if (!detalle) return false;

  // El detalle de Compra Ágil trae los mismos campos de cabecera (nombre,
  // montos, institución, estado, fechas) que el item resumido del listado —
  // guardarCompraAgil(item, detalle) puede recibir el mismo objeto en los
  // dos parámetros sin problema.
  await guardarCompraAgil(detalle, detalle);
  return true;
}

module.exports = { asegurarLicitacionLocal, asegurarCompraAgilLocal };
