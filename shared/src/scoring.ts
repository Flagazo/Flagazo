/**
 * Puntuación de la partida.
 *
 * Todos los números del balance viven acá: para que el juego se sienta distinto
 * no hace falta tocar el motor, solo estos valores.
 *
 * La cuenta de un acierto es:
 *
 *     redondear( (100 × precisión + bonus de velocidad) × multiplicador de racha )
 *
 * y una ronda la gana quien más puntos hizo en ella. Ganar una ronda suma un
 * punto al marcador general, que es lo que define la partida.
 */

export const SCORING = {
  /** Puntos base de una respuesta correcta. */
  base: 100,
  /** Extra máximo por responder rápido, proporcional al tiempo que sobró. */
  maxSpeedBonus: 50,
  /** Lo que cuesta errar. El puntaje de la ronda nunca baja de 0. */
  wrongPenalty: -50,
  /**
   * Lo que cuesta dejar explotar la bomba sin responder.
   *
   * Vive acá y no en `server/src/game/modes/` porque la pantalla de resultados lo
   * nombra: si estuviera solo del lado del servidor, el cliente tendría que
   * copiarlo y las dos copias se separarían en el primer rebalanceo.
   */
  bombMissPenalty: -50,
  /**
   * Multiplicadores por racha de aciertos seguidos, del más alto al más bajo.
   * La racha cuenta la respuesta actual: el tercer acierto seguido ya vale ×1.5.
   */
  streakTiers: [
    { from: 10, multiplier: 3 },
    { from: 5, multiplier: 2 },
    { from: 3, multiplier: 1.5 },
  ],
} as const;

/**
 * Qué tan exacta fue la respuesta. El fuzzy perdona errores de tipeo, pero cobra:
 * un error deja el 80 % de los puntos, dos o más el 70 %.
 */
export const PRECISION = {
  perfect: 1,
  oneTypo: 0.8,
  moreTypos: 0.7,
} as const;

export function streakMultiplier(streak: number): number {
  for (const tier of SCORING.streakTiers) {
    if (streak >= tier.from) return tier.multiplier;
  }
  return 1;
}

/** Hasta `maxSpeedBonus`, proporcional al tiempo que quedaba sin usar. */
export function speedBonus(elapsedMs: number, totalMs: number): number {
  if (totalMs <= 0) return 0;
  const remaining = Math.min(1, Math.max(0, 1 - elapsedMs / totalMs));
  return SCORING.maxSpeedBonus * remaining;
}

export interface CorrectAnswerScore {
  /** 1 = exacta. Menos, cuando el fuzzy perdona errores de tipeo. */
  precision: number;
  /** Cuánto tardó, medido por el servidor. */
  elapsedMs: number;
  /** Cuánto duraba la bandera. */
  totalMs: number;
  /** Racha ya incluyendo este acierto. */
  streak: number;
}

export function pointsForCorrect({
  precision,
  elapsedMs,
  totalMs,
  streak,
}: CorrectAnswerScore): number {
  const raw = SCORING.base * precision + speedBonus(elapsedMs, totalMs);
  return Math.round(raw * streakMultiplier(streak));
}
