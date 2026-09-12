import { DRAW_CANVAS, clampToCanvas } from '@flagazo/shared';
import type { DrawColorId, Drawing, Stroke } from '@flagazo/shared';

/**
 * Dibujos armados por código, para los tests y la calibración del puntaje.
 *
 * Imitan cómo pinta una persona y no una computadora: las zonas se rellenan a
 * pinceladas de ida y vuelta, con temblor en los bordes y huecos entre pasadas si
 * se pide. Un puntaje que solo funcionara con rectángulos perfectos no serviría.
 */

export interface PaintStyle {
  /** Índice de grosor del pincel. */
  size?: number;
  /** Distancia entre pasadas, en unidades del lienzo. Más que el grosor deja huecos. */
  spacing?: number;
  /** Cuánto se sale o no llega al borde de la zona, en unidades del lienzo. */
  wobble?: number;
  seed?: number;
}

const W = DRAW_CANVAS.width;
const H = DRAW_CANVAS.height;

/** Generador pseudoaleatorio con semilla: los tests tienen que dar siempre lo mismo. */
export function rng(seed: number) {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return ((state >>> 0) % 10_000) / 10_000;
  };
}

/** Rellena una zona a pinceladas horizontales. `span(y)` da el tramo [x0, x1] de esa fila. */
export function fillRows(
  color: DrawColorId | string,
  top: number,
  bottom: number,
  span: (y: number) => [number, number] | null,
  style: PaintStyle = {},
): Stroke {
  const { size = 2, spacing = 24, wobble = 0, seed = 7 } = style;
  const random = rng(seed);
  const jitter = () => (random() * 2 - 1) * wobble;
  const points: number[] = [];
  let leftToRight = true;

  for (let y = top; y <= bottom; y += spacing) {
    const range = span(Math.min(bottom, y));
    if (!range) continue;
    const [x0, x1] = range;
    const row: [number, number][] = [
      [x0 + jitter(), y + jitter() * 0.3],
      [x1 + jitter(), y + jitter() * 0.3],
    ];
    if (!leftToRight) row.reverse();
    for (const [x, py] of row) points.push(...clampToCanvas(x, py));
    leftToRight = !leftToRight;
  }
  return { tool: 'brush', size, color, points };
}

export function rect(
  color: DrawColorId | string,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  style?: PaintStyle,
): Stroke {
  // El pincel grueso mide 48: arrancar medio pincel adentro para no pasarse.
  const inset = 12;
  return fillRows(color, y0 + inset, y1 - inset, () => [x0 + inset, x1 - inset], style);
}

export function ellipse(
  color: DrawColorId | string,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  style?: PaintStyle,
): Stroke {
  const inset = 10;
  return fillRows(
    color,
    cy - ry + inset,
    cy + ry - inset,
    (y) => {
      const t = (y - cy) / ry;
      if (Math.abs(t) >= 1) return null;
      const half = rx * Math.sqrt(1 - t * t) - inset;
      return half > 0 ? [cx - half, cx + half] : null;
    },
    { size: 1, spacing: 14, ...style },
  );
}

export const drawing = (...strokes: Stroke[]): Drawing => ({ strokes });

// ── Banderas de ejemplo ─────────────────────────────────────

/** Tres franjas verticales. */
export function verticalTricolor(a: string, b: string, c: string, style?: PaintStyle): Drawing {
  const third = W / 3;
  return drawing(
    rect(a, 0, 0, third, H, style),
    rect(b, third, 0, 2 * third, H, style),
    rect(c, 2 * third, 0, W, H, style),
  );
}

/** Tres franjas horizontales. */
export function horizontalTricolor(a: string, b: string, c: string, style?: PaintStyle): Drawing {
  const third = H / 3;
  return drawing(
    rect(a, 0, 0, W, third, style),
    rect(b, 0, third, W, 2 * third, style),
    rect(c, 0, 2 * third, W, H, style),
  );
}

/** Garabatos de muchos colores por todo el lienzo: lo que hace alguien que no sabe. */
export function scribble(seed = 3, strokes = 40): Drawing {
  const random = rng(seed);
  const colors = ['red', 'yellow', 'green', 'blue', 'black', 'orange', 'purple', 'lightBlue'];
  return drawing(
    ...Array.from({ length: strokes }, (_, i): Stroke => {
      const points: number[] = [];
      let x = random() * W;
      let y = random() * H;
      for (let k = 0; k < 12; k++) {
        x += (random() * 2 - 1) * 90;
        y += (random() * 2 - 1) * 70;
        points.push(...clampToCanvas(x, y));
      }
      return { tool: 'brush', size: 2, color: colors[i % colors.length]!, points };
    }),
  );
}
