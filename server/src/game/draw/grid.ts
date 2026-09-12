import { base64UrlDecode, base64UrlEncode } from '@flagazo/shared';

/**
 * Las dos resoluciones de la comparación.
 *
 * - FINE: donde se pintan los trazos y se rasteriza la bandera. Un píxel fino es
 *   un poco más de 3 unidades del lienzo de 600×400.
 * - COARSE: donde se compara. Cada celda junta 5×5 píxeles finos y guarda qué
 *   proporción de cada color tiene, no un color solo. Así un borde tembloroso
 *   deja una celda 60/40 en vez de estar bien o mal.
 *
 * Las dos son 3:2, como el lienzo.
 */
export const FINE = { width: 180, height: 120 } as const;
export const CELL = 5;
export const COARSE = { width: FINE.width / CELL, height: FINE.height / CELL } as const;

export const FINE_SIZE = FINE.width * FINE.height;
export const COARSE_SIZE = COARSE.width * COARSE.height;

/**
 * Comprime un mapa de clases fino como pares (clase, largo del tramo).
 *
 * Las banderas son casi todo tramos largos de un color: una de tres franjas
 * ocupa unos pocos cientos de bytes en vez de 21.600.
 */
export function encodeClassMap(map: Uint8Array): string {
  const bytes: number[] = [];
  let i = 0;
  while (i < map.length) {
    const value = map[i]!;
    let run = 1;
    while (i + run < map.length && map[i + run] === value && run < 255) run++;
    bytes.push(value, run);
    i += run;
  }
  return base64UrlEncode(Uint8Array.from(bytes));
}

/** null si el texto no describe exactamente un mapa fino. */
export function decodeClassMap(encoded: string): Uint8Array | null {
  const bytes = base64UrlDecode(encoded);
  if (!bytes || bytes.length % 2 !== 0) return null;
  const map = new Uint8Array(FINE_SIZE);
  let offset = 0;
  for (let i = 0; i < bytes.length; i += 2) {
    const run = bytes[i + 1]!;
    if (run === 0 || offset + run > FINE_SIZE) return null;
    map.fill(bytes[i]!, offset, offset + run);
    offset += run;
  }
  return offset === FINE_SIZE ? map : null;
}
