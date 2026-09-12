import type { Country, FlagPresentation, GameModeId } from '@flagazo/shared';

/**
 * Contrato de un modo de juego.
 *
 * El motor **no conoce ningún modo concreto**: le pregunta al modo qué banderas
 * jugar, cómo mostrarlas, cuánto dura cada una y si hay castigo extra. Agregar
 * "Supervivencia" o "Equipos" es sumar un archivo acá y listarlo en el registro,
 * sin tocar `FlagGuessGame`.
 *
 * A diferencia del boceto de la arquitectura, los ganchos **devuelven valores**
 * en vez de mutar un contexto: el motor sigue siendo el único dueño del estado,
 * así que ningún modo puede dejar una partida inconsistente.
 */
export interface FlagContext {
  /** Posición de la bandera dentro de la ronda, desde 0. */
  indexInRound: number;
  flagsPerRound: number;
  /** Los segundos por bandera que configuró el host, en ms. */
  baseDurationMs: number;
}

export interface GameMode {
  id: GameModeId;

  /**
   * Qué banderas juega este modo y en qué orden.
   * Por defecto se sortean del pool de la dificultad elegida.
   */
  pickFlags?(pool: readonly Country[], howMany: number): Country[];

  /** Efecto visual de la bandera activa. `null` = se ve tal cual. */
  presentation?: FlagPresentation | null;

  /** Cuánto dura la bandera. Si no está, se usa lo configurado. */
  flagDurationMs?(ctx: FlagContext): number;

  /**
   * Puntos extra que se restan al que dejó pasar la bandera sin responder.
   * Es negativo. Solo la bomba lo usa: quedarse callado normalmente no castiga.
   */
  missPenalty?: number;
}
