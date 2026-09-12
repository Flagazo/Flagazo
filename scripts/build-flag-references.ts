/**
 * Genera las referencias de Draw Battle: cada bandera leída como colores con nombre.
 *
 * Por cada país rasteriza su SVG estirado a 3:2 (el lienzo del jugador), sin
 * antialiasing, clasifica cada píxel en la paleta del juego y guarda el mapa
 * comprimido en `server/src/data/flagReferences.json`.
 *
 * - Estirado a 3:2 porque el jugador dibuja la bandera ocupando el lienzo entero.
 * - Sin antialiasing porque el suavizado inventa colores en los bordes: entre una
 *   franja roja y una blanca aparecían píxeles "rosa" que la bandera no tiene.
 *
 * Se corre a mano y el resultado se commitea, como las banderas: el servidor en
 * producción no necesita ninguna librería nativa.
 *
 *     npm run build:flag-refs
 *     npm run build:flag-refs -- --preview jp,br,us   # además dibuja esas en la consola
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';
import { DRAW_PALETTE } from '../shared/src/draw';
import type { Country } from '../shared/src/types';
import dataset from '../server/src/data/countries.json';
import { NONE, classifyRgb, paletteFingerprint } from '../server/src/game/draw/color';
import { CELL, COARSE, FINE, FINE_SIZE, encodeClassMap } from '../server/src/game/draw/grid';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FLAGS_DIR = path.join(ROOT, 'server', 'flags');
const OUT_FILE = path.join(ROOT, 'server', 'src', 'data', 'flagReferences.json');

/** Letra para dibujar cada clase en la vista previa de la consola. */
const PREVIEW_CHARS = 'rmoygGcbnpkw.s#';

/**
 * Reescribe la etiqueta <svg> raíz para que se dibuje estirada al tamaño fino.
 *
 * Si el SVG no trae viewBox, se arma con su ancho y alto: sin eso, al cambiar el
 * tamaño solo se ve la esquina superior izquierda del dibujo original.
 */
function stretchSvg(svg: string): string {
  return svg.replace(/<svg\b([^>]*)>/, (_match, attrs: string) => {
    const read = (name: string): number | null => {
      const found = new RegExp(`\\s${name}="([0-9.]+)`).exec(attrs);
      return found ? parseFloat(found[1]!) : null;
    };
    let next = attrs;
    if (!/\sviewBox=/.test(next)) {
      const width = read('width');
      const height = read('height');
      if (!width || !height) throw new Error('SVG sin viewBox ni tamaño');
      next += ` viewBox="0 0 ${width} ${height}"`;
    }
    next = next.replace(/\s(width|height|preserveAspectRatio)="[^"]*"/g, '');
    return `<svg${next} width="${FINE.width}" height="${FINE.height}" preserveAspectRatio="none">`;
  });
}

function classMapOf(countryId: string): Uint8Array {
  const svg = readFileSync(path.join(FLAGS_DIR, `${countryId.toLowerCase()}.svg`), 'utf8');
  const image = new Resvg(stretchSvg(svg), {
    fitTo: { mode: 'original' },
    // 1 = crispEdges: sin antialiasing, cada píxel es un color que la bandera tiene.
    shapeRendering: 1,
    textRendering: 1,
    background: 'rgba(0,0,0,0)',
  }).render();

  if (image.width !== FINE.width || image.height !== FINE.height) {
    throw new Error(`${countryId}: salió de ${image.width}×${image.height}`);
  }

  const pixels = image.pixels;
  const map = new Uint8Array(FINE_SIZE);
  for (let i = 0; i < FINE_SIZE; i++) {
    const alpha = pixels[i * 4 + 3]!;
    map[i] =
      alpha < 128 ? NONE : classifyRgb([pixels[i * 4]!, pixels[i * 4 + 1]!, pixels[i * 4 + 2]!]);
  }
  return map;
}

function printPreview(countryId: string, map: Uint8Array) {
  const counts = new Map<number, number>();
  for (const value of map) counts.set(value, (counts.get(value) ?? 0) + 1);
  const summary = [...counts]
    .sort((a, b) => b[1] - a[1])
    .filter(([, count]) => count / FINE_SIZE >= 0.005)
    .map(([cls, count]) => `${DRAW_PALETTE[cls]?.id ?? 'fuera'} ${((100 * count) / FINE_SIZE).toFixed(1)}%`)
    .join(', ');
  console.log(`\n${countryId}  ${summary}`);

  for (let y = 0; y < COARSE.height; y += 2) {
    let row = '';
    for (let x = 0; x < COARSE.width; x++) {
      const tally = new Map<number, number>();
      for (let dy = 0; dy < CELL; dy++) {
        for (let dx = 0; dx < CELL; dx++) {
          const cls = map[(y * CELL + dy) * FINE.width + x * CELL + dx]!;
          tally.set(cls, (tally.get(cls) ?? 0) + 1);
        }
      }
      const top = [...tally].sort((a, b) => b[1] - a[1])[0]![0];
      row += top === NONE ? ' ' : (PREVIEW_CHARS[top] ?? '?');
    }
    console.log(`  ${row}`);
  }
}

function main() {
  const previewArg = process.argv.indexOf('--preview');
  const preview = new Set(
    previewArg === -1 ? [] : (process.argv[previewArg + 1] ?? '').toUpperCase().split(','),
  );

  const countries = dataset.countries as Country[];
  const flags: Record<string, string> = {};
  const started = Date.now();

  for (const country of countries) {
    const map = classMapOf(country.id);
    flags[country.id] = encodeClassMap(map);
    if (preview.has(country.id)) printPreview(country.id, map);
  }

  const output = {
    fingerprint: paletteFingerprint(),
    width: FINE.width,
    height: FINE.height,
    flags,
  };
  writeFileSync(OUT_FILE, `${JSON.stringify(output)}\n`, 'utf8');

  const size = Buffer.byteLength(JSON.stringify(output));
  console.log(
    `\n${countries.length} referencias en ${((Date.now() - started) / 1000).toFixed(1)} s · ` +
      `${(size / 1024).toFixed(0)} KB → ${path.relative(ROOT, OUT_FILE)}`,
  );
}

main();
