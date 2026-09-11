/**
 * Distancia de edición para perdonar errores de tipeo.
 *
 * Se usa la variante **OSA** (optimal string alignment) de Damerau-Levenshtein:
 * cuenta inserciones, borrados, sustituciones y el intercambio de dos letras
 * contiguas como **una sola** edición. Eso último es clave para un juego donde
 * se escribe rápido: "Argnetina" está a 1 de "Argentina", no a 2.
 *
 * Cada respuesta se compara contra miles de nombres, así que la función acepta
 * un tope y abandona en cuanto lo supera: no interesa cuán lejos está algo que
 * ya sabemos que no entra.
 */

/**
 * Cuántos errores se perdonan según el largo del nombre contra el que se compara.
 *
 * Es a propósito más estricto en los nombres cortos: con tolerancia 1, "Chad"
 * aceptaría "Chat" y "Irán" aceptaría "Irak", que son otro país.
 */
export function toleranceFor(length: number): number {
  if (length <= 4) return 0;
  if (length <= 7) return 1;
  if (length <= 11) return 2;
  return 3;
}

/** El tope de tolerancia posible, para poder descartar por largo sin calcular nada. */
export const MAX_TOLERANCE = 3;

/**
 * Distancia entre dos textos, hasta `max`.
 * Si es mayor devuelve `max + 1`, que alcanza para descartar el candidato.
 */
export function editDistance(a: string, b: string, max: number): number {
  if (a === b) return 0;
  // Con solo insertar o borrar ya nos pasamos: no hace falta la matriz.
  if (Math.abs(a.length - b.length) > max) return max + 1;
  if (a.length === 0) return b.length <= max ? b.length : max + 1;
  if (b.length === 0) return a.length <= max ? a.length : max + 1;

  // Tres filas rotativas: la anterior a la anterior hace falta para el intercambio.
  const width = b.length + 1;
  let twoBack = new Array<number>(width);
  let previous = new Array<number>(width);
  let current = new Array<number>(width);

  for (let j = 0; j < width; j++) previous[j] = j;

  for (let i = 1; i <= a.length; i++) {
    current[0] = i;
    let rowBest = current[0]!;

    for (let j = 1; j <= width - 1; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;

      let value = Math.min(
        previous[j]! + 1, // borrar
        current[j - 1]! + 1, // insertar
        previous[j - 1]! + cost, // sustituir
      );

      // Intercambio de dos letras contiguas: "ne" ↔ "en".
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        value = Math.min(value, twoBack[j - 2]! + 1);
      }

      current[j] = value;
      if (value < rowBest) rowBest = value;
    }

    // Toda la fila ya supera el tope: lo que falta solo puede empeorar.
    if (rowBest > max) return max + 1;

    const recycled = twoBack;
    twoBack = previous;
    previous = current;
    current = recycled;
  }

  const distance = previous[width - 1]!;
  return distance <= max ? distance : max + 1;
}
