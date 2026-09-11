import { t } from '../i18n';
import type { Dictionary } from '../i18n';

type ErrorKey = keyof Dictionary['errors'];

/**
 * Traducción de códigos de error del servidor a mensajes para el jugador.
 *
 * El servidor manda códigos y nunca texto: cada cliente lo escribe en su idioma,
 * y así dos jugadores de la misma party pueden leer el mismo error distinto.
 */
export function errorMessage(code: string): string {
  const messages = t().errors;
  return messages[code as ErrorKey] ?? messages.UNKNOWN;
}
