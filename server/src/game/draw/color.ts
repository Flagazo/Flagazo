import { CUSTOM_COLOR_PATTERN, DRAW_PALETTE } from '@flagazo/shared';
import type { DrawColorId } from '@flagazo/shared';

/**
 * Clases de color de Draw Battle.
 *
 * Tanto el dibujo como la bandera se leen como "qué color con nombre hay en cada
 * lugar", no como píxeles. Así un rojo apenas más oscuro deja de ser un error: el
 * jugador eligió "rojo", y la bandera también es "roja".
 *
 * Las clases 0–14 son la paleta, en su orden. Hay dos más que no son colores:
 * - EMPTY: lienzo sin pintar. Para comparar cuenta como blanco, como en papel.
 * - NONE: la bandera no ocupa ese lugar (Nepal no es rectangular). No cuenta.
 */
export const PAINT_CLASSES = DRAW_PALETTE.length;
export const EMPTY = PAINT_CLASSES;
export const NONE = PAINT_CLASSES + 1;

const indexOf = (id: DrawColorId): number => DRAW_PALETTE.findIndex((color) => color.id === id);
export const WHITE = indexOf('white');

/**
 * Penalización a priori, en unidades de ΔE, para colores que casi no aparecen en
 * banderas.
 *
 * Sin esto el azul del globo de Brasil (#3E4095) cae en violeta: en números está
 * apenas más cerca. Pero ninguna persona lo pinta de violeta. Medido sobre las
 * banderas reales: con estas penalizaciones Brasil, Sudáfrica e India dan azul.
 */
const PRIORS: Partial<Record<DrawColorId, number>> = {
  purple: 14,
  pink: 14,
  gray: 10,
  brown: 8,
};

/**
 * Cuánto se parecen dos colores a efectos de puntuar, de 0 a 1.
 *
 * Confundir azul con azul marino no es como confundir azul con amarillo. Los
 * pares que no están acá valen 0. La tabla es simétrica.
 */
const SIMILAR_PAIRS: [DrawColorId, DrawColorId, number][] = [
  // Casi iguales a propósito: Wikimedia usa azul marino para Francia y verde
  // oscuro para México, pero cualquiera los pinta de "azul" y de "verde".
  ['blue', 'navy', 0.9],
  ['green', 'darkGreen', 0.9],
  ['blue', 'lightBlue', 0.55],
  ['navy', 'lightBlue', 0.3],
  ['blue', 'purple', 0.35],
  ['navy', 'purple', 0.3],
  ['navy', 'black', 0.2],
  // Más estricto: el bordó de Qatar o Letonia sí es lo que las distingue.
  ['red', 'maroon', 0.65],
  ['red', 'orange', 0.3],
  ['red', 'pink', 0.3],
  ['maroon', 'brown', 0.4],
  ['maroon', 'purple', 0.2],
  ['orange', 'yellow', 0.35],
  ['orange', 'brown', 0.25],
  ['pink', 'purple', 0.3],
  ['gray', 'white', 0.3],
  ['gray', 'black', 0.35],
];

/** SIMILARITY[a * PAINT_CLASSES + b] */
export const SIMILARITY = new Float32Array(PAINT_CLASSES * PAINT_CLASSES);
for (let i = 0; i < PAINT_CLASSES; i++) SIMILARITY[i * PAINT_CLASSES + i] = 1;
for (const [a, b, value] of SIMILAR_PAIRS) {
  SIMILARITY[indexOf(a) * PAINT_CLASSES + indexOf(b)] = value;
  SIMILARITY[indexOf(b) * PAINT_CLASSES + indexOf(a)] = value;
}

/**
 * Los pares de clases distintas que se parecen, de más a menos parecidos.
 * La comparación los recorre en este orden para repartir el crédito parcial.
 */
export const SIMILAR_ORDER: { a: number; b: number; value: number }[] = [];
for (let a = 0; a < PAINT_CLASSES; a++) {
  for (let b = 0; b < PAINT_CLASSES; b++) {
    const value = SIMILARITY[a * PAINT_CLASSES + b]!;
    if (a !== b && value > 0) SIMILAR_ORDER.push({ a, b, value });
  }
}
SIMILAR_ORDER.sort((x, y) => y.value - x.value);

// ── De RGB a clase ──────────────────────────────────────────

export type Rgb = [number, number, number];

export function hexToRgb(hex: string): Rgb {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as Rgb;
}

/** CIELAB (D65). La distancia euclídea en Lab se parece a la diferencia que ve un ojo. */
export function rgbToLab([r, g, b]: Rgb): Rgb {
  const linear = (value: number) => {
    const v = value / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const R = linear(r);
  const G = linear(g);
  const B = linear(b);
  const x = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
  const y = R * 0.2126 + G * 0.7152 + B * 0.0722;
  const z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

const CENTERS = DRAW_PALETTE.map((color) => ({
  lab: rgbToLab(hexToRgb(color.hex)),
  prior: PRIORS[color.id] ?? 0,
}));

/** La clase de la paleta más cercana a un color cualquiera. */
export function classifyRgb(rgb: Rgb): number {
  const [L, A, B] = rgbToLab(rgb);
  let best = 0;
  let bestDistance = Infinity;
  CENTERS.forEach((center, index) => {
    const distance =
      Math.hypot(L - center.lab[0], A - center.lab[1], B - center.lab[2]) + center.prior;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = index;
    }
  });
  return best;
}

const PALETTE_CLASS = new Map(DRAW_PALETTE.map((color, index) => [color.id as string, index]));
const customCache = new Map<string, number>();

/**
 * La clase del color de un trazo.
 * Uno de la paleta es su clase directamente; uno personalizado va al más cercano.
 */
export function classOfStrokeColor(color: string): number {
  const direct = PALETTE_CLASS.get(color);
  if (direct !== undefined) return direct;
  if (!CUSTOM_COLOR_PATTERN.test(color)) return EMPTY;
  const key = color.toLowerCase();
  let cls = customCache.get(key);
  if (cls === undefined) {
    cls = classifyRgb(hexToRgb(key));
    customCache.set(key, cls);
  }
  return cls;
}

/**
 * Huella de todo lo que decide cómo se clasifica un color.
 *
 * Va escrita en el archivo de referencias. Si alguien cambia un color o una
 * penalización sin regenerarlas, las banderas quedarían leídas con la paleta
 * vieja y comparadas con la nueva: un test compara las dos huellas y avisa.
 */
export function paletteFingerprint(): string {
  const source = JSON.stringify({ palette: DRAW_PALETTE, priors: PRIORS });
  let hash = 2166136261;
  for (let i = 0; i < source.length; i++) {
    hash ^= source.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
