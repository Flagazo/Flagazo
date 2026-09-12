import { randomBytes } from 'node:crypto';

/**
 * Anti-trampa básico.
 *
 * Si la bandera se pidiera como `/flags/ar.svg`, cualquiera abre la pestaña de
 * red del navegador y lee la respuesta antes de escribirla. Mientras la bandera
 * está activa se sirve por `/flag/r/<token>`, un id aleatorio que no dice nada.
 *
 * No es seguridad de verdad (quien reconozca el SVG gana igual), pero saca la
 * trampa de un clic de distancia, que es lo que arruina una partida entre amigos.
 */
const tokens = new Map<string, { countryId: string; createdAt: number }>();

/** Un token vive lo que puede durar una partida larga, y después se limpia. */
const TOKEN_TTL_MS = 45 * 60 * 1000;

export function createFlagToken(countryId: string): string {
  const token = randomBytes(16).toString('hex');
  tokens.set(token, { countryId, createdAt: Date.now() });
  return token;
}

export function resolveFlagToken(token: string): string | undefined {
  return tokens.get(token)?.countryId;
}

/**
 * Invalida un token antes de que venza.
 *
 * En Draw Battle con "solo la bandera", la imagen se deja ver unos segundos y se
 * tapa: si el token siguiera sirviendo, bastaría con volver a abrir la URL.
 */
export function revokeFlagToken(token: string) {
  tokens.delete(token);
}

/** Borra los tokens vencidos. Devuelve cuántos sacó. */
export function sweepFlagTokens(now = Date.now()): number {
  let removed = 0;
  for (const [token, entry] of tokens) {
    if (now - entry.createdAt > TOKEN_TTL_MS) {
      tokens.delete(token);
      removed++;
    }
  }
  return removed;
}

/** Solo para los tests. */
export function countFlagTokens(): number {
  return tokens.size;
}
