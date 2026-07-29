/**
 * Script de prueba para ver rápido cómo queda el formato de los mensajes de
 * Telegram (negrita, links, división en varios mensajes si son muchos
 * ítems) sin tener que crear una alerta real ni esperar al matching.
 *
 * Siempre imprime el mensaje en consola (crudo, con las etiquetas HTML
 * visibles como texto — útil para revisar la estructura/el largo).
 *
 * Si además le pasás un chat_id, intenta mandarlo de verdad por Telegram —
 * ahí sí vas a ver cómo se renderiza la negrita y el link en la app (la
 * consola nunca te va a mostrar eso, solo el texto crudo). Si
 * TELEGRAM_BOT_TOKEN no está configurado, el envío cae solo en modo
 * simulación (mismo comportamiento que el resto del sistema) — el script
 * funciona igual sin credenciales, solo que no llega nada real al chat.
 *
 * Uso:
 *   node scripts/probar-mensaje-telegram.js
 *   node scripts/probar-mensaje-telegram.js {chatId}
 *   node scripts/probar-mensaje-telegram.js {chatId} {cantidadDeItems}
 *
 * El chat_id es el mismo que ya tenés vinculado en tu cuenta — si no lo
 * sabés de memoria, lo podés sacar directo de la base:
 *   SELECT telegram_chat_id FROM users WHERE email = 'tu-email@ejemplo.cl';
 */
require('dotenv').config({ quiet: true });
const { armarTextoTelegramLicitaciones, armarTextoTelegramCompraAgil } = require('../src/services/alerting.service');
const { enviarTelegramAlerta } = require('../src/services/telegram.service');
const pool = require('../src/db/pool');

function licitacionDeEjemplo(i) {
  return {
    CodigoExterno: `2296-${438 + i}-COT26`,
    Nombre: `Adquisición de Cofre del Tesoro de madera, Guía de Pedido N° ${26692 + i} Seguridad Pública`,
    MontoEstimado: 183300 + i * 1000,
    Comprador: { NombreOrganismo: 'I MUNICIPALIDAD DE CONCHALI' },
    Fechas: { FechaCierre: new Date(Date.now() + 2 * 86400000).toISOString() },
  };
}

function compraAgilDeEjemplo(i) {
  return {
    codigo: `1002588-${69 + i}-COT26`,
    nombre: `Compra Ágil de prueba número ${i}`,
    montos: { monto_disponible_clp: 500000 + i * 1000 },
    institucion: { organismo_comprador: 'SERVICIO LOCAL DE EDUCACION DE PUERTO CORDILLERA' },
    fechas: { fecha_cierre: new Date(Date.now() + 1 * 86400000).toISOString() },
  };
}

async function main() {
  const chatId = process.argv[2] || null;
  const cantidad = parseInt(process.argv[3], 10) || 1;

  const licitaciones = Array.from({ length: cantidad }, (_, i) => licitacionDeEjemplo(i));
  const comprasAgiles = Array.from({ length: cantidad }, (_, i) => compraAgilDeEjemplo(i));

  const mensajesLicitaciones = armarTextoTelegramLicitaciones(licitaciones);
  const mensajesCompraAgil = armarTextoTelegramCompraAgil(comprasAgiles);

  console.log('═'.repeat(60));
  console.log(`LICITACIONES — ${cantidad} ítem(s), ${mensajesLicitaciones.length} mensaje(s) de Telegram`);
  console.log('═'.repeat(60));
  mensajesLicitaciones.forEach((m, i) => {
    console.log(`\n--- Mensaje ${i + 1}/${mensajesLicitaciones.length} (${m.length} caracteres) ---`);
    console.log(m);
  });

  console.log('\n' + '═'.repeat(60));
  console.log(`COMPRA ÁGIL — ${cantidad} ítem(s), ${mensajesCompraAgil.length} mensaje(s) de Telegram`);
  console.log('═'.repeat(60));
  mensajesCompraAgil.forEach((m, i) => {
    console.log(`\n--- Mensaje ${i + 1}/${mensajesCompraAgil.length} (${m.length} caracteres) ---`);
    console.log(m);
  });

  if (chatId) {
    console.log('\n' + '═'.repeat(60));
    console.log(`Enviando de verdad a chat_id ${chatId}...`);
    console.log('═'.repeat(60));
    for (const m of mensajesLicitaciones) await enviarTelegramAlerta(chatId, m);
    for (const m of mensajesCompraAgil) await enviarTelegramAlerta(chatId, m);
    console.log('Listo — revisá tu Telegram (o los logs de arriba si estás en modo simulación).');
  } else {
    console.log('\n(No se mandó nada real — pasá un chat_id como primer argumento para probarlo en tu Telegram de verdad.)');
  }

  await pool.end();
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Error general:', err);
    process.exit(1);
  });
}

module.exports = { main };
