/**
 * Diagnóstico de la API de Compra Ágil — corré esto donde tengas
 * COMPRAAGIL_TICKET disponible (local con .env, o la consola de Render).
 *
 * Uso: node scripts/diagnostico-compra-agil.js
 *
 * Compara DOS llamadas distintas a la misma API:
 *   1. "cambios recientes" (la que usa el polling — la que está devolviendo 0)
 *   2. Una búsqueda simple por listado, SIN el filtro de ttl_cambio_ms
 *      (la misma que usa la sección "Búsquedas" del dashboard)
 *
 * Si (1) da 0 pero (2) trae resultados reales → el problema es específico
 * del filtro/índice de "cambios recientes", no del ticket ni de la API en
 * general. Si las DOS dan 0 → probablemente el ticket venció o hay un
 * problema más amplio de acceso.
 */
require('dotenv').config({ quiet: true });

const BASE_URL = 'https://api2.mercadopublico.cl';
const ticket = process.env.COMPRAAGIL_TICKET;

if (!ticket) {
  console.error('Falta COMPRAAGIL_TICKET en el entorno. No se puede probar.');
  process.exit(1);
}

async function llamar(path, params) {
  const query = new URLSearchParams(params).toString();
  const url = `${BASE_URL}${path}${query ? `?${query}` : ''}`;
  console.log('→', url);
  const res = await fetch(url, { headers: { ticket } });
  const data = await res.json();
  console.log('   status HTTP:', res.status);
  console.log('   success:', data.success);
  if (data.errors) console.log('   errors:', JSON.stringify(data.errors));
  if (data.paginacion) console.log('   paginacion:', JSON.stringify(data.paginacion));
  if (data.items) console.log('   items en esta página:', data.items.length);
  return data;
}

(async () => {
  console.log('=== 1. Cambios recientes (últimas 3 horas) — la que usa el polling ===');
  await llamar('/v2/compra-agil', {
    ttl_cambio_ms: 3 * 60 * 60 * 1000,
    tamano_pagina: 10,
    numero_pagina: 1,
  });

  console.log('\n=== 2. Cambios recientes con ventana MUY amplia (últimos 30 días) ===');
  await llamar('/v2/compra-agil', {
    ttl_cambio_ms: 30 * 24 * 60 * 60 * 1000,
    tamano_pagina: 10,
    numero_pagina: 1,
  });

  console.log('\n=== 3. Búsqueda simple SIN ttl_cambio_ms (mismo endpoint, sin el filtro de "recientes") ===');
  await llamar('/v2/compra-agil', {
    tamano_pagina: 10,
    numero_pagina: 1,
  });
})();
