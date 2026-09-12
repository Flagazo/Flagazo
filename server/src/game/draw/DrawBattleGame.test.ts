import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  COUNTDOWN_MS,
  DEFAULT_GAME_SETTINGS,
  DRAW_FLAG_PREVIEW_MS,
  DRAW_GRACE_MS,
  DRAW_REVEAL_MS,
  encodeDrawing,
} from '@flagazo/shared';
import type { DrawSnapshot, GameSettings } from '@flagazo/shared';
import { getCountry } from '../../data/countries';
import { resolveFlagToken } from '../flagTokens';
import { DrawBattleGame } from './DrawBattleGame';
import { drawing, ellipse, rect, verticalTricolor } from './fixtures';

const SETTINGS: GameSettings = { ...DEFAULT_GAME_SETTINGS, kind: 'draw', drawRounds: 5, drawSeconds: 30 };
const DRAW_MS = SETTINGS.drawSeconds * 1000;

const JAPAN = encodeDrawing(drawing(ellipse('red', 300, 200, 120, 120)));
const JAPAN_ALL_RED = encodeDrawing(drawing(rect('red', 0, 0, 600, 400)));
const FRANCE = encodeDrawing(verticalTricolor('blue', 'white', 'red'));
const EMPTY = encodeDrawing(drawing());

let game: DrawBattleGame;
let changes: number;

function build(countryIds = ['JP', 'FR'], settings: Partial<GameSettings> = {}, players = ['ana', 'bea']) {
  changes = 0;
  game = new DrawBattleGame(
    { ...SETTINGS, ...settings },
    players.map((id) => ({ id, nickname: id.toUpperCase(), connected: true })),
    { onChange: () => changes++ },
    countryIds.map((id) => getCountry(id)!),
  );
  game.start();
  return game;
}

const snap = (): DrawSnapshot => game.toSnapshot();
const toDrawing = () => vi.advanceTimersByTime(COUNTDOWN_MS);
/**
 * Deja correr el juicio: se puntúa de a un dibujo por vuelta del bucle de eventos.
 *
 * Con los timers falsos, cada eslabón de una cadena de `setImmediate` necesita que
 * el reloj avance: avanzar 0 ms corre solo el primero, y un avance grande de una
 * vez tampoco la termina. Medido: hace falta un avance de 1 ms por eslabón. Con 40
 * alcanza para 30 jugadores (32 eslabones) y el reloj se mueve apenas 40 ms, que
 * no toca ningún tiempo que estos tests comprueben.
 */
const settle = () => {
  for (let i = 0; i < 40; i++) vi.advanceTimersByTime(1);
};
const submit = (player: string, encoded: string, final = true, round = snap().round) =>
  game.submitDrawing(player, round, encoded, final);

beforeEach(() => {
  // `setImmediate` se simula a propósito: el juicio puntúa de a un dibujo por
  // vuelta con él, y Vitest no lo incluye entre los timers falsos por defecto.
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate', 'Date'],
  });
});

afterEach(() => {
  game?.dispose();
  vi.useRealTimers();
});

describe('ronda de dibujo', () => {
  it('arranca con cuenta regresiva y después pide la bandera por su nombre', () => {
    build();
    expect(snap()).toMatchObject({ kind: 'draw', phase: 'countdown', round: 1, totalRounds: 2, prompt: null });

    toDrawing();
    const drawingPhase = snap();
    expect(drawingPhase.phase).toBe('drawing');
    expect(drawingPhase.endsAt - drawingPhase.startsAt).toBe(DRAW_MS);
    expect(drawingPhase.prompt).toMatchObject({ mode: 'name', flagUrl: null });
    expect(drawingPhase.prompt?.name?.es).toBe(getCountry('JP')!.displayName.es);
    expect(drawingPhase.reveal).toBeNull();
  });

  it('en "solo la bandera" no viaja el nombre, y la imagen se tapa y deja de servir', () => {
    build(['JP'], { drawPrompt: 'flag' });
    toDrawing();

    const prompt = snap().prompt!;
    expect(prompt.name).toBeNull();
    expect(prompt.previewMs).toBe(DRAW_FLAG_PREVIEW_MS);
    const token = prompt.flagUrl!.split('/').pop()!;
    expect(resolveFlagToken(token)).toBe('JP');

    vi.advanceTimersByTime(DRAW_FLAG_PREVIEW_MS);
    expect(snap().prompt?.flagUrl).toBeNull();
    // Volver a abrir la URL ya no trae la bandera.
    expect(resolveFlagToken(token)).toBeUndefined();
  });

  it('un borrador se guarda sin bloquear ni avisar; el final bloquea y avisa', () => {
    build();
    toDrawing();
    const before = changes;

    expect(submit('ana', JAPAN, false)).toBeNull();
    expect(changes).toBe(before);
    expect(snap().players.find((p) => p.playerId === 'ana')?.finished).toBe(false);
    // Un borrador se puede reemplazar.
    expect(submit('ana', JAPAN_ALL_RED, false)).toBeNull();

    expect(submit('ana', JAPAN)).toBeNull();
    expect(changes).toBe(before + 1);
    expect(snap().players.find((p) => p.playerId === 'ana')?.finished).toBe(true);
    expect(submit('ana', JAPAN_ALL_RED)).toBe('ALREADY_FINISHED');
  });

  it('rechaza dibujos fuera de tiempo, de otra ronda, inválidos o de desconocidos', () => {
    build();
    expect(submit('ana', JAPAN, true, 1)).toBe('NOT_DRAWING');

    toDrawing();
    expect(submit('ana', JAPAN, true, 2)).toBe('STALE_ROUND');
    expect(submit('ana', 'data:image/png;base64,AAAA')).toBe('INVALID_DRAWING');
    expect(game.submitDrawing('ana', 1, { strokes: [] }, true)).toBe('INVALID_DRAWING');
    expect(submit('intruso', JAPAN)).toBe('NOT_PLAYING');
  });

  it('si terminan todos, se juzga en el momento y el mejor dibujo gana', () => {
    build();
    toDrawing();
    submit('bea', JAPAN_ALL_RED);
    submit('ana', JAPAN);
    // Primero se ve que se está comparando; los puntajes llegan después.
    expect(snap().phase).toBe('judging');
    settle();

    const reveal = snap();
    expect(reveal.phase).toBe('reveal');
    expect(reveal.reveal?.flag.countryId).toBe('JP');
    expect(reveal.reveal?.winners).toEqual(['ana']);

    const [first, second] = reveal.reveal!.entries;
    expect(first).toMatchObject({ playerId: 'ana', rank: 1, points: 1 });
    expect(second).toMatchObject({ playerId: 'bea', rank: 2, points: 0 });
    expect(first!.score).toBeGreaterThan(second!.score);
    // El dibujo viaja para mostrarlo, y el desglose explica el número.
    expect(first!.drawing).toBe(JAPAN);
    expect(first!.breakdown.elements).toBeGreaterThan(80);

    expect(reveal.players.find((p) => p.playerId === 'ana')).toMatchObject({ points: 1, roundsWon: 1 });
  });

  it('al acabarse el tiempo deja un margen para lo que viene viajando', () => {
    build();
    toDrawing();
    submit('ana', JAPAN, false);

    vi.advanceTimersByTime(DRAW_MS);
    expect(snap().phase).toBe('judging');
    // Llega el final de bea durante el margen: cuenta, pero no como "terminó antes".
    expect(submit('bea', JAPAN_ALL_RED)).toBeNull();

    vi.advanceTimersByTime(DRAW_GRACE_MS);
    settle();
    const reveal = snap().reveal!;
    expect(reveal.entries.find((e) => e.playerId === 'bea')?.finishedMs).toBeNull();
    // ana nunca apretó TERMINAR: se la juzga con su último borrador.
    expect(reveal.entries.find((e) => e.playerId === 'ana')).toMatchObject({ rank: 1, finishedMs: null });
  });

  it('pasado el margen ya no se acepta nada', () => {
    build();
    toDrawing();
    vi.advanceTimersByTime(DRAW_MS + DRAW_GRACE_MS);
    settle();
    expect(snap().phase).toBe('reveal');
    expect(submit('ana', JAPAN, true, 1)).toBe('NOT_DRAWING');
  });

  it('quien se desconecta no traba la ronda y su borrador cuenta', () => {
    build();
    toDrawing();
    submit('bea', JAPAN, false);
    submit('ana', JAPAN_ALL_RED);

    game.setConnected('bea', false);
    settle();
    const reveal = snap().reveal!;
    expect(snap().phase).toBe('reveal');
    expect(reveal.winners).toEqual(['bea']);
  });
});

describe('juicio sin trabar el servidor', () => {
  it('no puntúa todo de un bloque: entre dibujo y dibujo pasa lo demás', () => {
    build(['JP'], {}, ['ana', 'bea', 'caro']);
    toDrawing();
    for (const id of ['ana', 'bea', 'caro']) submit(id, JAPAN);
    expect(snap().phase).toBe('judging');
    // Una sola vuelta del bucle no alcanza para tres dibujos.
    vi.advanceTimersToNextTimer();
    expect(snap().phase).toBe('judging');
    settle();
    expect(snap().phase).toBe('reveal');
  });

  it('mientras se puntúa no entra ningún dibujo', () => {
    build(['JP'], {}, ['ana', 'bea']);
    toDrawing();
    submit('ana', JAPAN, false);
    vi.advanceTimersByTime(DRAW_MS + DRAW_GRACE_MS);
    expect(snap().phase).toBe('judging');
    // bea llega tarde, con el juicio ya empezado.
    expect(submit('bea', JAPAN, true, 1)).toBe('NOT_DRAWING');
  });

  it('cerrar la partida a mitad del juicio lo corta', () => {
    build();
    toDrawing();
    submit('ana', JAPAN);
    submit('bea', JAPAN);
    game.dispose();
    const before = changes;
    settle();
    expect(changes).toBe(before);
  });

  it('con muchos jugadores la revelación dura más', () => {
    const players = Array.from({ length: 30 }, (_, i) => `p${i}`);
    build(['JP'], {}, players);
    toDrawing();
    for (const id of players) submit(id, EMPTY);
    settle();
    const reveal = snap();
    expect(reveal.phase).toBe('reveal');
    expect(reveal.endsAt - reveal.startsAt).toBeGreaterThan(DRAW_REVEAL_MS);
  });
});

describe('desempates', () => {
  it('a igual puntaje gana quien terminó antes', () => {
    build();
    toDrawing();
    vi.advanceTimersByTime(1_000);
    submit('bea', JAPAN);
    vi.advanceTimersByTime(4_000);
    submit('ana', JAPAN);
    settle();

    const [first, second] = snap().reveal!.entries;
    expect(first!.score).toBe(second!.score);
    expect(first).toMatchObject({ playerId: 'bea', rank: 1, points: 1 });
    expect(second).toMatchObject({ playerId: 'ana', rank: 2, points: 0 });
  });

  it('si también terminaron a la vez, comparten el puesto y el punto', () => {
    build();
    toDrawing();
    submit('ana', JAPAN, false);
    submit('bea', JAPAN, false);
    vi.advanceTimersByTime(DRAW_MS + DRAW_GRACE_MS);
    settle();

    const reveal = snap().reveal!;
    expect(reveal.entries.map((e) => e.rank)).toEqual([1, 1]);
    expect(reveal.entries.map((e) => e.points)).toEqual([1, 1]);
    expect([...reveal.winners].sort()).toEqual(['ana', 'bea']);
  });

  it('si nadie dibujó nada, la ronda no tiene ganador', () => {
    build();
    toDrawing();
    submit('ana', EMPTY);
    submit('bea', EMPTY);
    settle();

    const reveal = snap().reveal!;
    expect(reveal.winners).toEqual([]);
    expect(reveal.entries.every((e) => e.score === 0 && e.points === 0 && e.drawing === null)).toBe(true);
  });
});

describe('partida entera', () => {
  it('pasa por todas las rondas, suma puntos y termina en resultados', () => {
    build(['JP', 'FR']);

    toDrawing();
    submit('ana', JAPAN);
    submit('bea', JAPAN_ALL_RED);
    settle();
    vi.advanceTimersByTime(DRAW_REVEAL_MS);

    // Ronda nueva: los dibujos de la anterior ya no están en ningún lado.
    expect(snap()).toMatchObject({ phase: 'countdown', round: 2, reveal: null });
    toDrawing();
    expect(snap().prompt?.name?.es).toBe(getCountry('FR')!.displayName.es);
    submit('ana', JAPAN);
    submit('bea', FRANCE);
    settle();
    vi.advanceTimersByTime(DRAW_REVEAL_MS);

    const results = snap();
    expect(results.phase).toBe('results');
    expect(game.isFinished).toBe(true);
    expect(results.reveal).toBeNull();
    const ana = results.players.find((p) => p.playerId === 'ana')!;
    const bea = results.players.find((p) => p.playerId === 'bea')!;
    expect(ana).toMatchObject({ points: 1, roundsWon: 1, roundsPlayed: 2 });
    expect(bea).toMatchObject({ points: 1, roundsWon: 1, roundsPlayed: 2 });
  });

  it('elige banderas del pool de la dificultad si no se le pasan', () => {
    changes = 0;
    game = new DrawBattleGame(
      { ...SETTINGS, difficulty: 'easy', drawRounds: 10 },
      [{ id: 'ana', nickname: 'ANA', connected: true }],
      { onChange: () => changes++ },
    );
    expect(game.toSnapshot().totalRounds).toBe(10);
  });

  it('dispose corta los timers', () => {
    build();
    game.dispose();
    const before = changes;
    vi.advanceTimersByTime(COUNTDOWN_MS + DRAW_MS + DRAW_GRACE_MS);
    expect(changes).toBe(before);
  });
});
