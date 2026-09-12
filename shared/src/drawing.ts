/**
 * El formato de un dibujo de Draw Battle.
 *
 * Un dibujo es una lista de trazos, nunca una imagen. Eso es lo que hace que no
 * se pueda subir la bandera: no existe ningún camino por el que viajen píxeles.
 * El servidor recibe trazos, los valida con esta misma función y los pinta él.
 *
 * Formato de cable, pensado para pesar poco:
 *
 *     1|<trazo>;<trazo>;…
 *     <trazo> = <herramienta><grosor><color>,<puntos en base64url>
 *
 * - herramienta: `b` pincel, `e` borrador
 * - grosor: índice en `DRAW_BRUSH_SIZES`
 * - color: índice de la paleta en base 36, `#rrggbb` si es personalizado, `-` en el borrador
 * - puntos: el primero como dos enteros de 16 bits; cada uno de los siguientes como
 *   la diferencia con el anterior en dos bytes con signo, o, si el salto no entra,
 *   un byte 0x80 de escape y dos enteros de 16 bits.
 */
import {
  CUSTOM_COLOR_PATTERN,
  DRAW_BRUSH_SIZES,
  DRAW_CANVAS,
  DRAW_LIMITS,
  DRAW_PALETTE,
} from './draw';
import type { DrawColorId } from './draw';

export type DrawTool = 'brush' | 'eraser';

export interface Stroke {
  tool: DrawTool;
  /** Índice en `DRAW_BRUSH_SIZES`. */
  size: number;
  /** Id de la paleta o `#rrggbb`. En el borrador no se usa. */
  color: DrawColorId | string;
  /** Coordenadas enteras dentro del lienzo, planas: x0, y0, x1, y1, … */
  points: number[];
}

export interface Drawing {
  strokes: Stroke[];
}

export type DrawingError =
  | 'NOT_A_STRING'
  | 'TOO_LONG'
  | 'BAD_VERSION'
  | 'BAD_STROKE'
  | 'BAD_COLOR'
  | 'BAD_SIZE'
  | 'BAD_POINTS'
  | 'OUT_OF_CANVAS'
  | 'TOO_MANY_STROKES'
  | 'TOO_MANY_POINTS';

export type DrawingResult = { ok: true; drawing: Drawing } | { ok: false; error: DrawingError };

const VERSION = '1';
const ESCAPE = 0x80;
const PALETTE_INDEX = new Map(DRAW_PALETTE.map((color, index) => [color.id as string, index]));

// ── Codificar ───────────────────────────────────────────────

export function encodeDrawing(drawing: Drawing): string {
  return `${VERSION}|${drawing.strokes.map(encodeStroke).join(';')}`;
}

function encodeStroke(stroke: Stroke): string {
  const tool = stroke.tool === 'eraser' ? 'e' : 'b';
  let color = '-';
  if (stroke.tool === 'brush') {
    const index = PALETTE_INDEX.get(stroke.color);
    color = index !== undefined ? index.toString(36) : stroke.color.toLowerCase();
  }
  return `${tool}${stroke.size}${color},${base64UrlEncode(packPoints(stroke.points))}`;
}

function packPoints(points: readonly number[]): Uint8Array {
  // Peor caso: 4 bytes el primero y 5 cada uno de los demás.
  const bytes = new Uint8Array(4 + Math.max(0, points.length / 2 - 1) * 5);
  const view = new DataView(bytes.buffer);
  let offset = 0;
  let prevX = 0;
  let prevY = 0;

  for (let i = 0; i < points.length; i += 2) {
    const x = points[i]!;
    const y = points[i + 1]!;
    if (i === 0) {
      view.setUint16(offset, x);
      view.setUint16(offset + 2, y);
      offset += 4;
    } else {
      const dx = x - prevX;
      const dy = y - prevY;
      if (dx >= -127 && dx <= 127 && dy >= -127 && dy <= 127) {
        view.setInt8(offset, dx);
        view.setInt8(offset + 1, dy);
        offset += 2;
      } else {
        view.setUint8(offset, ESCAPE);
        view.setInt16(offset + 1, dx);
        view.setInt16(offset + 3, dy);
        offset += 5;
      }
    }
    prevX = x;
    prevY = y;
  }
  return bytes.subarray(0, offset);
}

// ── Decodificar y validar ───────────────────────────────────

/**
 * Lee un dibujo que vino de afuera, validando todo.
 *
 * Es la única puerta de entrada de un dibujo al servidor: lo que pase acá es un
 * dibujo bien formado, dentro del lienzo y dentro de los topes. Cualquier otra
 * cosa se rechaza entera, no se "arregla".
 */
export function decodeDrawing(raw: unknown): DrawingResult {
  if (typeof raw !== 'string') return fail('NOT_A_STRING');
  if (raw.length > DRAW_LIMITS.maxEncodedLength) return fail('TOO_LONG');
  if (!raw.startsWith(`${VERSION}|`)) return fail('BAD_VERSION');

  const body = raw.slice(VERSION.length + 1);
  if (body === '') return { ok: true, drawing: { strokes: [] } };

  const parts = body.split(';');
  if (parts.length > DRAW_LIMITS.maxStrokes) return fail('TOO_MANY_STROKES');

  const strokes: Stroke[] = [];
  let totalPoints = 0;
  for (const part of parts) {
    const result = decodeStroke(part);
    if ('error' in result) return fail(result.error);
    totalPoints += result.stroke.points.length / 2;
    if (totalPoints > DRAW_LIMITS.maxPoints) return fail('TOO_MANY_POINTS');
    strokes.push(result.stroke);
  }
  return { ok: true, drawing: { strokes } };
}

function decodeStroke(part: string): { stroke: Stroke } | { error: DrawingError } {
  const comma = part.indexOf(',');
  if (comma < 3) return { error: 'BAD_STROKE' };

  const toolChar = part[0];
  if (toolChar !== 'b' && toolChar !== 'e') return { error: 'BAD_STROKE' };
  const tool: DrawTool = toolChar === 'e' ? 'eraser' : 'brush';

  const size = Number(part[1]);
  if (!Number.isInteger(size) || size < 0 || size >= DRAW_BRUSH_SIZES.length) {
    return { error: 'BAD_SIZE' };
  }

  const colorCode = part.slice(2, comma);
  let color: string;
  if (tool === 'eraser') {
    if (colorCode !== '-') return { error: 'BAD_COLOR' };
    color = '-';
  } else if (colorCode.startsWith('#')) {
    if (!CUSTOM_COLOR_PATTERN.test(colorCode)) return { error: 'BAD_COLOR' };
    color = colorCode.toLowerCase();
  } else {
    if (!/^[0-9a-z]$/.test(colorCode)) return { error: 'BAD_COLOR' };
    const paletteColor = DRAW_PALETTE[parseInt(colorCode, 36)];
    if (!paletteColor) return { error: 'BAD_COLOR' };
    color = paletteColor.id;
  }

  const bytes = base64UrlDecode(part.slice(comma + 1));
  if (!bytes) return { error: 'BAD_POINTS' };
  const points = unpackPoints(bytes);
  if ('error' in points) return points;

  return { stroke: { tool, size, color, points: points.points } };
}

function unpackPoints(bytes: Uint8Array): { points: number[] } | { error: DrawingError } {
  if (bytes.length < 4) return { error: 'BAD_POINTS' };
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const points: number[] = [];

  let x = view.getUint16(0);
  let y = view.getUint16(2);
  let offset = 4;

  for (;;) {
    if (x > DRAW_CANVAS.width || y > DRAW_CANVAS.height || x < 0 || y < 0) {
      return { error: 'OUT_OF_CANVAS' };
    }
    points.push(x, y);
    if (points.length / 2 > DRAW_LIMITS.maxPointsPerStroke) return { error: 'TOO_MANY_POINTS' };
    if (offset === bytes.length) break;

    if (bytes[offset] === ESCAPE) {
      if (offset + 5 > bytes.length) return { error: 'BAD_POINTS' };
      x += view.getInt16(offset + 1);
      y += view.getInt16(offset + 3);
      offset += 5;
    } else {
      if (offset + 2 > bytes.length) return { error: 'BAD_POINTS' };
      x += view.getInt8(offset);
      y += view.getInt8(offset + 1);
      offset += 2;
    }
  }
  return { points };
}

const fail = (error: DrawingError): DrawingResult => ({ ok: false, error });

// ── Utilidades para quien dibuja ────────────────────────────

/** Lleva un punto cualquiera al lienzo: entero y adentro. */
export function clampToCanvas(x: number, y: number): [number, number] {
  return [
    Math.min(DRAW_CANVAS.width, Math.max(0, Math.round(x))),
    Math.min(DRAW_CANVAS.height, Math.max(0, Math.round(y))),
  ];
}

/**
 * Simplifica un trazo sin cambiar su forma a la vista (Ramer–Douglas–Peucker).
 *
 * El puntero entrega decenas de puntos por segundo, casi todos alineados. Sacar
 * los que no aportan deja el dibujo en una fracción del tamaño y no se nota.
 * La tolerancia está en unidades del lienzo: 1 es menos de un píxel en pantalla.
 */
export function simplifyPoints(points: readonly number[], tolerance = 1): number[] {
  const count = points.length / 2;
  if (count <= 2) return [...points];

  const keep = new Uint8Array(count);
  keep[0] = 1;
  keep[count - 1] = 1;
  const stack: [number, number][] = [[0, count - 1]];
  const toleranceSq = tolerance * tolerance;

  while (stack.length > 0) {
    const [first, last] = stack.pop()!;
    const ax = points[first * 2]!;
    const ay = points[first * 2 + 1]!;
    const bx = points[last * 2]!;
    const by = points[last * 2 + 1]!;
    let farthest = -1;
    let farthestSq = toleranceSq;

    for (let i = first + 1; i < last; i++) {
      const distanceSq = segmentDistanceSq(points[i * 2]!, points[i * 2 + 1]!, ax, ay, bx, by);
      if (distanceSq > farthestSq) {
        farthestSq = distanceSq;
        farthest = i;
      }
    }
    if (farthest !== -1) {
      keep[farthest] = 1;
      stack.push([first, farthest], [farthest, last]);
    }
  }

  const result: number[] = [];
  for (let i = 0; i < count; i++) {
    if (keep[i]) result.push(points[i * 2]!, points[i * 2 + 1]!);
  }
  return result;
}

function segmentDistanceSq(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSq));
  const cx = ax + t * dx - px;
  const cy = ay + t * dy - py;
  return cx * cx + cy * cy;
}

/** Cuántos puntos tiene el dibujo, para avisar antes de pasar el tope. */
export function countPoints(drawing: Drawing): number {
  return drawing.strokes.reduce((total, stroke) => total + stroke.points.length / 2, 0);
}

/**
 * El hex con el que se pinta un trazo en pantalla.
 * Un color de la paleta usa su hex; uno personalizado, el suyo.
 */
export function strokeHex(stroke: Stroke): string {
  const paletteColor = DRAW_PALETTE.find((color) => color.id === stroke.color);
  return paletteColor?.hex ?? stroke.color;
}

// ── base64url ───────────────────────────────────────────────
// Propio en vez de btoa/Buffer: esto corre igual en el navegador y en Node, y
// btoa trabaja con strings binarios que obligan a convertir byte por byte igual.

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const LOOKUP = new Int16Array(128).fill(-1);
for (let i = 0; i < ALPHABET.length; i++) LOOKUP[ALPHABET.charCodeAt(i)] = i;

export function base64UrlEncode(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!;
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    out += ALPHABET[a >> 2]!;
    out += ALPHABET[((a & 3) << 4) | ((b ?? 0) >> 4)]!;
    if (b !== undefined) out += ALPHABET[((b & 15) << 2) | ((c ?? 0) >> 6)]!;
    if (c !== undefined) out += ALPHABET[c & 63]!;
  }
  return out;
}

/** null si no es base64url válido. */
export function base64UrlDecode(text: string): Uint8Array | null {
  if (text.length % 4 === 1) return null;
  const bytes = new Uint8Array(Math.floor((text.length * 3) / 4));
  let offset = 0;
  for (let i = 0; i < text.length; i += 4) {
    const values = [0, 1, 2, 3].map((k) => {
      const code = text.charCodeAt(i + k);
      return Number.isNaN(code) ? -2 : code < 128 ? LOOKUP[code]! : -1;
    });
    if (values.includes(-1)) return null;
    const [a, b, c, d] = values as [number, number, number, number];
    if (a < 0 || b < 0) return null;
    bytes[offset++] = (a << 2) | (b >> 4);
    if (c >= 0) bytes[offset++] = ((b & 15) << 4) | (c >> 2);
    if (d >= 0) bytes[offset++] = ((c & 3) << 6) | d;
  }
  return bytes.subarray(0, offset);
}
