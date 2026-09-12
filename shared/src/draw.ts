/**
 * Reglas de Draw Battle que cliente y servidor leen igual.
 *
 * El diseño completo, y el porqué de cada número, está en `docs/DRAW_BATTLE.md`.
 * Acá viven solo los valores: cómo se compara un dibujo lo decide el servidor, en
 * `server/src/game/draw/`.
 */
import type { DrawPrompt } from './types';

// ── Configuración de la partida ─────────────────────────────

export const DRAW_ROUNDS_OPTIONS: readonly number[] = [5, 10, 15, 20];
export const DRAW_SECONDS_OPTIONS: readonly number[] = [30, 45, 60, 90];
export const DRAW_PROMPT_OPTIONS: readonly DrawPrompt[] = ['name', 'flag'];

// ── Ritmo ───────────────────────────────────────────────────

/**
 * Margen después del tiempo para aceptar los dibujos que están en viaje.
 *
 * Cada cliente manda el suyo cuando su reloj llega a cero, y eso tarda en llegar.
 * Sin este margen, quien tiene más ping perdería el último segundo de trazos.
 */
export const DRAW_GRACE_MS = 1_500;

/**
 * Cuánto dura la revelación: aparecen los dibujos, después la bandera real,
 * después los puntajes y el ganador. Los tiempos internos los usa el cliente.
 */
export const DRAW_REVEAL_MS = 11_000;
export const DRAW_REVEAL_TIMING = {
  /** Cada dibujo aparece un poco después del anterior. */
  drawingStaggerMs: 140,
  /** Cuándo se destapa la bandera real. */
  flagAtMs: 2_000,
  /** Cuándo aparecen los puntajes. */
  scoresAtMs: 3_200,
  /** Cuándo se marca al ganador. */
  winnerAtMs: 4_400,
} as const;

/**
 * En el modo "solo la bandera", cuánto se ve antes de taparse.
 *
 * Mostrarla todo el tiempo convertiría el juego en copiar lo que ves. Tres
 * segundos alcanzan para mirarla bien y obligan a dibujarla de memoria.
 */
export const DRAW_FLAG_PREVIEW_MS = 3_000;

/** Cada cuánto el cliente manda un borrador, si cambió. Solo para reconexiones. */
export const DRAW_DRAFT_INTERVAL_MS = 4_000;

// ── Lienzo ──────────────────────────────────────────────────

/**
 * Espacio de coordenadas del dibujo, siempre 3:2.
 *
 * Es lógico: el lienzo se ve del tamaño que entre en la pantalla, pero los
 * puntos se guardan en este espacio. Así un dibujo hecho en un celular y otro
 * en un monitor se comparan igual.
 */
export const DRAW_CANVAS = { width: 600, height: 400 } as const;

/** Grosores del pincel en unidades del lienzo: fino, medio y grueso. */
export const DRAW_BRUSH_SIZES: readonly number[] = [8, 22, 48];
export const DRAW_DEFAULT_BRUSH = 1;

/**
 * Topes del dibujo. El servidor rechaza lo que se pase; el cliente avisa antes.
 *
 * Una bandera rellenada a mano ronda los 1.000–3.000 puntos después de
 * simplificar. Los topes están lejos de eso: existen para que nadie pueda mandar
 * megabytes, no para limitar a quien dibuja con detalle.
 */
export const DRAW_LIMITS = {
  maxStrokes: 800,
  maxPoints: 12_000,
  maxPointsPerStroke: 4_000,
  /** Largo máximo del dibujo codificado, en caracteres. */
  maxEncodedLength: 48_000,
} as const;

// ── Paleta ──────────────────────────────────────────────────

export type DrawColorId =
  | 'red'
  | 'maroon'
  | 'orange'
  | 'yellow'
  | 'green'
  | 'darkGreen'
  | 'lightBlue'
  | 'blue'
  | 'navy'
  | 'purple'
  | 'pink'
  | 'brown'
  | 'white'
  | 'gray'
  | 'black';

export interface DrawColor {
  id: DrawColorId;
  hex: string;
}

/**
 * Los colores del juego.
 *
 * Son a la vez la paleta del jugador y las clases con las que el servidor lee las
 * banderas: el "azul" que elegís es exactamente el "azul" contra el que se compara.
 * Por eso no alcanzan los once colores básicos: las banderas usan bordó (Qatar),
 * verde oscuro (Arabia Saudita), azul marino (Reino Unido) y marrón (escudos).
 *
 * El orden es el de la paleta en pantalla, agrupado por familia. Cambiar un color
 * obliga a regenerar las referencias (`npm run build:flag-refs`): un test lo exige.
 */
export const DRAW_PALETTE: readonly DrawColor[] = [
  { id: 'red', hex: '#D62718' },
  { id: 'maroon', hex: '#8A1538' },
  { id: 'orange', hex: '#FF8C1A' },
  { id: 'yellow', hex: '#FFD21F' },
  { id: 'green', hex: '#1E9E3E' },
  { id: 'darkGreen', hex: '#0B5A2A' },
  { id: 'lightBlue', hex: '#6CB4EE' },
  { id: 'blue', hex: '#1F5FC4' },
  { id: 'navy', hex: '#1B2A5E' },
  { id: 'purple', hex: '#7B3FA0' },
  { id: 'pink', hex: '#F28AB8' },
  { id: 'brown', hex: '#7A4A1E' },
  { id: 'white', hex: '#FFFFFF' },
  { id: 'gray', hex: '#9AA0A6' },
  { id: 'black', hex: '#111111' },
];

/** El color con el que arranca el pincel. */
export const DRAW_DEFAULT_COLOR: DrawColorId = 'red';

/** Un color personalizado se escribe así: `#rrggbb`. */
export const CUSTOM_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

// ── Puntuación de la partida ────────────────────────────────

/**
 * Puntos al marcador por puesto en cada ronda.
 *
 * `[1]` es "el primero se lleva un punto y nada más". Para premiar el podio
 * alcanza con `[3, 2, 1]`: los empatados comparten el puesto y los puntos.
 */
export const DRAW_SCORING = {
  placePoints: [1] as readonly number[],
  /** Con menos que esto no se gana la ronda: un lienzo vacío no es un dibujo. */
  minWinningScore: 1,
} as const;
