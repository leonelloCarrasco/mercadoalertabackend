const { listarPublicadas, CuotaAgotadaError } = require('../services/compraagil.service');
const { obtenerCodigosCompraAgilYaVistos, agregarPendientesDetalleCompraAgil } = require('../db/compra-agil.queries');
const { estaEnCurso, marcarEnCurso } = require('../utils/compra-agil-lock');

// Mismo valor que PAUSA_ENTRE_PAGINAS_MS en compraagil.service.js — no se
// importa de ahí porque es una constante privada de ese archivo, pero es
// el mismo motivo (evitar ráfaga contra la misma API).
const PAUSA_ENTRE_PAGINAS_MS = 300;
function esperar(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Barrido MANUAL, completo, de estado=publicada — a diferencia del
 * polling normal (poll-compra-agil.js), acá NO hay corte temprano: se
 * recorren TODAS las páginas, sin importar cuántas sean. No pide detalle
 * de nada — solo compara cada código contra lo que ya está guardado, y
 * lo que falte lo agrega a la cola de pendientes (compra_agil_pendientes_
 * detalle) para que el polling normal (que sí pide detalle, con pausa y
 * manejo de errores) lo procese en su próxima corrida.
 *
 * Para qué sirve esto (ver conversación de agosto 2026): el corte
 * temprano del polling normal asume que "si una página está 100%
 * conocida, todo lo de abajo también" — una suposición que se rompe si
 * una corrida anterior se cortó a mitad de camino (por un 504 agotando
 * los reintentos, por ejemplo) y dejó algo sin guardar que ahora quedó
 * "enterrado" bajo publicaciones más nuevas. Este barrido no tiene ese
 * punto ciego, porque no se detiene nunca antes de tiempo — pero por eso
 * mismo es una operación pesada (con miles de resultados, cientos de
 * páginas), pensada para uso manual y puntual cuando se sospecha un
 * hueco así, NO para correr en ningún cron.
 *
 * Uso: POST /api/admin/recuperacion-compra-agil (asíncrono, ver
 * admin.routes.js) — pensado para dispararse a mano, en un horario de
 * bajo tráfico, no como parte del polling automático.
 */
async function correrRecuperacionCompraAgil() {
  if (estaEnCurso()) {
    console.warn('[recuperacion-compra-agil] Ya hay una corrida en curso (polling normal u otra recuperación) — se ignora este disparo para no competir por la misma cuota.');
    return { totalRevisados: 0, totalEncontrados: 0, yaEnCurso: true };
  }
  marcarEnCurso(true);

  console.log('[recuperacion-compra-agil] Iniciando barrido completo (SIN corte temprano) — puede tardar bastante, según cuántas páginas haya.');

  let numeroPagina = 1;
  let totalPaginas = 1;
  let totalRevisados = 0;
  let totalEncontrados = 0;
  let cortado = false;

  try {
    do {
      let payload;
      try {
        payload = await listarPublicadas({ numeroPagina });
      } catch (err) {
        if (err instanceof CuotaAgotadaError) {
          console.warn(`[recuperacion-compra-agil] ${err.message} — se corta en la página ${numeroPagina}/${totalPaginas}. Se puede volver a correr más tarde para seguir desde donde quede.`);
          cortado = true;
          break;
        }
        throw err;
      }

      totalPaginas = payload.paginacion.total_paginas;
      totalRevisados += payload.items.length;

      const codigosPagina = payload.items.map((item) => item.codigo);
      const yaVistos = await obtenerCodigosCompraAgilYaVistos(codigosPagina);
      const faltantes = codigosPagina.filter((c) => !yaVistos.has(c));

      if (faltantes.length > 0) {
        await agregarPendientesDetalleCompraAgil(faltantes);
        totalEncontrados += faltantes.length;
        console.log(`[recuperacion-compra-agil] Página ${numeroPagina}/${totalPaginas}: ${faltantes.length} faltantes encontrados y agregados a la cola de pendientes.`);
      }

      if (numeroPagina % 25 === 0) {
        console.log(`[recuperacion-compra-agil] Progreso: ${numeroPagina}/${totalPaginas} páginas, ${totalEncontrados} faltantes encontrados hasta ahora.`);
      }

      numeroPagina += 1;
      if (numeroPagina <= totalPaginas) await esperar(PAUSA_ENTRE_PAGINAS_MS);
    } while (numeroPagina <= totalPaginas);

    const mensaje = cortado
      ? `Se cortó por cuota en la página ${numeroPagina}/${totalPaginas}. ${totalRevisados} revisados, ${totalEncontrados} faltantes agregados a la cola. Se puede volver a correr más tarde.`
      : `Terminado — ${totalRevisados} revisados en total (${totalPaginas} páginas), ${totalEncontrados} faltantes agregados a la cola de pendientes.`;

    console.log(`[recuperacion-compra-agil] ${mensaje}`);
    return { totalRevisados, totalEncontrados, totalPaginas, cortado, mensaje };
  } finally {
    marcarEnCurso(false);
  }
}

module.exports = { correrRecuperacionCompraAgil };
