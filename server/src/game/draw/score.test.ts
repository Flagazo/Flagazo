import { describe, expect, it } from 'vitest';
import { COUNTRIES } from '../../data/countries';
import {
  drawing,
  ellipse,
  fillRows,
  horizontalTricolor,
  rect,
  scribble,
  verticalTricolor,
} from './fixtures';
import { getReference } from './references';
import { scoreDrawing } from './score';
import type { Drawing } from '@flagazo/shared';

/*
 * El puntaje no se testea contra números exactos: se testea que ORDENE bien y que
 * caiga en rangos razonables, con margen. Los números finos se ajustan mirando
 * `scripts/calibrate-draw-scoring.ts`; estos tests son los que avisan si un ajuste
 * rompe el criterio.
 */

const W = 600;
const H = 400;

function score(countryId: string, sample: Drawing): number {
  const reference = getReference(countryId);
  if (!reference) throw new Error(`sin referencia para ${countryId}`);
  return scoreDrawing(sample, reference).score;
}

const japan = {
  correct: drawing(ellipse('red', 300, 200, 120, 120)),
  shifted: drawing(ellipse('red', 340, 220, 120, 120)),
  small: drawing(ellipse('red', 300, 200, 60, 60)),
  blue: drawing(ellipse('blue', 300, 200, 120, 120)),
  allRed: drawing(rect('red', 0, 0, W, H)),
};

describe('puntaje de un dibujo', () => {
  it('un lienzo vacío saca 0 aunque la bandera sea casi toda blanca', () => {
    expect(score('JP', drawing())).toBe(0);
    expect(score('CH', drawing())).toBe(0);
    // Un punto solo no es un dibujo.
    expect(score('JP', drawing({ tool: 'brush', size: 0, color: 'red', points: [300, 200] }))).toBeLessThan(5);
  });

  it('una bandera bien dibujada saca más de 85', () => {
    expect(score('JP', japan.correct)).toBeGreaterThan(85);
    expect(score('FR', verticalTricolor('blue', 'white', 'red'))).toBeGreaterThan(85);
    expect(score('DE', horizontalTricolor('black', 'red', 'yellow'))).toBeGreaterThan(85);
    expect(score('IT', verticalTricolor('green', 'white', 'red'))).toBeGreaterThan(85);
  });

  it('es determinista: el mismo dibujo saca siempre lo mismo', () => {
    const first = score('FR', verticalTricolor('blue', 'white', 'red', { wobble: 12, spacing: 40 }));
    const second = score('FR', verticalTricolor('blue', 'white', 'red', { wobble: 12, spacing: 40 }));
    expect(first).toBe(second);
  });

  it('dos dibujos buenos pero distintos no empatan en 100', () => {
    // "98 contra 96" es parte de la gracia: el puntaje no se satura arriba.
    expect(score('JP', japan.correct)).toBeLessThan(100);
    expect(score('JP', japan.correct)).not.toBe(score('JP', japan.shifted));
  });
});

describe('no castiga el estilo', () => {
  it('una bandera un poco corrida casi no pierde', () => {
    expect(score('JP', japan.shifted)).toBeGreaterThan(score('JP', japan.correct) - 5);
  });

  it('rellenar a garabatos, con huecos y bordes temblorosos, casi no pierde', () => {
    const neat = score('FR', verticalTricolor('blue', 'white', 'red'));
    const messy = score('FR', verticalTricolor('blue', 'white', 'red', { spacing: 46, wobble: 14 }));
    expect(messy).toBeGreaterThan(neat - 5);
  });

  it('no pintar lo blanco (como en papel) no se castiga', () => {
    const painted = score('FR', verticalTricolor('blue', 'white', 'red'));
    const leftBlank = score('FR', drawing(rect('blue', 0, 0, 200, H), rect('red', 400, 0, W, H)));
    expect(leftBlank).toBeGreaterThan(painted - 8);
  });

  it('azul en vez de azul marino es casi lo mismo', () => {
    expect(score('FR', verticalTricolor('blue', 'white', 'red'))).toBeGreaterThan(
      score('FR', verticalTricolor('navy', 'white', 'red')) - 6,
    );
  });

  it('no dibujar las estrellas de Estados Unidos no hunde el puntaje', () => {
    const stripeHeight = H / 13;
    const strokes = [];
    for (let i = 0; i < 13; i += 2) {
      strokes.push(rect('red', 0, i * stripeHeight, W, (i + 1) * stripeHeight, { size: 1, spacing: 10 }));
    }
    strokes.push(rect('navy', 0, 0, W * 0.4, stripeHeight * 7));
    expect(score('US', drawing(...strokes))).toBeGreaterThan(70);
  });
});

describe('prioriza el conocimiento de la bandera', () => {
  it('colores correctos en el orden equivocado sacan poco', () => {
    const correct = score('FR', verticalTricolor('blue', 'white', 'red'));
    expect(score('FR', verticalTricolor('red', 'white', 'blue'))).toBeLessThan(35);
    expect(score('FR', horizontalTricolor('blue', 'white', 'red'))).toBeLessThan(correct - 40);
    expect(score('DE', horizontalTricolor('yellow', 'red', 'black'))).toBeLessThan(35);
  });

  it('una bandera bien dibujada con los colores equivocados saca poco', () => {
    expect(score('JP', japan.blue)).toBeLessThan(20);
    expect(score('FR', verticalTricolor('blue', 'yellow', 'red'))).toBeLessThan(50);
  });

  it('confundir la bandera con una parecida queda en el medio', () => {
    const italy = score('IT', verticalTricolor('green', 'white', 'red'));
    const ireland = score('IT', verticalTricolor('green', 'white', 'orange'));
    const france = score('IT', verticalTricolor('blue', 'white', 'red'));
    expect(ireland).toBeLessThan(italy - 20);
    expect(france).toBeLessThan(italy - 30);
    // Irlanda comparte dos franjas y la tercera es un color vecino: más que Francia.
    expect(ireland).toBeGreaterThan(france);
  });

  it('inundar el lienzo con el color dominante no dibuja la bandera', () => {
    expect(score('JP', japan.allRed)).toBeLessThan(25);
    expect(score('CH', drawing(rect('red', 0, 0, W, H)))).toBeLessThan(30);
    expect(score('BR', drawing(rect('green', 0, 0, W, H)))).toBeLessThan(30);
  });

  it('olvidarse del elemento que identifica a la bandera cuesta mucho', () => {
    const withLeaf = score(
      'CA',
      drawing(rect('red', 0, 0, 150, H), rect('red', 450, 0, W, H), ellipse('red', 300, 200, 75, 95)),
    );
    const withoutLeaf = score('CA', drawing(rect('red', 0, 0, 150, H), rect('red', 450, 0, W, H)));
    expect(withoutLeaf).toBeLessThan(withLeaf - 20);

    const diamond = fillRows('yellow', 40, H - 40, (y) => {
      const t = Math.abs(y - H / 2) / (H / 2 - 40);
      const half = (W / 2 - 60) * (1 - t);
      return half > 12 ? [W / 2 - half, W / 2 + half] : null;
    });
    const brazil = score('BR', drawing(rect('green', 0, 0, W, H), diamond, ellipse('blue', 300, 200, 95, 95)));
    const noGlobe = score('BR', drawing(rect('green', 0, 0, W, H), diamond));
    expect(noGlobe).toBeLessThan(brazil - 20);
  });

  it('el disco de Japón de otro tamaño vale menos que el correcto, pero más que olvidarlo', () => {
    const small = score('JP', japan.small);
    expect(small).toBeLessThan(score('JP', japan.correct) - 30);
    expect(small).toBeGreaterThan(score('JP', japan.allRed));
    expect(small).toBeGreaterThan(score('JP', japan.blue));
  });

  it('un garabato de todos los colores saca poco en cualquier bandera', () => {
    for (const id of ['JP', 'FR', 'BR', 'US', 'ZA']) {
      expect(score(id, scribble())).toBeLessThan(25);
    }
  });
});

describe('referencias', () => {
  it('todas las banderas del juego se pueden puntuar', () => {
    const missing = COUNTRIES.filter((country) => !getReference(country.id)).map((c) => c.id);
    expect(missing).toEqual([]);
  });

  it('puntuar un dibujo es rápido', () => {
    const sample = verticalTricolor('blue', 'white', 'red', { spacing: 30, wobble: 10 });
    score('FR', sample);
    const started = performance.now();
    for (let i = 0; i < 30; i++) score('FR', sample);
    // 30 dibujos, una sala llena. En una compu normal son ~280 ms; el margen es para
    // máquinas lentas. El motor igual los puntúa de a uno para no trabar el servidor.
    expect(performance.now() - started).toBeLessThan(3_000);
  });
});
