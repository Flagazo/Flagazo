import {
  COUNTDOWN_MS,
  DRAW_FLAG_PREVIEW_MS,
  DRAW_GRACE_MS,
  DRAW_SCORING,
  drawRevealMs,
  decodeDrawing,
  encodeDrawing,
} from '@flagazo/shared';
import type {
  Country,
  DrawEntry,
  DrawPhase,
  DrawRoundReveal,
  DrawSnapshot,
  Drawing,
  GameSettings,
} from '@flagazo/shared';
import { poolFor } from '../../data/countries';
import { createLogger } from '../../lib/log';
import { pickFlags } from '../FlagGuessGame';
import { flagFileUrl, flagTokenUrl } from '../flagUrls';
import { createFlagToken, revokeFlagToken } from '../flagTokens';
import type { Game, GameHooks, RosterEntry } from '../Game';
import { getReference, hasReference } from './references';
import { scoreDrawing } from './score';

const log = createLogger('draw');

interface DrawPlayerState {
  playerId: string;
  nickname: string;
  connected: boolean;
  points: number;
  roundsWon: number;
  totalScore: number;
  roundsPlayed: number;
  bestScore: number;
  /** Lo último que mandó en esta ronda, borrador o final. */
  drawing: Drawing | null;
  /** Mandó su dibujo final: no se acepta nada más de él en esta ronda. */
  locked: boolean;
  /** Cuánto tardó en apretar TERMINAR. null si no lo apretó. */
  finishedMs: number | null;
}

export type SubmitError = 'NOT_DRAWING' | 'STALE_ROUND' | 'NOT_PLAYING' | 'ALREADY_FINISHED' | 'INVALID_DRAWING';

interface Scored {
  player: DrawPlayerState;
  score: number;
  breakdown: DrawEntry['breakdown'];
  /** El entero que ven los jugadores, que es por lo que se ordena. */
  shown: number;
}

/**
 * Motor de Draw Battle. Dueño de la máquina de estados y de sus timers:
 *
 *   COUNTDOWN → DRAWING → JUDGING → REVEAL ─┬─→ COUNTDOWN (siguiente ronda)
 *                                            └─→ RESULTS
 *
 * El servidor elige el país, cronometra, recibe los trazos, los pinta y los
 * compara. El cliente dibuja en su aparato y manda el resultado: nunca un puntaje.
 */
export class DrawBattleGame implements Game {
  readonly kind = 'draw' as const;

  private readonly flags: Country[];
  private readonly players = new Map<string, DrawPlayerState>();

  private phase: DrawPhase = 'countdown';
  /** Índice de la ronda en `flags`, desde 0. */
  private roundIndex = 0;
  private startsAt = 0;
  private endsAt = 0;
  private drawingStartedAt = 0;
  private timer: NodeJS.Timeout | null = null;
  private previewTimer: NodeJS.Timeout | null = null;
  /** Token de la bandera visible en el modo "solo la bandera". null cuando se tapa. */
  private flagToken: string | null = null;
  private reveal: DrawRoundReveal | null = null;
  /** La ronda ya no acepta dibujos: se están puntuando. */
  private scoring = false;
  private disposed = false;

  constructor(
    readonly settings: GameSettings,
    roster: readonly RosterEntry[],
    private readonly hooks: GameHooks,
    /** Banderas ya elegidas, para que los tests no dependan del azar. */
    flags?: readonly Country[],
  ) {
    // Solo las banderas que se pueden puntuar. Hoy son todas; si alguna vez se
    // suma un país sin referencia, no puede salir en una ronda.
    const pool = poolFor(settings.difficulty).filter((country) => hasReference(country.id));
    this.flags = flags ? [...flags] : pickFlags(pool, settings.drawRounds);

    for (const player of roster) {
      this.players.set(player.id, {
        playerId: player.id,
        nickname: player.nickname,
        connected: player.connected,
        points: 0,
        roundsWon: 0,
        totalScore: 0,
        roundsPlayed: 0,
        bestScore: 0,
        drawing: null,
        locked: false,
        finishedMs: null,
      });
    }
  }

  get isFinished(): boolean {
    return this.phase === 'results';
  }

  /** Qué país se está dibujando. Nunca viaja entero en el snapshot: es para tests y logs. */
  get currentCountryId(): string | null {
    return this.phase === 'drawing' || this.phase === 'judging'
      ? (this.flags[this.roundIndex]?.id ?? null)
      : null;
  }

  start() {
    log.info(`Draw Battle de ${this.flags.length} rondas · ${this.players.size} jugadores`);
    this.enter('countdown', COUNTDOWN_MS, () => this.beginDrawing());
  }

  // ── Máquina de estados ────────────────────────────────────

  private enter(phase: DrawPhase, durationMs: number, next: (() => void) | null) {
    this.clearTimer();
    this.phase = phase;
    this.startsAt = Date.now();
    this.endsAt = this.startsAt + durationMs;
    this.hooks.onChange();
    if (!next) return;
    this.timer = setTimeout(next, durationMs);
    this.timer.unref();
  }

  private beginDrawing() {
    const flag = this.flags[this.roundIndex];
    if (!flag) return this.finish();

    this.reveal = null;
    this.scoring = false;
    for (const player of this.players.values()) {
      player.drawing = null;
      player.locked = false;
      player.finishedMs = null;
    }

    if (this.settings.drawPrompt === 'flag') {
      this.flagToken = createFlagToken(flag.id);
      // Se deja ver unos segundos y se tapa: desde ahí es de memoria, y el token
      // deja de servir para que no se pueda volver a abrir la imagen.
      this.previewTimer = setTimeout(() => this.hideFlag({ notify: true }), DRAW_FLAG_PREVIEW_MS);
      this.previewTimer.unref();
    }

    this.drawingStartedAt = Date.now();
    this.enter('drawing', this.settings.drawSeconds * 1000, () => this.closeDrawing());
  }

  /**
   * Tapa la bandera y revoca su token.
   * Solo avisa cuando se tapa sola a mitad del dibujo; si se tapa porque la fase
   * cambia, el aviso ya lo da el cambio de fase.
   */
  private hideFlag({ notify = false } = {}) {
    this.clearPreviewTimer();
    if (!this.flagToken) return;
    revokeFlagToken(this.flagToken);
    this.flagToken = null;
    if (notify && this.phase === 'drawing') this.hooks.onChange();
  }

  /**
   * Se acabó el tiempo. Queda un margen corto para los dibujos que están viajando:
   * cada cliente manda el suyo cuando su reloj llega a cero.
   */
  private closeDrawing() {
    this.hideFlag();
    if (this.everyoneLocked()) return this.judge();
    this.enter('judging', DRAW_GRACE_MS, () => this.judge());
  }

  /**
   * Cierra la ronda y puntúa todos los dibujos.
   *
   * De a uno por vuelta del bucle de eventos, no todos seguidos. Un dibujo tarda
   * unos 9 ms; treinta seguidos son ~280 ms en una compu normal y bastante más en
   * el servidor gratuito, y durante ese rato el proceso no atiende a nadie: las
   * otras salas se congelan y, en Flag Guess, una respuesta que llega en ese
   * lapso se mide como más lenta y da menos puntos. Así, entre dibujo y dibujo
   * pasa todo lo demás.
   */
  private judge() {
    if (this.scoring) return;
    this.scoring = true;
    this.clearTimer();
    this.hideFlag();
    const flag = this.flags[this.roundIndex];
    if (!flag) return this.finish();

    // Si se cerró antes del margen (terminaron todos), igual se muestra "comparando".
    if (this.phase !== 'judging') {
      this.phase = 'judging';
      this.startsAt = Date.now();
      this.endsAt = this.startsAt;
      this.hooks.onChange();
    }

    const reference = getReference(flag.id);
    const started = Date.now();
    const pending = [...this.players.values()];
    const scored: Scored[] = [];
    const round = this.roundIndex;

    const step = () => {
      // La partida se cerró, o ya es otra ronda: este juicio quedó huérfano.
      if (this.disposed || this.roundIndex !== round) return;
      const player = pending.shift();
      if (!player) return this.publishRound(flag, scored, started);
      const result =
        player.drawing && reference
          ? scoreDrawing(player.drawing, reference)
          : { score: 0, breakdown: { colors: 0, layout: 0, shape: 0, elements: 0 } };
      scored.push({ player, ...result, shown: Math.round(result.score) });
      setImmediate(step);
    };
    setImmediate(step);
  }

  /** Con todos los dibujos puntuados: puestos, puntos y revelación. */
  private publishRound(flag: Country, allScored: Scored[], started: number) {
    // Quien se fue de la sala mientras se puntuaba no entra en la revelación.
    const scored = allScored.filter((item) => this.players.has(item.player.playerId));

    /*
     * Desempate: primero el puntaje que se ve (el entero: 87,4 y 86,6 se ven como
     * 87 y 87, y desempatar por lo invisible sería injusto), después quien apretó
     * TERMINAR antes. Si sigue empatado, comparten puesto y puntos.
     */
    const time = (ms: number | null) => ms ?? Infinity;
    scored.sort((a, b) => b.shown - a.shown || time(a.player.finishedMs) - time(b.player.finishedMs));

    const entries: DrawEntry[] = [];
    scored.forEach((item, index) => {
      const previous = scored[index - 1];
      const tied =
        previous &&
        previous.shown === item.shown &&
        time(previous.player.finishedMs) === time(item.player.finishedMs);
      const rank = tied ? entries[index - 1]!.rank : index + 1;
      const counts = item.shown >= DRAW_SCORING.minWinningScore;
      const points = counts ? (DRAW_SCORING.placePoints[rank - 1] ?? 0) : 0;

      const player = item.player;
      player.points += points;
      if (rank === 1 && counts) player.roundsWon++;
      player.totalScore += item.shown;
      player.roundsPlayed++;
      player.bestScore = Math.max(player.bestScore, item.shown);

      entries.push({
        playerId: player.playerId,
        drawing: player.drawing && player.drawing.strokes.length > 0 ? encodeDrawing(player.drawing) : null,
        score: item.shown,
        breakdown: item.breakdown,
        finishedMs: player.finishedMs,
        rank,
        points,
      });
    });

    log.info(
      `ronda ${this.roundIndex + 1} (${flag.id}) juzgada en ${Date.now() - started} ms · ` +
        entries.map((entry) => `${this.players.get(entry.playerId)?.nickname}=${entry.score}`).join(' '),
    );

    this.reveal = {
      flag: { countryId: flag.id, name: flag.displayName, emoji: flag.emoji, flagUrl: flagFileUrl(flag.id) },
      entries,
      winners: entries.filter((entry) => entry.rank === 1 && entry.score >= DRAW_SCORING.minWinningScore).map((e) => e.playerId),
    };

    // Los dibujos de la ronda ya están en la revelación: no se guardan en otro lado.
    for (const player of this.players.values()) player.drawing = null;

    // Con más jugadores hay más dibujos para mirar: la revelación dura más.
    this.enter('reveal', drawRevealMs(entries.length), () => this.afterReveal());
  }

  private afterReveal() {
    this.roundIndex++;
    if (this.roundIndex >= this.flags.length) return this.finish();
    this.enter('countdown', COUNTDOWN_MS, () => this.beginDrawing());
  }

  private finish() {
    this.clearTimer();
    this.hideFlag();
    this.reveal = null;
    this.phase = 'results';
    this.startsAt = Date.now();
    this.endsAt = this.startsAt;
    log.info('Draw Battle terminada');
    this.hooks.onChange();
  }

  // ── Entradas desde afuera ─────────────────────────────────

  /**
   * Recibe el dibujo de un jugador.
   *
   * Un borrador se guarda en silencio (no le importa a nadie más). Uno final
   * bloquea al jugador y avisa, porque los demás ven quién terminó; si terminaron
   * todos los conectados, la ronda se corta.
   */
  submitDrawing(playerId: string, round: unknown, raw: unknown, final: unknown): SubmitError | null {
    if ((this.phase !== 'drawing' && this.phase !== 'judging') || this.scoring) return 'NOT_DRAWING';
    if (round !== this.roundIndex + 1) return 'STALE_ROUND';

    const player = this.players.get(playerId);
    if (!player) return 'NOT_PLAYING';
    if (player.locked) return 'ALREADY_FINISHED';

    const decoded = decodeDrawing(raw);
    if (!decoded.ok) return 'INVALID_DRAWING';
    player.drawing = decoded.drawing;

    if (final !== true) return null;

    player.locked = true;
    // Mandarlo durante el margen no es "terminar antes": es que se le acabó el tiempo.
    player.finishedMs = this.phase === 'drawing' ? Date.now() - this.drawingStartedAt : null;

    if (this.everyoneLocked()) {
      this.judge();
    } else {
      this.hooks.onChange();
    }
    return null;
  }

  private everyoneLocked(): boolean {
    const active = [...this.players.values()].filter((player) => player.connected);
    return active.length > 0 && active.every((player) => player.locked);
  }

  setConnected(playerId: string, connected: boolean) {
    const player = this.players.get(playerId);
    if (!player || player.connected === connected) return;
    player.connected = connected;
    // Si el único que faltaba se fue, no se lo espera: su borrador cuenta igual.
    if ((this.phase === 'drawing' || this.phase === 'judging') && !this.scoring && this.everyoneLocked()) this.judge();
    else this.hooks.onChange();
  }

  removePlayer(playerId: string) {
    if (!this.players.delete(playerId)) return;
    if ((this.phase === 'drawing' || this.phase === 'judging') && !this.scoring && this.everyoneLocked()) this.judge();
  }

  rename(playerId: string, nickname: string) {
    const player = this.players.get(playerId);
    if (player) player.nickname = nickname;
  }

  // ── Snapshot ──────────────────────────────────────────────

  toSnapshot(): DrawSnapshot {
    const flag = this.flags[this.roundIndex];
    const asking = (this.phase === 'drawing' || this.phase === 'judging') && flag;

    return {
      kind: 'draw',
      phase: this.phase,
      startsAt: this.startsAt,
      endsAt: this.endsAt,
      round: Math.min(this.roundIndex + 1, this.flags.length),
      totalRounds: this.flags.length,
      prompt: asking
        ? {
            mode: this.settings.drawPrompt,
            // En "solo la bandera" no viaja el nombre: sería la respuesta.
            name: this.settings.drawPrompt === 'name' ? flag.displayName : null,
            flagUrl: this.flagToken ? flagTokenUrl(this.flagToken) : null,
            previewMs: this.settings.drawPrompt === 'flag' ? DRAW_FLAG_PREVIEW_MS : 0,
          }
        : null,
      reveal: this.phase === 'reveal' ? this.reveal : null,
      players: [...this.players.values()].map((player) => ({
        playerId: player.playerId,
        nickname: player.nickname,
        connected: player.connected,
        finished: player.locked,
        points: player.points,
        roundsWon: player.roundsWon,
        totalScore: player.totalScore,
        roundsPlayed: player.roundsPlayed,
        bestScore: player.bestScore,
      })),
    };
  }

  private clearTimer() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private clearPreviewTimer() {
    if (this.previewTimer) clearTimeout(this.previewTimer);
    this.previewTimer = null;
  }

  dispose() {
    this.disposed = true;
    this.clearTimer();
    this.hideFlag();
  }
}
