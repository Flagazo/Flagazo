import { randomInt } from 'node:crypto';

/**
 * Mezcla sin sesgo (Fisher-Yates) con el generador criptográfico.
 *
 * Vive aparte porque lo usan tanto el motor como los modos de juego, y un
 * shuffle mal hecho (el clásico `sort(() => Math.random() - 0.5)`) sesga el
 * orden de forma que se nota: algunas banderas saldrían primero mucho más seguido.
 */
export function shuffle<T>(items: readonly T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy;
}
