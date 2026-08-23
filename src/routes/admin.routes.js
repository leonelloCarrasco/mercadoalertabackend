const express = require('express');
const { correrPollingLicitaciones } = require('../jobs/poll-licitaciones');
const { correrPollingCompraAgil } = require('../jobs/poll-compra-agil');
const { correrRecuperacionCompraAgil } = require('../jobs/recuperacion-compra-agil');
const { correrRevisionResoluciones } = require('../jobs/revisar-resoluciones');
const { correrCargaHistoricaCompraAgil } = require('../jobs/carga-historica-compra-agil');
const { requireAdminKey } = require('../middleware/admin.middleware');

const router = express.Router();
router.use(requireAdminKey);

// Evita que dos corridas de poll-licitaciones se pisen si se dispara dos
// veces mientras la anterior sigue corriendo — mismo criterio que ya usa
// carga-historica-compra-agil.
let pollLicitacionesEnCurso = false;

// poll-compra-agil.js ya trae su propio guard interno (pollEnCurso, evita
// que el cron y un disparo manual se pisen) — acá solo hace falta que el
// endpoint responda rápido y no espere el resultado completo.

// Asíncrono: responde al toque y sigue corriendo en segundo plano — igual
// que carga-historica-compra-agil. Antes esperaba a terminar antes de
// responder (podía tardar bastante con el delay de 3s entre detalles), lo
// que arriesgaba un timeout del lado del cliente/proxy sin que el proceso
// en sí hubiera fallado. Ver el progreso real en los logs del servidor.
router.post('/poll-licitaciones', (req, res) => {
  if (pollLicitacionesEnCurso) {
    return res.status(409).json({ error: 'Ya hay un poll-licitaciones en curso — esperá a que termine antes de disparar otro.' });
  }

  const limite = req.query.limite ? parseInt(req.query.limite, 10) : undefined;

  res.json({ mensaje: 'poll-licitaciones iniciado en segundo plano. Revisa los logs del servidor para ver el progreso.' });

  pollLicitacionesEnCurso = true;
  correrPollingLicitaciones({ limite })
    .then((nuevas) => {
      console.log(`[poll-licitaciones] Terminado — ${nuevas.length} nuevas: ${nuevas.map((n) => n.CodigoExterno).join(', ') || '(ninguna)'}`);
    })
    .catch((err) => {
      console.error('[poll-licitaciones] Error no manejado:', err);
    })
    .finally(() => {
      pollLicitacionesEnCurso = false;
    });
});

// Asíncrono, igual que poll-licitaciones de acá arriba — responde al toque
// y sigue corriendo en segundo plano. Antes esperaba a terminar antes de
// responder; con el rediseño a estado=publicada (agosto 2026) una corrida
// puede recorrer bastantes páginas la primera vez que se corre (hasta que
// se pone al día), así que el mismo riesgo de timeout del lado del
// cliente/proxy que ya se corrigió para poll-licitaciones aplica acá
// también. El parámetro ttlMs quedó sin uso — el diseño nuevo ya no se basa
// en una ventana de tiempo (ver poll-compra-agil.js), así que se sacó de acá.
router.post('/poll-compra-agil', (req, res) => {
  res.json({ mensaje: 'poll-compra-agil iniciado en segundo plano. Revisa los logs del servidor para ver el progreso.' });

  correrPollingCompraAgil()
    .then((guardadas) => {
      console.log(`[poll-compra-agil] Terminado — ${guardadas.length} nuevas: ${guardadas.map((g) => g.item.codigo).join(', ') || '(ninguna)'}`);
    })
    .catch((err) => {
      console.error('[poll-compra-agil] Error no manejado:', err);
    });
});

// Barrido manual completo de estado=publicada, SIN corte temprano — para
// uso puntual cuando se sospecha que quedó un hueco en el polling normal
// (ver el comentario largo en recuperacion-compra-agil.js). Puede tardar
// bastante (varios minutos, según cuántas páginas haya) — pensado para
// dispararse a mano, de noche, no para el cron. Asíncrono, mismo patrón
// que el resto — responde al toque y sigue corriendo atrás. Comparte el
// mismo lock que poll-compra-agil (utils/compra-agil-lock.js), así que si
// alguno de los dos ya está corriendo, este simplemente no hace nada.
router.post('/recuperacion-compra-agil', (req, res) => {
  res.json({ mensaje: 'recuperacion-compra-agil iniciado en segundo plano. Puede tardar varios minutos — revisa los logs del servidor para ver el progreso.' });

  correrRecuperacionCompraAgil()
    .then((resultado) => {
      console.log(`[recuperacion-compra-agil] Terminado: ${resultado.mensaje || 'ya había una corrida en curso, se ignoró este disparo'}`);
    })
    .catch((err) => {
      console.error('[recuperacion-compra-agil] Error no manejado:', err);
    });
});

// Dispara manualmente la revisión de licitaciones/Compras Ágiles cerradas
// pendientes de adjudicación, sin esperar al cron de las 03:00. Puede tardar
// varios minutos si hay muchas licitaciones pendientes (delay de 3s c/u).
router.post('/revisar-resoluciones', async (req, res) => {
  try {
    const limiteLicitaciones = req.query.limite ? parseInt(req.query.limite, 10) : undefined;
    await correrRevisionResoluciones({ limiteLicitaciones });
    res.json({ mensaje: 'Revisión completada. Ver logs del servidor para el detalle.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Carga histórica de Compras Ágiles — recorre día por día desde el
// 01/05/2026 hasta hoy (ver FECHA_INICIO_CARGA_HISTORICA en el job),
// cargando el DETALLE completo de lo que todavía no esté en la base.
// Pensado para completar lo que quedó a medias de una carga masiva anterior
// por archivo (que no traía toda la información).
//
// A diferencia de los otros 3 endpoints de acá arriba, este NO espera a que
// termine — responde al toque y sigue corriendo en segundo plano. Puede
// tardar mucho más que cualquier timeout razonable de un request HTTP
// (recorre potencialmente cientos de días). Ver el progreso real en los
// logs del servidor. Se corta solo al agotar la cuota diaria de la API —
// hay que volver a llamar este mismo endpoint al día siguiente para seguir
// (arranca del mismo día siempre, pero los días ya completos pasan rápido
// porque no tienen nada nuevo que cargar).
router.post('/carga-historica-compra-agil', (req, res) => {
  res.json({ mensaje: 'Carga histórica iniciada en segundo plano. Revisa los logs del servidor para ver el progreso.' });
  correrCargaHistoricaCompraAgil().catch((err) => {
    console.error('[carga-historica] Error no manejado:', err);
  });
});

module.exports = router;
