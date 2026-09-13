/**
 * Estadísticas y ranking de las cuentas.
 *
 * Todo se calcula en el servidor al terminar una partida, con lo que midieron los
 * motores de juego. El cliente nunca manda puntos: solo los muestra.
 */

/**
 * Qué se puede rankear. El ranking guarda cada métrica aparte (`period`, `metric`,
 * `value`), así sumar otra es agregarla acá y en el grabador, sin tocar tablas.
 */
export const LEADERBOARD_METRICS = ['points', 'wins', 'correct'] as const;
export type LeaderboardMetric = (typeof LEADERBOARD_METRICS)[number];

export function isLeaderboardMetric(value: unknown): value is LeaderboardMetric {
  return LEADERBOARD_METRICS.includes(value as LeaderboardMetric);
}

/** El período de todos los tiempos. Los mensuales son `YYYY-MM`. */
export const ALL_TIME_PERIOD = 'all';

const PERIOD_REGEX = /^\d{4}-(0[1-9]|1[0-2])$/;

export function isLeaderboardPeriod(value: unknown): value is string {
  return value === ALL_TIME_PERIOD || (typeof value === 'string' && PERIOD_REGEX.test(value));
}

export const RANKING = {
  /**
   * Flag Guess y Draw Battle puntúan en escalas distintas: una partida típica de
   * adivinar deja miles de puntos (100–450 por bandera, unas 30 banderas) y una de
   * dibujar, cientos (0–100 por ronda, unas 10 rondas). Para que `points` compare
   * parejo, el puntaje de dibujo se multiplica por esto. Una partida de cada uno
   * dura parecido (unos 8 minutos), así que valen parecido.
   */
  drawScoreWeight: 6,
  /**
   * Una partida cuenta para el ranking con al menos esta cantidad de jugadores que
   * participaron de verdad (respondieron o dibujaron algo), invitados incluidos.
   * Sin esto, cualquiera crea una sala privada solo y suma puntos sin límite. Las
   * estadísticas del perfil se guardan igual, cuente o no para el ranking.
   */
  minParticipants: 2,
  /** Filas que muestra la tabla. */
  pageSize: 50,
} as const;

export interface LeaderboardEntry {
  /** Puesto. Mismo valor, mismo puesto (1, 1, 3…). */
  rank: number;
  username: string;
  avatarUrl: string | null;
  /** Para dibujar el avatar de color cuando no hay foto. No es un dato privado. */
  userId: string;
  value: number;
}

export interface LeaderboardResponse {
  period: string;
  metric: LeaderboardMetric;
  entries: LeaderboardEntry[];
  /** La fila de quien pregunta, si tiene sesión y aparece en ese período. */
  me: LeaderboardEntry | null;
  /** Períodos con datos, del más nuevo al más viejo, para elegir meses anteriores. */
  periods: string[];
}

/** Lo que se muestra en el perfil. Todo acumulado desde que se creó la cuenta. */
export interface UserStatsSummary {
  gamesPlayed: number;
  gamesWon: number;
  guessGames: number;
  guessWins: number;
  drawGames: number;
  drawWins: number;
  roundsPlayed: number;
  roundsWon: number;
  correctAnswers: number;
  wrongAnswers: number;
  missedAnswers: number;
  bestStreak: number;
  /** Tiempo medio de las respuestas correctas, en ms. null sin aciertos. */
  averageAnswerMs: number | null;
  guessPoints: number;
  drawScore: number;
  drawBestScore: number;
  /** La métrica `points` de todos los tiempos. */
  totalPoints: number;
}
