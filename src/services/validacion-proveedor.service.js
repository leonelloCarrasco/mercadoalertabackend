/**
 * Valida un RUT contra el endpoint público BuscarProveedor de Mercado Público.
 * Devuelve { valido: boolean, nombreEmpresa: string|null }.
 *
 * IMPORTANTE: esto solo confirma que el RUT corresponde a un proveedor real
 * inscrito en Mercado Público. No valida el tamaño de la empresa (EMT/PYME),
 * ya que esa clasificación depende de datos tributarios privados del SII
 * a los que no tenemos acceso como terceros. Ver nota de riesgo en el plan de MVP.
 */

const BASE_URL = 'https://api.mercadopublico.cl/servicios/v1/Publico/Empresas/BuscarProveedor';

async function validarProveedor(rut) {
  const ticket = process.env.MERCADOPUBLICO_TICKET;

  if (!ticket) {
    console.warn('⚠️  MERCADOPUBLICO_TICKET no está configurado en .env — se omite la validación de RUT.');
    return { valido: null, nombreEmpresa: null, omitido: true };
  }

  const url = `${BASE_URL}?rutempresaproveedor=${encodeURIComponent(rut)}&ticket=${ticket}`;

  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
    });

    if (!response.ok) {
      const body = await response.json().catch(() => null);

      // La API responde con HTTP 500 y este código tanto cuando el RUT no existe
      // como cuando hay rate limiting ("peticiones simultáneas", HTTP 429, Código 10500).
      // Solo el primer caso es un "no encontrado" real; lo demás (rate limit, caídas del
      // servicio) no debe marcar el RUT como inválido, o se pierde la validación de RUTs
      // legítimos cada vez que esta llamada coincide con el rate limit de Mercado Público
      // (algo frecuente: los cron jobs de src/jobs pegan a la misma API cada 1-3 horas).
      if (response.status === 500 && body?.Codigo === 10200) {
        return { valido: false, nombreEmpresa: null };
      }

      console.warn(`Validación de RUT devolvió status ${response.status} para ${rut}: ${body?.Mensaje || ''}`);
      return { valido: null, nombreEmpresa: null, error: body?.Mensaje || `status ${response.status}` };
    }

    const data = await response.json();

    // Estructura real confirmada en pruebas: { Cantidad, FechaCreacion, listaEmpresas: [{ CodigoEmpresa, NombreEmpresa }] }
    const empresas = data && Array.isArray(data.listaEmpresas) ? data.listaEmpresas : [];

    if (empresas.length > 0 && data.Cantidad > 0) {
      return { valido: true, nombreEmpresa: empresas[0].NombreEmpresa };
    }

    return { valido: false, nombreEmpresa: null };
  } catch (err) {
    console.error('Error consultando BuscarProveedor:', err.message);
    // Ante un error de red, no bloqueamos el registro — solo queda sin validar.
    return { valido: null, nombreEmpresa: null, error: err.message };
  }
}

module.exports = { validarProveedor };
