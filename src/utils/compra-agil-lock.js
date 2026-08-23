// Lock compartido entre poll-compra-agil.js y recuperacion-compra-agil.js —
// las dos consumen la misma cuota de la API de Compra Ágil, así que no
// deberían correr al mismo tiempo (mismo motivo que ya justificó el guard
// interno de poll-compra-agil: evitar corridas superpuestas compitiendo
// por la misma cuota, con logs entrelazados y confusos).
let enCurso = false;

function estaEnCurso() {
  return enCurso;
}

function marcarEnCurso(valor) {
  enCurso = valor;
}

module.exports = { estaEnCurso, marcarEnCurso };
