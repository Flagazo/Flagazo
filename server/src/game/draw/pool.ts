import { EMPTY, NONE, PAINT_CLASSES, WHITE } from './color';
import { CELL, COARSE, COARSE_SIZE, FINE } from './grid';

const K = PAINT_CLASSES;

/**
 * Una grilla gruesa de distribuciones de color.
 *
 * `dist[celda * K + clase]` es qué proporción de la celda tiene esa clase; cada
 * celda válida suma 1. Lo no pintado ya viene contado como blanco.
 */
export interface ColorGrid {
  dist: Float32Array;
  /** 1 si la celda cuenta. En una bandera no rectangular, las de afuera no. */
  valid: Uint8Array;
}

/**
 * Junta los píxeles finos en celdas gruesas.
 *
 * Una celda cuenta si la bandera ocupa al menos la mitad; lo que queda afuera
 * (NONE) no se reparte entre los colores de la celda.
 */
export function poolFine(fine: Uint8Array): ColorGrid {
  const dist = new Float32Array(COARSE_SIZE * K);
  const valid = new Uint8Array(COARSE_SIZE);

  for (let cy = 0; cy < COARSE.height; cy++) {
    for (let cx = 0; cx < COARSE.width; cx++) {
      const cell = cy * COARSE.width + cx;
      let counted = 0;
      for (let dy = 0; dy < CELL; dy++) {
        const row = (cy * CELL + dy) * FINE.width;
        for (let dx = 0; dx < CELL; dx++) {
          let value = fine[row + cx * CELL + dx]!;
          if (value === NONE) continue;
          if (value === EMPTY) value = WHITE;
          dist[cell * K + value]!++;
          counted++;
        }
      }
      if (counted * 2 < CELL * CELL) {
        dist.fill(0, cell * K, (cell + 1) * K);
        continue;
      }
      valid[cell] = 1;
      for (let c = 0; c < K; c++) dist[cell * K + c]! /= counted;
    }
  }
  return { dist, valid };
}

/**
 * Suaviza las distribuciones con un núcleo de 3×3 (¼ ½ ¼ en cada eje).
 *
 * Es la tolerancia fina: un borde corrido media celda comparte color con la celda
 * de al lado en vez de caer entero en la equivocada. Solo mezcla celdas válidas.
 */
export function blurGrid(grid: ColorGrid): ColorGrid {
  const weights = [0.25, 0.5, 0.25];
  const dist = new Float32Array(COARSE_SIZE * K);

  for (let cy = 0; cy < COARSE.height; cy++) {
    for (let cx = 0; cx < COARSE.width; cx++) {
      const cell = cy * COARSE.width + cx;
      if (!grid.valid[cell]) continue;
      let total = 0;
      for (let oy = -1; oy <= 1; oy++) {
        const ny = cy + oy;
        if (ny < 0 || ny >= COARSE.height) continue;
        for (let ox = -1; ox <= 1; ox++) {
          const nx = cx + ox;
          if (nx < 0 || nx >= COARSE.width) continue;
          const neighbor = ny * COARSE.width + nx;
          if (!grid.valid[neighbor]) continue;
          const weight = weights[oy + 1]! * weights[ox + 1]!;
          total += weight;
          for (let c = 0; c < K; c++) {
            dist[cell * K + c]! += weight * grid.dist[neighbor * K + c]!;
          }
        }
      }
      for (let c = 0; c < K; c++) dist[cell * K + c]! /= total;
    }
  }
  return { dist, valid: grid.valid };
}

/** Cuánta tinta (todo lo que no es blanco) tiene una celda. */
export function inkOf(grid: ColorGrid, cell: number): number {
  return grid.valid[cell] ? 1 - grid.dist[cell * K + WHITE]! : 0;
}
