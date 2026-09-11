/**
 * Las banderas en disco, revisadas una por una.
 *
 * `build:flags` baja 195 SVG de Wikimedia y cualquiera de ellos puede venir con
 * la proporción rota. Eso no se nota en ningún otro test —el juego funciona
 * igual— pero es exactamente lo que un jugador ve mal, así que se revisa acá.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { COUNTRIES } from './countries';
import { config } from '../config';

interface FlagFile {
  id: string;
  /** Proporción declarada en width/height, o null si el archivo no las trae. */
  attrRatio: number | null;
  /** Proporción del viewBox, que es la del dibujo. */
  viewBoxRatio: number | null;
  /** Con esto el SVG se estira a propósito y las dos proporciones no tienen por qué coincidir. */
  stretches: boolean;
}

function parseLength(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const value = Number.parseFloat(raw.replace(/px$/, ''));
  return Number.isFinite(value) && value > 0 ? value : null;
}

function readFlag(id: string): FlagFile {
  const svg = readFileSync(join(config.flagsDir, `${id.toLowerCase()}.svg`), 'utf8');
  // El `<svg>` de apertura puede ocupar varias líneas: nada de `[^>]*`.
  const tag = svg.match(/<svg\b[\s\S]*?>/)?.[0] ?? '';

  const width = parseLength(tag.match(/\bwidth="([^"]+)"/)?.[1]);
  const height = parseLength(tag.match(/\bheight="([^"]+)"/)?.[1]);
  const viewBox = tag.match(/\bviewBox="([^"]+)"/)?.[1];
  const parts = viewBox?.trim().split(/[\s,]+/).map(Number);
  const box = parts?.length === 4 && parts[2]! > 0 && parts[3]! > 0 ? parts[2]! / parts[3]! : null;

  return {
    id,
    attrRatio: width && height ? width / height : null,
    viewBoxRatio: box,
    stretches: /preserveAspectRatio="none"/.test(tag),
  };
}

const flags = COUNTRIES.map((country) => readFlag(country.id));

describe('archivos de banderas', () => {
  it('hay un SVG por cada país del dataset', () => {
    const onDisk = new Set(
      readdirSync(config.flagsDir)
        .filter((f) => f.endsWith('.svg'))
        .map((f) => f.replace('.svg', '').toUpperCase()),
    );
    const faltantes = COUNTRIES.filter((c) => !onDisk.has(c.id)).map((c) => c.id);
    expect(faltantes).toEqual([]);
  });

  it('todos declaran de alguna forma su proporción', () => {
    // Con width/height o con viewBox alcanza: el navegador deduce la proporción
    // de cualquiera de los dos. Sin ninguno le inventa 300x150 y la deforma.
    const sinProporcion = flags
      .filter((f) => f.attrRatio === null && f.viewBoxRatio === null)
      .map((f) => f.id);
    expect(sinProporcion).toEqual([]);
  });

  it('ninguno se deforma por tener width/height peleado con el viewBox', () => {
    /*
     * Salvo que el archivo pida el estirado explícitamente con
     * `preserveAspectRatio="none"`, como hace el de Qatar: está dibujado en una
     * grilla 75×18 y estirado a su 11:28 oficial, y se ve bien.
     */
    const deformados = flags
      .filter(
        (f) =>
          !f.stretches &&
          f.attrRatio !== null &&
          f.viewBoxRatio !== null &&
          Math.abs(f.attrRatio - f.viewBoxRatio) > 0.01,
      )
      .map((f) => `${f.id} (${f.attrRatio!.toFixed(3)} vs ${f.viewBoxRatio!.toFixed(3)})`);
    expect(deformados).toEqual([]);
  });

  it('las de proporción rara conservan la suya y no caen en 4:3', () => {
    // El set anterior (flag-icons) redibujaba todo a 4:3. Estas son las que más
    // se notan, así que si alguna vuelve a medir 1.333 algo se rompió de nuevo.
    const esperadas: Record<string, number> = {
      CH: 1, // Suiza, cuadrada
      VA: 1, // Vaticano, cuadrada
      NP: 726 / 885, // Nepal, más alta que ancha
      QA: 1400 / 550, // Qatar, 11:28
      BE: 900 / 780, // Bélgica, 13:15
      US: 1235 / 650, // Estados Unidos, 10:19
    };

    for (const [id, ratio] of Object.entries(esperadas)) {
      const flag = flags.find((f) => f.id === id)!;
      const real = flag.attrRatio ?? flag.viewBoxRatio!;
      expect(real, `${id} cambió de proporción`).toBeCloseTo(ratio, 2);
      expect(Math.abs(real - 4 / 3), `${id} quedó en 4:3`).toBeGreaterThan(0.02);
    }
  });
});
