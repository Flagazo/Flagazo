import type { DrawScoreBreakdown, Drawing } from '@flagazo/shared';
import { PAINT_CLASSES, SIMILARITY, SIMILAR_ORDER, WHITE } from './color';
import { COARSE, COARSE_SIZE } from './grid';
import { blurGrid, poolFine } from './pool';
import type { ColorGrid } from './pool';
import { fillSmallGaps, rasterize } from './raster';
import type { Reference } from './references';

const K = PAINT_CLASSES;

/**
 * Todos los números que deciden el puntaje de un dibujo.
 *
 * No son intuición: `scripts/calibrate-draw-scoring.ts` muestra cómo puntúan
 * dibujos típicos sobre banderas reales, y `score.test.ts` exige el orden
 * (correcta > errores chicos > orden equivocado > colores equivocados > garabato >
 * vacío). Se ajustan mirando eso.
 */
export const SCORE_TUNING = {
  /**
   * El puntaje es la ejecución (colores, distribución y forma) multiplicada por el
   * conocimiento (elementos).
   *
   * Es un producto y no una suma a propósito. Sumando, olvidarse de la hoja de
   * Canadá costaba 13 puntos de 100: la hoja ocupa poco y todo lo demás estaba bien
   * pintado. Pero sin la hoja no es Canadá. El conocimiento tiene que poder bajar
   * el puntaje entero, no restarle una parte.
   */
  execution: { colors: 0.3, layout: 0.5, shape: 0.2 },
  /** Lo que conserva la ejecución con conocimiento 0: acertar los colores algo vale. */
  knowledgeFloor: 0.25,
  /**
   * Desde dónde el conocimiento cuenta completo: un dibujo a mano nunca cubre el
   * 100 % de un elemento. Sin esto, dos factores de 0,9 multiplicados daban 81 a
   * una bandera bien hecha.
   *
   * La ejecución, en cambio, no se satura: si se saturaba, los dibujos buenos
   * quedaban todos clavados en 100 y "98 contra 96" es parte de la gracia.
   */
  knowledgeSaturation: 0.88,
  /**
   * Cuánto más importa la precisión que la cobertura (β < 1 en el F-score).
   * "Lo que dibujaste está bien pero incompleto" vale más que "cubriste todo,
   * incluido lo que no va": ayuda al disco de Japón dibujado chico y castiga más
   * a Japón todo rojo.
   */
  precisionBeta: 0.7,
  /** Cubrir la mitad de un elemento vale más que la mitad: cobertura^esto. */
  coverageCurve: 0.6,
  /** Menos tinta que esto es un lienzo vacío: 0, sin mirar nada más. */
  minInk: 0.005,
  /** Cuánto se busca el mejor encaje, en celdas (una celda es el 2,8 % del ancho). */
  maxShift: 2,
  /** Lo que cuesta cada celda de corrimiento, para que en un empate gane quedarse quieto. */
  shiftPenalty: 0.01,
  /** Las regiones que no tocan el borde pesan esto más que su tamaño: son la identidad. */
  enclosedBoost: 3,
  /**
   * Una región cuenta dibujada en proporción a lo dibujadas que están sus vecinas,
   * con saturación en este valor. El disco de Japón no existe si todo el lienzo es
   * rojo, y la cruz suiza no existe sin el rojo alrededor.
   */
  contextSaturation: 0.6,
  /**
   * Cuánto puede pesar respetar el blanco en la distribución. Tapar la cruz suiza
   * pintando encima es un error, no un detalle. Pesa el doble de la proporción de
   * blanco de la bandera, hasta este tope: en Brasil (1 % blanco) casi no cuenta.
   */
  whiteRespectMax: 0.6,
} as const;

export interface DrawingScore {
  /** 0 a 100, sin redondear. */
  score: number;
  breakdown: DrawScoreBreakdown;
}

const EMPTY_SCORE: DrawingScore = {
  score: 0,
  breakdown: { colors: 0, layout: 0, shape: 0, elements: 0 },
};

/**
 * Qué tan bien representa un dibujo a una bandera, de 0 a 100.
 *
 * Es determinista: el mismo dibujo contra la misma bandera saca siempre lo mismo.
 * En un juego donde se desempata por un punto, eso importa tanto como acertar.
 *
 * El detalle de cada paso está en `docs/DRAW_BATTLE.md`.
 */
export function scoreDrawing(drawing: Drawing, reference: Reference): DrawingScore {
  return compareGrids(gridOfDrawing(drawing), reference);
}

export function gridOfDrawing(drawing: Drawing): ColorGrid {
  return blurGrid(poolFine(fillSmallGaps(rasterize(drawing))));
}

export function compareGrids(drawn: ColorGrid, reference: Reference): DrawingScore {
  const tuning = SCORE_TUNING;
  const base = reference.grid;

  const refInk = totalInk(base, base);
  if (refInk === 0 || totalInk(drawn, base) / validCount(base) < tuning.minInk) return EMPTY_SCORE;

  // El mejor encaje dentro de un corrimiento chico: una bandera apenas corrida no
  // se castiga. Se elige por distribución, que es lo que el corrimiento cambia.
  let best = { value: -Infinity, shiftX: 0, shiftY: 0 };
  for (let shiftY = -tuning.maxShift; shiftY <= tuning.maxShift; shiftY++) {
    for (let shiftX = -tuning.maxShift; shiftX <= tuning.maxShift; shiftX++) {
      const value =
        layoutScore(shiftGrid(drawn, shiftX, shiftY), reference) -
        tuning.shiftPenalty * (Math.abs(shiftX) + Math.abs(shiftY));
      if (value > best.value) best = { value, shiftX, shiftY };
    }
  }

  const aligned = shiftGrid(drawn, best.shiftX, best.shiftY);
  const layout = layoutScore(aligned, reference);
  const shape = shapeScore(aligned, base);
  const colors = Math.max(colorsScore(drawn, base), colorsScore(drawn, reference.detailed));
  const elements = elementsScore(aligned, reference);

  const { execution } = tuning;
  const done = execution.colors * colors + execution.layout * layout + execution.shape * shape;
  const knowledge = saturate(elements, tuning.knowledgeSaturation);
  const total = done * (tuning.knowledgeFloor + (1 - tuning.knowledgeFloor) * knowledge);

  return {
    score: clamp01(total) * 100,
    breakdown: {
      colors: Math.round(colors * 100),
      layout: Math.round(layout * 100),
      shape: Math.round(shape * 100),
      elements: Math.round(knowledge * 100),
    },
  };
}

// ── Las cuatro señales ──────────────────────────────────────

/**
 * Distribución: ¿los colores están en el lugar correcto?
 *
 * Se mide sobre la tinta (todo lo que no es blanco), como un F-score:
 * - cobertura: de la tinta de la bandera, cuánta reprodujiste en su lugar;
 * - precisión: de la tinta que pusiste, cuánta está donde va.
 * Así un lienzo vacío no cobra por el blanco de Japón, y pintar de más cuesta.
 *
 * Cada celda se compara contra la bandera con y sin detalles y se queda la mejor.
 * Encima, respetar el blanco: tapar la cruz suiza es un error de verdad.
 */
function layoutScore(drawn: ColorGrid, reference: Reference): number {
  const base = reference.grid;
  const detailed = reference.detailed;
  let matched = 0;
  let drawInk = 0;
  let refInk = 0;
  let refWhite = 0;
  let keptWhite = 0;
  let cells = 0;

  for (let cell = 0; cell < COARSE_SIZE; cell++) {
    if (!base.valid[cell]) continue;
    cells++;
    const offset = cell * K;
    matched += Math.max(
      softIntersection(drawn.dist, offset, base.dist, offset, true),
      softIntersection(drawn.dist, offset, detailed.dist, offset, true),
    );
    drawInk += 1 - drawn.dist[offset + WHITE]!;
    refInk += 1 - base.dist[offset + WHITE]!;
    const white = base.dist[offset + WHITE]!;
    refWhite += white;
    keptWhite += Math.min(white, drawn.dist[offset + WHITE]!);
  }
  if (drawInk === 0 || refInk === 0) return 0;

  const ink = fScore(matched / refInk, matched / drawInk);
  const whiteWeight = Math.min(SCORE_TUNING.whiteRespectMax, (2 * refWhite) / cells);
  const whiteKept = refWhite === 0 ? 1 : keptWhite / refWhite;
  return clamp01(ink * (1 - whiteWeight + whiteWeight * whiteKept));
}

/** Forma: lo mismo que la distribución pero sin mirar el color. */
function shapeScore(drawn: ColorGrid, base: ColorGrid): number {
  let overlap = 0;
  let drawInk = 0;
  let refInk = 0;
  for (let cell = 0; cell < COARSE_SIZE; cell++) {
    if (!base.valid[cell]) continue;
    const a = 1 - drawn.dist[cell * K + WHITE]!;
    const b = 1 - base.dist[cell * K + WHITE]!;
    overlap += Math.min(a, b);
    drawInk += a;
    refInk += b;
  }
  if (drawInk === 0 || refInk === 0) return 0;
  return fScore(overlap / refInk, overlap / drawInk);
}

/**
 * Colores: ¿usó los de la bandera, en cantidad parecida?
 *
 * No mira dónde. Compara la mezcla de colores de tinta de los dos lados y la
 * multiplica por lo parecida que es la cantidad de tinta: pintar todo de rojo
 * tiene los colores de Japón, pero no en su medida.
 */
function colorsScore(drawn: ColorGrid, ref: ColorGrid): number {
  const drawnHist = new Float32Array(K);
  const refHist = new Float32Array(K);
  let drawInk = 0;
  let refInk = 0;
  for (let cell = 0; cell < COARSE_SIZE; cell++) {
    if (!ref.valid[cell]) continue;
    for (let c = 0; c < K; c++) {
      if (c === WHITE) continue;
      drawnHist[c]! += drawn.dist[cell * K + c]!;
      refHist[c]! += ref.dist[cell * K + c]!;
    }
    drawInk += 1 - drawn.dist[cell * K + WHITE]!;
    refInk += 1 - ref.dist[cell * K + WHITE]!;
  }
  if (drawInk === 0 || refInk === 0) return 0;
  for (let c = 0; c < K; c++) {
    drawnHist[c]! /= drawInk;
    refHist[c]! /= refInk;
  }
  const mix = softIntersection(drawnHist, 0, refHist, 0, true);
  const amount = Math.min(drawInk, refInk) / Math.max(drawInk, refInk);
  return clamp01(mix * Math.sqrt(amount));
}

/**
 * Elementos: ¿incluyó las piezas importantes?
 *
 * Cada región de la bandera pesa la raíz de su área, así una chica pesa más de lo
 * que ocupa, y las encerradas pesan más todavía. Y una región solo cuenta como
 * dibujada en la medida en que también lo estén sus vecinas: un elemento existe
 * porque se distingue de lo que lo rodea. Pintar todo de rojo no dibuja el disco
 * de Japón, y dejar el lienzo en blanco no dibuja la cruz suiza.
 */
function elementsScore(drawn: ColorGrid, reference: Reference): number {
  // Cobertura de una región: cuánto de ella está pintado de SU color (o de uno
  // parecido). No se compara contra la referencia suavizada: en el borde de la
  // hoja de Canadá el suavizado mezcla rojo con blanco, y un dibujo sin hoja
  // cobraba por "coincidir en el blanco" dentro de la región roja.
  const coverage = reference.regions.map((region) => {
    let sum = 0;
    for (const cell of region.cells) {
      for (let c = 0; c < K; c++) {
        const amount = drawn.dist[cell * K + c]!;
        if (amount > 0) sum += amount * SIMILARITY[c * K + region.cls]!;
      }
    }
    return Math.pow(sum / region.cells.length, SCORE_TUNING.coverageCurve);
  });

  let weighted = 0;
  let totalWeight = 0;
  reference.regions.forEach((region, index) => {
    let value = coverage[index]!;
    if (region.neighbors.length > 0) {
      const around = region.neighbors.reduce((sum, n) => sum + coverage[n]!, 0) / region.neighbors.length;
      value *= Math.min(1, around / SCORE_TUNING.contextSaturation);
    }
    const weight = Math.sqrt(region.area) * (region.enclosed ? SCORE_TUNING.enclosedBoost : 1);
    weighted += weight * value;
    totalWeight += weight;
  });
  return totalWeight === 0 ? 0 : clamp01(weighted / totalWeight);
}

// ── Comparación de celdas ───────────────────────────────────

const restA = new Float32Array(K);
const restB = new Float32Array(K);

/**
 * Cuánto coinciden dos distribuciones de color, con crédito parcial entre colores
 * parecidos.
 *
 * Primero lo idéntico (el mínimo de cada color); después lo que sobra se empareja
 * entre colores parecidos, de más a menos parecidos. Con `skipWhite` el blanco no
 * participa: es la coincidencia de tinta.
 */
function softIntersection(
  a: Float32Array,
  offsetA: number,
  b: Float32Array,
  offsetB: number,
  skipWhite: boolean,
): number {
  let exact = 0;
  let anyRest = false;
  for (let c = 0; c < K; c++) {
    if (skipWhite && c === WHITE) {
      restA[c] = 0;
      restB[c] = 0;
      continue;
    }
    const x = a[offsetA + c]!;
    const y = b[offsetB + c]!;
    const common = x < y ? x : y;
    exact += common;
    restA[c] = x - common;
    restB[c] = y - common;
    if (restA[c]! > 1e-6 || restB[c]! > 1e-6) anyRest = true;
  }
  if (!anyRest) return exact;

  let partial = 0;
  for (const { a: from, b: to, value } of SIMILAR_ORDER) {
    const amount = Math.min(restA[from]!, restB[to]!);
    if (amount <= 0) continue;
    partial += amount * value;
    restA[from]! -= amount;
    restB[to]! -= amount;
  }
  return exact + partial;
}

// ── Utilidades ──────────────────────────────────────────────

/** El dibujo corrido `shiftX` celdas a la derecha y `shiftY` abajo. Lo que entra es blanco. */
function shiftGrid(grid: ColorGrid, shiftX: number, shiftY: number): ColorGrid {
  if (shiftX === 0 && shiftY === 0) return grid;
  const dist = new Float32Array(COARSE_SIZE * K);
  const valid = new Uint8Array(COARSE_SIZE).fill(1);
  for (let y = 0; y < COARSE.height; y++) {
    for (let x = 0; x < COARSE.width; x++) {
      const cell = y * COARSE.width + x;
      const sx = x - shiftX;
      const sy = y - shiftY;
      if (sx < 0 || sy < 0 || sx >= COARSE.width || sy >= COARSE.height) {
        dist[cell * K + WHITE] = 1;
        continue;
      }
      const source = sy * COARSE.width + sx;
      dist.set(grid.dist.subarray(source * K, (source + 1) * K), cell * K);
    }
  }
  return { dist, valid };
}

/** Tinta total de una grilla, contando solo las celdas que la bandera ocupa. */
function totalInk(grid: ColorGrid, ref: ColorGrid): number {
  let total = 0;
  for (let cell = 0; cell < COARSE_SIZE; cell++) {
    if (ref.valid[cell]) total += 1 - grid.dist[cell * K + WHITE]!;
  }
  return total;
}

function validCount(grid: ColorGrid): number {
  let count = 0;
  for (let cell = 0; cell < COARSE_SIZE; cell++) count += grid.valid[cell]!;
  return count;
}

/** F-score con β: β < 1 le da más peso a la precisión que a la cobertura. */
function fScore(recall: number, precision: number): number {
  const r = clamp01(recall);
  const p = clamp01(precision);
  const b2 = SCORE_TUNING.precisionBeta ** 2;
  const denominator = b2 * p + r;
  return denominator === 0 ? 0 : ((1 + b2) * p * r) / denominator;
}

const saturate = (value: number, at: number) => clamp01(value / at);
const clamp01 = (value: number) => (value < 0 ? 0 : value > 1 ? 1 : value);
