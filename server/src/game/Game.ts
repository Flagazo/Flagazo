import type { GameKind, GameSettings, GameSnapshot } from '@flagazo/shared';
import { DrawBattleGame } from './draw/DrawBattleGame';
import { FlagGuessGame } from './FlagGuessGame';

/** Quién juega una partida, tal como la sala se lo pasa al motor. */
export interface RosterEntry {
  id: string;
  nickname: string;
  connected: boolean;
}

/**
 * Cómo le fue a un jugador en una partida terminada, igual para todos los juegos.
 *
 * Lo calcula el motor, que es el único que vio cada respuesta y cada dibujo. Con
 * esto se guardan las estadísticas y el ranking: nada sale del cliente.
 */
export interface PlayerResult {
  playerId: string;
  /** Puesto final, 1 = primero. Los empatados comparten puesto. */
  placement: number;
  /** Ganó la partida (con empate, ganan todos los que empataron arriba). */
  won: boolean;
  /** Respondió o dibujó algo. Quien solo miró no cuenta para el ranking. */
  participated: boolean;
  roundsPlayed: number;
  roundsWon: number;
  guess?: {
    points: number;
    correct: number;
    wrong: number;
    missed: number;
    bestStreak: number;
    /** Suma de los tiempos de las respuestas correctas, para promediar. */
    correctMsTotal: number;
  };
  draw?: {
    /** Suma de los puntajes (0–100) de cada ronda. */
    totalScore: number;
    bestScore: number;
    /** Rondas en las que mandó un dibujo con algo. */
    drawings: number;
  };
}

export interface GameResult {
  kind: GameKind;
  players: PlayerResult[];
}

/**
 * Puestos con empates compartidos (1, 1, 3…), a partir de una lista ya ordenada y
 * de una función que dice si dos jugadores empatan.
 */
export function placements<T>(sorted: readonly T[], tied: (a: T, b: T) => boolean): number[] {
  const result: number[] = [];
  sorted.forEach((item, index) => {
    const previous = sorted[index - 1];
    result.push(previous !== undefined && tied(previous, item) ? result[index - 1]! : index + 1);
  });
  return result;
}

/** Cómo le avisa el motor al mundo exterior que hay que reenviar el snapshot. */
export interface GameHooks {
  onChange(): void;
}

/**
 * Lo que la sala sabe de una partida, sea del juego que sea.
 *
 * `RoomManager` solo habla con esto: la sala, el host, las desconexiones y la
 * revancha funcionan igual para adivinar que para dibujar, sin saber cuál es.
 * Las acciones propias de cada juego (responder, mandar un dibujo) se piden
 * después de preguntar `kind`.
 *
 * Agregar un tercer juego es escribir un motor que cumpla esto y sumar un caso
 * en `createGame`.
 */
export interface Game {
  readonly kind: GameKind;
  readonly isFinished: boolean;
  start(): void;
  setConnected(playerId: string, connected: boolean): void;
  removePlayer(playerId: string): void;
  rename(playerId: string, nickname: string): void;
  toSnapshot(): GameSnapshot;
  /** El resultado final. Solo tiene sentido con `isFinished`. */
  results(): GameResult;
  /** Corta sus timers: la sala se cerró o volvió al lobby. */
  dispose(): void;
}

/**
 * Una partida en curso de cualquiera de los juegos. Es una unión y no solo `Game`
 * para que, después de mirar `kind`, TypeScript deje llamar a las acciones propias.
 */
export type ActiveGame = FlagGuessGame | DrawBattleGame;

/** La única línea que decide qué motor juega. */
export function createGame(
  settings: GameSettings,
  roster: readonly RosterEntry[],
  hooks: GameHooks,
): ActiveGame {
  switch (settings.kind) {
    case 'draw':
      return new DrawBattleGame(settings, roster, hooks);
    case 'guess':
      return new FlagGuessGame(settings, roster, hooks);
  }
}
