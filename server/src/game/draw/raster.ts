import { DRAW_BRUSH_SIZES, DRAW_CANVAS } from '@flagazo/shared';
import type { Drawing } from '@flagazo/shared';
import { EMPTY, classOfStrokeColor } from './color';
import { FINE, FINE_SIZE } from './grid';

const SCALE = FINE.width / DRAW_CANVAS.width;
/** Ni el pincel más fino deja de pintar al menos un píxel. */
const MIN_RADIUS = 0.75;

/**
 * Pinta los trazos en la grilla fina, como clases de color.
 *
 * Es la verdad del servidor: lo que se puntúa es esto, no lo que el cliente dice
 * que dibujó. Cada segmento es una cápsula —un segmento con puntas redondas—,
 * que es exactamente lo que dibuja el canvas del navegador con `lineCap: 'round'`,
 * así lo que el jugador ve y lo que se compara coinciden.
 *
 * Los trazos se pintan en orden: el último tapa a los anteriores, y el borrador
 * vuelve a dejar el lienzo sin pintar.
 */
export function rasterize(drawing: Drawing): Uint8Array {
  const map = new Uint8Array(FINE_SIZE).fill(EMPTY);

  for (const stroke of drawing.strokes) {
    const value = stroke.tool === 'eraser' ? EMPTY : classOfStrokeColor(stroke.color);
    const radius = Math.max(MIN_RADIUS, ((DRAW_BRUSH_SIZES[stroke.size] ?? 0) / 2) * SCALE);
    const points = stroke.points;

    if (points.length === 2) {
      paintCapsule(map, points[0]! * SCALE, points[1]! * SCALE, points[0]! * SCALE, points[1]! * SCALE, radius, value);
      continue;
    }
    for (let i = 2; i < points.length; i += 2) {
      paintCapsule(
        map,
        points[i - 2]! * SCALE,
        points[i - 1]! * SCALE,
        points[i]! * SCALE,
        points[i + 1]! * SCALE,
        radius,
        value,
      );
    }
  }
  return map;
}

function paintCapsule(
  map: Uint8Array,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  radius: number,
  value: number,
) {
  const minX = Math.max(0, Math.floor(Math.min(ax, bx) - radius));
  const maxX = Math.min(FINE.width - 1, Math.ceil(Math.max(ax, bx) + radius));
  const minY = Math.max(0, Math.floor(Math.min(ay, by) - radius));
  const maxY = Math.min(FINE.height - 1, Math.ceil(Math.max(ay, by) + radius));

  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  const radiusSq = radius * radius;

  for (let y = minY; y <= maxY; y++) {
    // El centro del píxel, no su esquina.
    const py = y + 0.5;
    for (let x = minX; x <= maxX; x++) {
      const px = x + 0.5;
      let t = lengthSq === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / lengthSq;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const cx = ax + t * dx - px;
      const cy = ay + t * dy - py;
      if (cx * cx + cy * cy <= radiusSq) map[y * FINE.width + x] = value;
    }
  }
}

/**
 * Completa los huecos chicos de un relleno a mano.
 *
 * Rellenar una franja a garabatos deja huecos entre pasadas. Sin esto, esos
 * huecos contarían como "blanco" y quien pinta a mano perdería puntos contra
 * quien tiene más paciencia, que es castigar el estilo y no el conocimiento.
 *
 * Un píxel vacío se pinta si casi todo lo que lo rodea está pintado, con el
 * color que más aparece alrededor. Una franja blanca de verdad (la de Estados
 * Unidos mide 9 píxeles) tiene pintado solo el borde de la ventana y no se toca.
 */
export function fillSmallGaps(map: Uint8Array, passes = 2): Uint8Array {
  const WINDOW = 2; // ventana de 5×5
  const NEEDED = 15; // de 24 vecinos
  let current = map;

  for (let pass = 0; pass < passes; pass++) {
    const next = current.slice();
    const tally = new Uint16Array(EMPTY + 1);
    let changed = false;

    for (let y = 0; y < FINE.height; y++) {
      for (let x = 0; x < FINE.width; x++) {
        if (current[y * FINE.width + x] !== EMPTY) continue;
        tally.fill(0);
        let painted = 0;
        for (let oy = -WINDOW; oy <= WINDOW; oy++) {
          const ny = y + oy;
          if (ny < 0 || ny >= FINE.height) continue;
          for (let ox = -WINDOW; ox <= WINDOW; ox++) {
            const nx = x + ox;
            if (nx < 0 || nx >= FINE.width || (ox === 0 && oy === 0)) continue;
            const value = current[ny * FINE.width + nx]!;
            if (value !== EMPTY) {
              painted++;
              tally[value]!++;
            }
          }
        }
        if (painted < NEEDED) continue;
        let best = 0;
        for (let c = 1; c < EMPTY; c++) if (tally[c]! > tally[best]!) best = c;
        next[y * FINE.width + x] = best;
        changed = true;
      }
    }
    current = next;
    if (!changed) break;
  }
  return current;
}
