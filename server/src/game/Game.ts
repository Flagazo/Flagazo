import type { GameKind, GameSettings, GameSnapshot } from '@flagazo/shared';
import { DrawBattleGame } from './draw/DrawBattleGame';
import { FlagGuessGame } from './FlagGuessGame';

/** Quién juega una partida, tal como la sala se lo pasa al motor. */
export interface RosterEntry {
  id: string;
  nickname: string;
  connected: boolean;
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
