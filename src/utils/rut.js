/**
 * Utilidades para validar (dígito verificador, módulo 11) y normalizar RUTs chilenos.
 *
 * Se valida el formato para atrapar errores de tipeo obvios antes de guardar o
 * consultar contra Mercado Público. La normalización es solo para uso interno
 * (evitar que "12.345.678-9" y "12345678-9" cuenten como RUTs distintos en
 * nuestra propia base de datos) — al endpoint de BuscarProveedor le seguimos
 * mandando el valor tal como lo escribió el usuario, ya que ese formato
 * (con puntos y guión) es el que confirmamos que funciona en las pruebas.
 */

function limpiarRut(rutCrudo) {
  return String(rutCrudo || '').replace(/[.\s]/g, '').toUpperCase();
}

function calcularDigitoVerificador(cuerpo) {
  let suma = 0;
  let multiplicador = 2;

  for (let i = cuerpo.length - 1; i >= 0; i--) {
    suma += Number(cuerpo[i]) * multiplicador;
    multiplicador = multiplicador === 7 ? 2 : multiplicador + 1;
  }

  const resto = 11 - (suma % 11);
  if (resto === 11) return '0';
  if (resto === 10) return 'K';
  return String(resto);
}

/**
 * Valida que el RUT tenga formato correcto (cuerpo numérico + guión + dígito
 * verificador) y que el dígito verificador sea matemáticamente correcto.
 */
function validarRut(rutCrudo) {
  const limpio = limpiarRut(rutCrudo);
  const match = limpio.match(/^(\d{7,8})-?([\dK])$/);
  if (!match) return false;

  const [, cuerpo, dv] = match;
  return calcularDigitoVerificador(cuerpo) === dv;
}

/**
 * Devuelve el RUT en formato canónico "12345678-9" (sin puntos), para guardarlo
 * de forma consistente en la base de datos. Asume que ya pasó validarRut().
 */
function normalizarRut(rutCrudo) {
  const limpio = limpiarRut(rutCrudo);
  const match = limpio.match(/^(\d{7,8})-?([\dK])$/);
  if (!match) return limpio;
  const [, cuerpo, dv] = match;
  return `${cuerpo}-${dv}`;
}

module.exports = { validarRut, normalizarRut };
