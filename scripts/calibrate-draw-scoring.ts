/**
 * Tabla de puntajes de Draw Battle sobre dibujos armados a mano.
 *
 * Sirve para ajustar `SCORE_TUNING` mirando números en vez de adivinar: cada fila
 * es un dibujo típico (correcto, corrido, con colores cambiados, garabato…) contra
 * una bandera real. Los tests exigen el orden; esto muestra cuánto separa.
 *
 *     npx tsx scripts/calibrate-draw-scoring.ts
 */
import type { Drawing } from '../shared/src/drawing';
import {
  drawing,
  ellipse,
  fillRows,
  horizontalTricolor,
  rect,
  scribble,
  verticalTricolor,
} from '../server/src/game/draw/fixtures';
import { getReference } from '../server/src/game/draw/references';
import { scoreDrawing } from '../server/src/game/draw/score';

const W = 600;
const H = 400;
const messy = { spacing: 46, wobble: 14, seed: 11 };

const diamond = (color: string, inset: number) =>
  fillRows(color, inset, H - inset, (y) => {
    const t = Math.abs(y - H / 2) / (H / 2 - inset);
    const half = (W / 2 - inset * 1.5) * (1 - t);
    return half > 12 ? [W / 2 - half, W / 2 + half] : null;
  });

const usStripes = (withCanton: boolean, stripes = 13) => {
  const height = H / stripes;
  const strokes = [];
  for (let i = 0; i < stripes; i += 2) strokes.push(rect('red', 0, i * height, W, (i + 1) * height, { size: 1, spacing: 10 }));
  if (withCanton) strokes.push(rect('navy', 0, 0, W * 0.4, height * 7));
  return strokes;
};

const scenarios: [string, string, Drawing][] = [
  ['JP', 'correcta', drawing(ellipse('red', 300, 200, 120, 120))],
  ['JP', 'corrida 40/20', drawing(ellipse('red', 340, 220, 120, 120))],
  ['JP', 'disco chico (mitad)', drawing(ellipse('red', 300, 200, 60, 60))],
  ['JP', 'disco grande', drawing(ellipse('red', 300, 200, 175, 175))],
  ['JP', 'disco azul', drawing(ellipse('blue', 300, 200, 120, 120))],
  ['JP', 'todo rojo', drawing(rect('red', 0, 0, W, H))],
  ['JP', 'un punto', drawing({ tool: 'brush', size: 0, color: 'red', points: [300, 200] })],
  ['JP', 'garabato', scribble()],
  ['JP', 'vacío', drawing()],

  ['FR', 'correcta (azul)', verticalTricolor('blue', 'white', 'red')],
  ['FR', 'correcta (marino)', verticalTricolor('navy', 'white', 'red')],
  ['FR', 'a garabatos', verticalTricolor('blue', 'white', 'red', messy)],
  ['FR', 'sin pintar el blanco', drawing(rect('blue', 0, 0, 200, H), rect('red', 400, 0, W, H))],
  ['FR', 'espejada', verticalTricolor('red', 'white', 'blue')],
  ['FR', 'horizontal', horizontalTricolor('blue', 'white', 'red')],
  ['FR', 'azul-amarillo-rojo', verticalTricolor('blue', 'yellow', 'red')],
  ['FR', 'dibujó Italia', verticalTricolor('green', 'white', 'red')],
  ['FR', 'garabato', scribble()],

  ['IT', 'correcta', verticalTricolor('green', 'white', 'red')],
  ['IT', 'dibujó Irlanda', verticalTricolor('green', 'white', 'orange')],
  ['IT', 'dibujó Francia', verticalTricolor('blue', 'white', 'red')],

  ['DE', 'correcta', horizontalTricolor('black', 'red', 'yellow')],
  ['DE', 'orden al revés', horizontalTricolor('yellow', 'red', 'black')],
  ['DE', 'vertical', verticalTricolor('black', 'red', 'yellow')],

  ['US', '13 franjas + cantón', drawing(...usStripes(true))],
  ['US', '9 franjas + cantón', drawing(...usStripes(true, 9))],
  ['US', 'franjas sin cantón', drawing(...usStripes(false))],
  ['US', 'cantón + todo rojo', drawing(rect('red', 0, 0, W, H), rect('navy', 0, 0, W * 0.4, H * 0.54))],

  // Suiza es cuadrada: estirada a 3:2 la cruz ocupa x 244–356 / y 62–338 (vertical)
  // y x 112–488 / y 162–238 (horizontal). Todo lo demás es rojo.
  ['CH', 'correcta (cruz sin pintar)', drawing(
    rect('red', 0, 0, W, 62), rect('red', 0, 338, W, H),
    rect('red', 0, 62, 244, 162), rect('red', 356, 62, W, 162),
    rect('red', 0, 238, 244, 338), rect('red', 356, 238, W, 338),
    rect('red', 0, 162, 112, 238), rect('red', 488, 162, W, 238),
  )],
  ['CH', 'todo rojo', drawing(rect('red', 0, 0, W, H))],

  ['CA', 'franjas + hoja', drawing(rect('red', 0, 0, 150, H), rect('red', 450, 0, W, H), ellipse('red', 300, 200, 75, 95))],
  ['CA', 'franjas sin hoja', drawing(rect('red', 0, 0, 150, H), rect('red', 450, 0, W, H))],

  ['BR', 'verde + rombo + globo', drawing(rect('green', 0, 0, W, H), diamond('yellow', 40), ellipse('blue', 300, 200, 95, 95))],
  ['BR', 'verde + rombo', drawing(rect('green', 0, 0, W, H), diamond('yellow', 40))],
  ['BR', 'solo verde', drawing(rect('green', 0, 0, W, H))],
];

let previous = '';
const started = Date.now();
for (const [countryId, label, sample] of scenarios) {
  const reference = getReference(countryId);
  if (!reference) throw new Error(`sin referencia para ${countryId}`);
  const { score, breakdown } = scoreDrawing(sample, reference);
  if (countryId !== previous) console.log();
  previous = countryId;
  const bar = '█'.repeat(Math.round(score / 4)).padEnd(25, '·');
  console.log(
    `${countryId}  ${label.padEnd(28)} ${bar} ${score.toFixed(1).padStart(5)}` +
      `   colores ${String(breakdown.colors).padStart(3)} · distrib ${String(breakdown.layout).padStart(3)}` +
      ` · forma ${String(breakdown.shape).padStart(3)} · elementos ${String(breakdown.elements).padStart(3)}`,
  );
}
console.log(`\n${scenarios.length} dibujos en ${Date.now() - started} ms`);
