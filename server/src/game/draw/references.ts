import data from '../../data/flagReferences.json';
import { NONE, PAINT_CLASSES, WHITE } from './color';
import { COARSE, COARSE_SIZE, FINE, FINE_SIZE, decodeClassMap } from './grid';
import { blurGrid, poolFine } from './pool';
import type { ColorGrid } from './pool';

const K = PAINT_CLASSES;

/**
 * Regiones con menos celdas que esto son detalles: estrellas sueltas, letras,
 * las partes finas de un escudo. Se funden con lo que las rodea y no se exigen.
 * 5 celdas son el 0,6 % de la bandera.
 */
const MIN_REGION_CELLS = 5;

/** Una región de la bandera: celdas contiguas de un mismo color. */
export interface Region {
  cls: number;
  cells: number[];
  /** Proporción de la bandera que ocupa. */
  area: number;
  /**
   * No toca el borde. El disco de Japón, la hoja de Canadá, la cruz suiza: lo
   * que identifica a la bandera y por eso pesa más que su tamaño.
   */
  enclosed: boolean;
  /** Índices de las regiones vecinas. */
  neighbors: number[];
}

export interface Reference {
  countryId: string;
  /**
   * La bandera sin detalles diminutos (estrellas sueltas, letras, trazos finos de
   * un escudo), suavizada. Es contra lo que se mide la estructura: no dibujar las
   * 50 estrellas de Estados Unidos no puede costar puntos.
   */
  grid: ColorGrid;
  /**
   * La bandera con todos sus detalles. Se compara también contra esta y se queda
   * la mejor de las dos: quien sí dibuja las estrellas tampoco pierde.
   */
  detailed: ColorGrid;
  regions: Region[];
}

/**
 * Manchas de un color con menos píxeles finos que esto son detalles. 40 píxeles
 * son el 0,2 % de la bandera: una estrella de Estados Unidos mide unos 12.
 */
const DETAIL_PIXELS = 40;

interface ReferenceFile {
  fingerprint: string;
  width: number;
  height: number;
  flags: Record<string, string>;
}

const file = data as ReferenceFile;

/** La huella de la paleta con la que se generaron. La compara un test. */
export const REFERENCES_FINGERPRINT = file.fingerprint;

const cache = new Map<string, Reference | null>();

/** La referencia de un país, o null si no hay. Se arma una vez y queda en memoria. */
export function getReference(countryId: string): Reference | null {
  const cached = cache.get(countryId);
  if (cached !== undefined) return cached;

  const encoded = file.flags[countryId];
  const fine = encoded ? decodeClassMap(encoded) : null;
  const reference = fine ? buildReference(countryId, fine) : null;
  cache.set(countryId, reference);
  return reference;
}

export function hasReference(countryId: string): boolean {
  return countryId in file.flags;
}

function buildReference(countryId: string, fine: Uint8Array): Reference {
  const base = poolFine(suppressDetails(fine));
  return {
    countryId,
    grid: blurGrid(base),
    detailed: blurGrid(poolFine(fine)),
    regions: findRegions(base),
  };
}

/**
 * Borra los detalles diminutos de una bandera fina: cada mancha de un color con
 * menos de `DETAIL_PIXELS` píxeles toma el color que más la rodea.
 */
export function suppressDetails(fine: Uint8Array): Uint8Array {
  const map = fine.slice();
  const seen = new Uint8Array(FINE_SIZE);
  const stack: number[] = [];
  const blob: number[] = [];
  const around = new Uint16Array(NONE + 1);

  for (let start = 0; start < FINE_SIZE; start++) {
    if (seen[start] || map[start] === NONE) continue;
    const cls = map[start]!;
    blob.length = 0;
    around.fill(0);
    stack.push(start);
    seen[start] = 1;

    while (stack.length > 0) {
      const pixel = stack.pop()!;
      blob.push(pixel);
      const x = pixel % FINE.width;
      const neighbors = [
        x > 0 ? pixel - 1 : -1,
        x < FINE.width - 1 ? pixel + 1 : -1,
        pixel - FINE.width,
        pixel + FINE.width,
      ];
      for (const next of neighbors) {
        if (next < 0 || next >= FINE_SIZE) continue;
        const value = map[next]!;
        if (value === cls) {
          if (!seen[next]) {
            seen[next] = 1;
            stack.push(next);
          }
        } else if (value !== NONE) {
          around[value]!++;
        }
      }
    }

    if (blob.length >= DETAIL_PIXELS) continue;
    let heir = -1;
    for (let c = 0; c < NONE; c++) if (around[c]! > 0 && (heir < 0 || around[c]! > around[heir]!)) heir = c;
    if (heir >= 0) for (const pixel of blob) map[pixel] = heir;
  }
  return map;
}

// ── Regiones ────────────────────────────────────────────────

/**
 * Parte la bandera en regiones de un mismo color.
 *
 * Se trabaja sobre la versión sin suavizar, con el color que más ocupa cada
 * celda. Las regiones diminutas se funden con su vecina más grande y se vuelve a
 * partir, hasta que no quede ninguna: así las 50 estrellas de Estados Unidos
 * pasan a ser parte del cantón azul en vez de 50 elementos obligatorios.
 */
export function findRegions(grid: ColorGrid): Region[] {
  const labels = new Int16Array(COARSE_SIZE).fill(-1);
  for (let cell = 0; cell < COARSE_SIZE; cell++) {
    if (!grid.valid[cell]) continue;
    let best = WHITE;
    for (let c = 0; c < K; c++) {
      if (grid.dist[cell * K + c]! > grid.dist[cell * K + best]!) best = c;
    }
    labels[cell] = best;
  }

  for (let attempt = 0; attempt < 6; attempt++) {
    const regions = connectedRegions(labels);
    const tiny = regions.filter((region) => region.cells.length < MIN_REGION_CELLS);
    if (tiny.length === 0 || tiny.length === regions.length) return describe(regions, grid);

    for (const region of tiny) {
      const heir = largestNeighbor(region, regions);
      if (heir) for (const cell of region.cells) labels[cell] = heir.cls;
    }
  }
  return describe(connectedRegions(labels), grid);
}

interface RawRegion {
  cls: number;
  cells: number[];
  neighborIds: Set<number>;
}

function connectedRegions(labels: Int16Array): RawRegion[] {
  const owner = new Int32Array(COARSE_SIZE).fill(-1);
  const regions: RawRegion[] = [];

  for (let start = 0; start < COARSE_SIZE; start++) {
    if (labels[start]! < 0 || owner[start]! >= 0) continue;
    const id = regions.length;
    const cls = labels[start]!;
    const region: RawRegion = { cls, cells: [], neighborIds: new Set() };
    const stack = [start];
    owner[start] = id;

    while (stack.length > 0) {
      const cell = stack.pop()!;
      region.cells.push(cell);
      for (const next of neighborsOf(cell)) {
        if (labels[next] === cls && owner[next]! < 0) {
          owner[next] = id;
          stack.push(next);
        }
      }
    }
    regions.push(region);
  }

  // Vecindad entre regiones, ya con todos los dueños asignados.
  regions.forEach((region, id) => {
    for (const cell of region.cells) {
      for (const next of neighborsOf(cell)) {
        const other = owner[next]!;
        if (other >= 0 && other !== id) region.neighborIds.add(other);
      }
    }
  });
  return regions;
}

function largestNeighbor(region: RawRegion, regions: RawRegion[]): RawRegion | null {
  let best: RawRegion | null = null;
  for (const id of region.neighborIds) {
    const candidate = regions[id]!;
    if (!best || candidate.cells.length > best.cells.length) best = candidate;
  }
  return best;
}

function describe(regions: RawRegion[], grid: ColorGrid): Region[] {
  let validCells = 0;
  for (let cell = 0; cell < COARSE_SIZE; cell++) validCells += grid.valid[cell]!;

  return regions.map((region) => ({
    cls: region.cls,
    cells: region.cells,
    area: region.cells.length / validCells,
    enclosed: region.cells.every((cell) => !touchesEdge(cell, grid)),
    neighbors: [...region.neighborIds],
  }));
}

/** Toca el borde de la bandera: el del lienzo, o una celda que queda afuera. */
function touchesEdge(cell: number, grid: ColorGrid): boolean {
  const x = cell % COARSE.width;
  const y = Math.floor(cell / COARSE.width);
  if (x === 0 || y === 0 || x === COARSE.width - 1 || y === COARSE.height - 1) return true;
  return neighborsOf(cell).some((next) => !grid.valid[next]);
}

function neighborsOf(cell: number): number[] {
  const x = cell % COARSE.width;
  const y = Math.floor(cell / COARSE.width);
  const result: number[] = [];
  if (x > 0) result.push(cell - 1);
  if (x < COARSE.width - 1) result.push(cell + 1);
  if (y > 0) result.push(cell - COARSE.width);
  if (y < COARSE.height - 1) result.push(cell + COARSE.width);
  return result;
}
