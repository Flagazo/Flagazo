import { shuffle } from './shuffle';
import {
  COUNTDOWN_MS,
  PRECISION,
  REVEAL_MS,
  ROUND_SUMMARY_MS,
  SCORING,
  pointsForCorrect,
} from '@flagazo/shared';
import type {
  Country,
  FlagOutcome,
  GamePhase,
  GameSettings,
  GuessSnapshot,
  LocalizedName,
  PlayerStats,
  Country as PickedFlag,
} from '@flagazo/shared';
import { matchAnswer } from '../answers/matcher';
import type { AnswerVerdict } from '../answers/matcher';
import { poolFor } from '../data/countries';
import { createLogger } from '../lib/log';
import { flagFileUrl } from './flagUrls';
import { createFlagToken } from './flagTokens';
import { placements } from './Game';
import type { Game, GameHooks, GameResult, RosterEntry } from './Game';
import { getMode } from './modes';
import type { GameMode } from './modes/types';

const log = createLogger('game');

const emptyStats = (): PlayerStats => ({
  correct: 0,
  wrong: 0,
  missed: 0,
  withTypos: 0,
  bestStreak: 0,
  totalPoints: 0,
  fastestMs: null,
  averageMs: null,
});

export interface GamePlayerState {
  playerId: string;
  nickname: string;
  connected: boolean;
  /** Puntos de la ronda actual. */
  roundPoints: number;
  /** Aciertos seguidos dentro de la ronda. */
  streak: number;
  /** Puntos con los que cerró la ronda anterior. */
  lastRoundPoints: number;
  roundsWon: number;
  stats: PlayerStats;
  /** Suma de los tiempos de las correctas, para poder promediar. */
  correctMsTotal: number;
  /** Respuesta de la bandera actual, o null si todavía no respondió. */
  current: {
    answer: string;
    correct: boolean;
    ms: number;
    precision: number;
    /** Errores de tipeo perdonados. 0 si la escribió tal cual. */
    typos: number;
  } | null;
}

export interface AnswerOutcome {
  verdict: AnswerVerdict;
  /** Solo en 'ambiguous'. Van en los dos idiomas: el cliente elige cuál mostrar. */
  options?: LocalizedName[];
}

/**
 * Elige las banderas de la partida.
 *
 * Si piden más banderas que las que tiene el pool (por ejemplo 100 en dificultad
 * fácil, que son 41), se van encadenando mezclas nuevas: se repiten banderas,
 * pero nunca dos veces seguidas dentro de una misma vuelta.
 */
export function pickFlags(pool: readonly Country[], howMany: number): Country[] {
  const picked: Country[] = [];
  while (picked.length < howMany) {
    picked.push(...shuffle(pool).slice(0, howMany - picked.length));
  }
  return picked;
}

/**
 * Motor de una partida. Es dueño de la máquina de estados y de sus timers:
 *
 *   COUNTDOWN → FLAG → REVEAL ─┬─→ FLAG (siguiente bandera)
 *                              ├─→ ROUND_SUMMARY → COUNTDOWN (siguiente ronda)
 *                              └─→ RESULTS
 *
 * Todo lo que decide (qué bandera toca, cuándo termina, quién acertó) pasa acá.
 * El cliente solo dibuja lo que dice el snapshot.
 */
export class FlagGuessGame implements Game {
  readonly kind = 'guess' as const;
  private readonly mode: GameMode;
  private readonly flags: PickedFlag[];
  private readonly players = new Map<string, GamePlayerState>();

  private phase: GamePhase = 'countdown';
  private flagIndex = 0;
  private startsAt = 0;
  private endsAt = 0;
  private timer: NodeJS.Timeout | null = null;
  /** Token con el que se sirve la bandera activa sin revelar cuál es. */
  private flagToken: string | null = null;
  private outcomes: FlagOutcome[] = [];

  constructor(
    readonly settings: GameSettings,
    roster: readonly RosterEntry[],
    private readonly hooks: GameHooks,
    /**
     * Banderas ya elegidas, en vez de sortearlas.
     * Los tests la usan para no depender del azar; en la Fase 7 va a ser el
     * punto por donde cada modo de juego arme su propia selección.
     */
    flags?: readonly PickedFlag[],
  ) {
    this.mode = getMode(settings.mode);

    const total = settings.totalRounds * settings.flagsPerRound;
    const pool = poolFor(settings.difficulty);
    // El modo puede elegir sus propias banderas (el de "parecidas" lo hace);
    // si no le importa, se sortean del pool de la dificultad.
    this.flags = flags
      ? [...flags]
      : (this.mode.pickFlags?.(pool, total) ?? pickFlags(pool, total));
    for (const player of roster) {
      this.players.set(player.id, {
        playerId: player.id,
        nickname: player.nickname,
        connected: player.connected,
        roundPoints: 0,
        streak: 0,
        lastRoundPoints: 0,
        roundsWon: 0,
        stats: emptyStats(),
        correctMsTotal: 0,
        current: null,
      });
    }
  }

  get isFinished(): boolean {
    return this.phase === 'results';
  }

  /**
   * Qué país es la bandera activa. Es información del servidor y nunca viaja
   * en el snapshot: existe para logs, tests y los modos de juego futuros.
   */
  get currentCountryId(): string | null {
    return this.phase === 'flag' ? (this.currentFlag?.id ?? null) : null;
  }

  /** Arranca la cuenta regresiva de la primera ronda. */
  start() {
    log.info(
      `partida de ${this.flags.length} banderas · ${this.settings.totalRounds} rondas · ${this.players.size} jugadores`,
    );
    this.enter('countdown', COUNTDOWN_MS, () => this.beginFlag());
  }

  // ── Datos derivados ───────────────────────────────────────

  private get round(): number {
    return Math.floor(this.flagIndex / this.settings.flagsPerRound) + 1;
  }

  private get flagInRound(): number {
    return (this.flagIndex % this.settings.flagsPerRound) + 1;
  }

  private get currentFlag(): PickedFlag | undefined {
    return this.flags[this.flagIndex];
  }

  private get isLastFlagOfRound(): boolean {
    return this.flagInRound === this.settings.flagsPerRound;
  }

  /**
   * Cuánto dura la bandera activa.
   * Normalmente es lo que configuró el host, pero el modo puede cambiarlo:
   * en la bomba, la mecha se va acortando dentro de la ronda.
   */
  private flagDurationMs(): number {
    const base = this.settings.secondsPerFlag * 1000;
    return (
      this.mode.flagDurationMs?.({
        indexInRound: this.flagInRound - 1,
        flagsPerRound: this.settings.flagsPerRound,
        baseDurationMs: base,
      }) ?? base
    );
  }

  // ── Máquina de estados ────────────────────────────────────

  private enter(phase: GamePhase, durationMs: number, next: (() => void) | null) {
    this.clearTimer();
    this.phase = phase;
    this.startsAt = Date.now();
    this.endsAt = this.startsAt + durationMs;
    this.hooks.onChange();

    if (!next) return;
    this.timer = setTimeout(next, durationMs);
    this.timer.unref();
  }

  private beginFlag() {
    const flag = this.currentFlag;
    if (!flag) return this.finish();

    this.flagToken = createFlagToken(flag.id);
    this.outcomes = [];
    for (const player of this.players.values()) player.current = null;

    this.enter('flag', this.flagDurationMs(), () => this.revealFlag());
  }

  /**
   * Cierra la bandera y reparte puntos.
   *
   * Acertar suma 100 por la precisión, más hasta 50 por lo que sobró de tiempo,
   * todo multiplicado por la racha. Errar resta 50 y corta la racha; quedarse
   * sin responder no resta, pero también la corta. El puntaje de la ronda nunca
   * baja de 0, así una mala racha no deja a nadie en un pozo del que no sale.
   */
  private revealFlag() {
    const flag = this.currentFlag;
    if (!flag) return this.finish();
    const totalMs = this.flagDurationMs();

    this.outcomes = [...this.players.values()].map((player) => {
      const answer = player.current;
      let points = 0;

      if (answer?.correct) {
        player.streak++;
        points = pointsForCorrect({
          precision: answer.precision,
          elapsedMs: answer.ms,
          totalMs,
          streak: player.streak,
        });

        player.stats.correct++;
        if (answer.typos > 0) player.stats.withTypos++;
        player.stats.bestStreak = Math.max(player.stats.bestStreak, player.streak);
        player.correctMsTotal += answer.ms;
        player.stats.fastestMs =
          player.stats.fastestMs === null ? answer.ms : Math.min(player.stats.fastestMs, answer.ms);
        player.stats.averageMs = Math.round(player.correctMsTotal / player.stats.correct);
      } else {
        player.streak = 0;
        if (answer) {
          points = SCORING.wrongPenalty;
          player.stats.wrong++;
        } else {
          // Quedarse callado normalmente sale gratis; con la bomba, no:
          // si explota sin tu respuesta, el modo cobra su propia penalización.
          points = this.mode.missPenalty ?? 0;
          player.stats.missed++;
        }
      }

      player.roundPoints = Math.max(0, player.roundPoints + points);

      return {
        playerId: player.playerId,
        correct: answer?.correct ?? false,
        answer: answer?.answer ?? null,
        ms: answer?.ms ?? null,
        points,
        typos: answer?.correct ? answer.typos : 0,
        streak: player.streak,
      };
    });

    this.flagToken = null;
    this.enter('reveal', REVEAL_MS, () => this.afterReveal());
  }

  private afterReveal() {
    const wasLastOfRound = this.isLastFlagOfRound;
    this.flagIndex++;

    if (!wasLastOfRound) return this.beginFlag();

    this.awardRound();
    if (this.flagIndex >= this.flags.length) return this.finish();
    this.enter('roundSummary', ROUND_SUMMARY_MS, () => this.enter('countdown', COUNTDOWN_MS, () => this.beginFlag()));
  }

  /**
   * Cierra la ronda: quien más puntos hizo se lleva el punto del marcador general.
   * En caso de empate lo suman todos los empatados, y si nadie sumó nada la
   * ronda queda sin ganador.
   *
   * Puntos y racha vuelven a cero: cada ronda se juega de nuevo desde el arranque.
   */
  private awardRound() {
    const scores = [...this.players.values()];
    const best = Math.max(0, ...scores.map((player) => player.roundPoints));
    if (best > 0) {
      for (const player of scores) {
        if (player.roundPoints === best) player.roundsWon++;
      }
    }
    for (const player of scores) {
      player.lastRoundPoints = player.roundPoints;
      player.stats.totalPoints += player.roundPoints;
      player.roundPoints = 0;
      player.streak = 0;
    }
  }

  private finish() {
    this.clearTimer();
    this.flagToken = null;
    this.phase = 'results';
    this.startsAt = Date.now();
    this.endsAt = this.startsAt;
    log.info('partida terminada');
    this.hooks.onChange();
  }

  // ── Entradas desde afuera ─────────────────────────────────

  /**
   * Registra la respuesta de un jugador a la bandera activa.
   * Una respuesta ambigua no gasta el intento: puede volver a probar.
   */
  answer(playerId: string, text: string): AnswerOutcome | 'NO_FLAG_ACTIVE' | 'ALREADY_ANSWERED' {
    const flag = this.currentFlag;
    if (this.phase !== 'flag' || !flag) return 'NO_FLAG_ACTIVE';

    const player = this.players.get(playerId);
    if (!player) return 'NO_FLAG_ACTIVE';
    if (player.current) return 'ALREADY_ANSWERED';

    const result = matchAnswer(text, flag.id);
    // Ambiguo no es error: no gasta el intento y puede volver a probar.
    if (result.verdict === 'ambiguous') {
      return { verdict: 'ambiguous', options: result.options };
    }

    // "close" es un acierto con errores de tipeo perdonados: cuenta igual,
    // pero la precisión baja y por lo tanto también los puntos.
    const correct = result.verdict === 'correct' || result.verdict === 'close';

    // El tiempo lo mide el servidor al recibir: el cliente no puede mentirlo.
    player.current = {
      answer: text.slice(0, 64),
      correct,
      ms: Math.max(0, Date.now() - this.startsAt),
      precision: correct ? result.precision : 0,
      typos: correct ? result.distance : 0,
    };

    // La bandera termina antes si ya respondieron todos los que están conectados.
    if (this.everyoneAnswered()) this.revealFlag();
    else this.hooks.onChange();

    return { verdict: result.verdict };
  }

  private everyoneAnswered(): boolean {
    const active = [...this.players.values()].filter((player) => player.connected);
    return active.length > 0 && active.every((player) => player.current !== null);
  }

  /** Un jugador se fue o volvió: puede destrabar la bandera si faltaba solo él. */
  setConnected(playerId: string, connected: boolean) {
    const player = this.players.get(playerId);
    if (!player || player.connected === connected) return;
    player.connected = connected;
    if (this.phase === 'flag' && this.everyoneAnswered()) this.revealFlag();
    else this.hooks.onChange();
  }

  removePlayer(playerId: string) {
    if (!this.players.delete(playerId)) return;
    if (this.phase === 'flag' && this.everyoneAnswered()) this.revealFlag();
  }

  rename(playerId: string, nickname: string) {
    const player = this.players.get(playerId);
    if (player) player.nickname = nickname;
  }

  // ── Resultado ─────────────────────────────────────────────

  /**
   * El resultado final. Gana quien más rondas ganó, igual que en la pantalla de
   * resultados; a igualdad de rondas, el puesto lo ordenan los puntos.
   */
  results(): GameResult {
    const sorted = [...this.players.values()].sort(
      (a, b) => b.roundsWon - a.roundsWon || b.stats.totalPoints - a.stats.totalPoints,
    );
    const ranks = placements(sorted, (a, b) => a.roundsWon === b.roundsWon && a.stats.totalPoints === b.stats.totalPoints);
    const top = sorted[0]?.roundsWon ?? 0;

    return {
      kind: 'guess',
      players: sorted.map((player, index) => {
        const answered = player.stats.correct + player.stats.wrong;
        return {
          playerId: player.playerId,
          placement: ranks[index]!,
          won: top > 0 && player.roundsWon === top,
          participated: answered > 0,
          roundsPlayed: this.settings.totalRounds,
          roundsWon: player.roundsWon,
          guess: {
            points: player.stats.totalPoints,
            correct: player.stats.correct,
            wrong: player.stats.wrong,
            missed: player.stats.missed,
            bestStreak: player.stats.bestStreak,
            correctMsTotal: player.correctMsTotal,
          },
        };
      }),
    };
  }

  // ── Snapshot ──────────────────────────────────────────────

  toSnapshot(): GuessSnapshot {
    const flag = this.currentFlag;
    const revealing = this.phase === 'reveal';

    return {
      kind: 'guess',
      phase: this.phase,
      startsAt: this.startsAt,
      endsAt: this.endsAt,
      round: Math.min(this.round, this.settings.totalRounds),
      totalRounds: this.settings.totalRounds,
      flagInRound: this.flagInRound,
      flagsPerRound: this.settings.flagsPerRound,
      flagUrl: this.currentFlagUrl(),
      reveal:
        revealing && flag
          ? {
              countryId: flag.id,
              name: flag.displayName,
              emoji: flag.emoji,
              flagUrl: flagFileUrl(flag.id),
            }
          : null,
      mode: this.mode.id,
      // El efecto solo mientras se juega la bandera: en la revelación se ve limpia.
      presentation: this.phase === 'flag' ? (this.mode.presentation ?? null) : null,
      outcomes: revealing ? this.outcomes : [],
      players: [...this.players.values()].map((player) => ({
        playerId: player.playerId,
        nickname: player.nickname,
        connected: player.connected,
        answered: player.current !== null,
        roundPoints: player.roundPoints,
        streak: player.streak,
        lastRoundPoints: player.lastRoundPoints,
        roundsWon: player.roundsWon,
        stats: { ...player.stats },
      })),
    };
  }

  private currentFlagUrl(): string | null {
    if (this.phase === 'flag' && this.flagToken) return `/flag/r/${this.flagToken}`;
    if (this.phase === 'reveal' && this.currentFlag) {
      return flagFileUrl(this.currentFlag.id);
    }
    return null;
  }

  private clearTimer() {
    if (!this.timer) return;
    clearTimeout(this.timer);
    this.timer = null;
  }

  /** Corta todo: la party se cerró o volvió al lobby. */
  dispose() {
    this.clearTimer();
  }
}
