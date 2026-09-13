import { sql } from 'drizzle-orm';
import { ALL_TIME_PERIOD, RANKING } from '@flagazo/shared';
import type { GameKind, LeaderboardMetric } from '@flagazo/shared';
import type { Database } from '../db/client';
import { leaderboardEntries, matchPlayers, matches, userStats } from '../db/schema';
import type { PlayerResult } from '../game/Game';
import type { FinishedMatch } from '../rooms/RoomManager';

export type { FinishedMatch };

export type RecordOutcome = 'recorded' | 'duplicate' | 'no-accounts';

/**
 * Graba el resultado de una partida: estadísticas del perfil y ranking.
 *
 * Todo en una transacción que arranca insertando la partida con su id: si ya
 * estaba, no se suma nada (idempotente). Los invitados no se graban: cuentan para
 * decidir si la partida es rankeable, pero no acumulan nada.
 */
export class StatsRecorder {
  constructor(
    private readonly db: Database,
    /** Huso horario que define en qué mes cae una partida. */
    private readonly timeZone = 'UTC',
  ) {}

  async record(match: FinishedMatch): Promise<RecordOutcome> {
    // Una cuenta aparece una sola vez: la sala ya lo impide, esto es por las dudas.
    const seen = new Set<string>();
    const registered = match.players.filter((player) => {
      if (!player.account || seen.has(player.account.userId)) return false;
      seen.add(player.account.userId);
      return true;
    });
    if (registered.length === 0) return 'no-accounts';

    const participants = match.players.filter((player) => player.participated).length;
    const ranked = participants >= RANKING.minParticipants;
    const period = monthOf(match.endedAt, this.timeZone);

    return this.db.transaction(async (tx) => {
      const inserted = await tx
        .insert(matches)
        .values({
          id: match.matchId,
          kind: match.kind,
          mode: match.mode,
          playerCount: match.players.length,
          registeredCount: registered.length,
          ranked,
          startedAt: match.startedAt,
          endedAt: match.endedAt,
        })
        .onConflictDoNothing()
        .returning({ id: matches.id });
      if (inserted.length === 0) return 'duplicate';

      for (const player of registered) {
        const userId = player.account!.userId;
        const points = rankingPoints(player);
        // La cuenta ya está en la fila (user_id): el resultado se guarda sin ella.
        const { account: _account, ...result } = player;

        await tx.insert(matchPlayers).values({
          matchId: match.matchId,
          userId,
          placement: player.placement,
          won: player.won,
          participated: player.participated,
          points,
          result,
        });

        await this.addStats(tx, userId, match.kind, player, match.endedAt);

        if (ranked && player.participated) {
          const values: Record<LeaderboardMetric, number> = {
            points,
            wins: player.won ? 1 : 0,
            correct: player.guess?.correct ?? 0,
          };
          for (const [metric, value] of Object.entries(values)) {
            if (value <= 0) continue;
            for (const target of [period, ALL_TIME_PERIOD]) {
              await tx
                .insert(leaderboardEntries)
                .values({ period: target, metric, userId, value, updatedAt: match.endedAt })
                .onConflictDoUpdate({
                  target: [leaderboardEntries.period, leaderboardEntries.metric, leaderboardEntries.userId],
                  set: {
                    value: sql`${leaderboardEntries.value} + ${value}`,
                    updatedAt: match.endedAt,
                  },
                });
            }
          }
        }
      }
      return 'recorded';
    });
  }

  private async addStats(
    tx: Pick<Database, 'insert'>,
    userId: string,
    kind: GameKind,
    player: PlayerResult,
    now: Date,
  ) {
    const guess = player.guess;
    const draw = player.draw;
    const won = player.won ? 1 : 0;
    const row = {
      userId,
      gamesPlayed: 1,
      gamesWon: won,
      guessGames: kind === 'guess' ? 1 : 0,
      guessWins: kind === 'guess' ? won : 0,
      drawGames: kind === 'draw' ? 1 : 0,
      drawWins: kind === 'draw' ? won : 0,
      roundsPlayed: player.roundsPlayed,
      roundsWon: player.roundsWon,
      correctAnswers: guess?.correct ?? 0,
      wrongAnswers: guess?.wrong ?? 0,
      missedAnswers: guess?.missed ?? 0,
      bestStreak: guess?.bestStreak ?? 0,
      correctMsTotal: guess?.correctMsTotal ?? 0,
      guessPoints: guess?.points ?? 0,
      drawScore: draw?.totalScore ?? 0,
      drawBestScore: draw?.bestScore ?? 0,
      updatedAt: now,
    };

    // Los contadores se suman; los récords se quedan con el mayor.
    const counters = [
      'gamesPlayed',
      'gamesWon',
      'guessGames',
      'guessWins',
      'drawGames',
      'drawWins',
      'roundsPlayed',
      'roundsWon',
      'correctAnswers',
      'wrongAnswers',
      'missedAnswers',
      'correctMsTotal',
      'guessPoints',
      'drawScore',
    ] as const;
    const set: Record<string, unknown> = {
      bestStreak: sql`greatest(${userStats.bestStreak}, ${row.bestStreak})`,
      drawBestScore: sql`greatest(${userStats.drawBestScore}, ${row.drawBestScore})`,
      updatedAt: now,
    };
    for (const counter of counters) set[counter] = sql`${userStats[counter]} + ${row[counter]}`;

    await tx.insert(userStats).values(row).onConflictDoUpdate({ target: userStats.userId, set });
  }
}

/** La métrica `points` de una partida: los puntos de adivinar, más los de dibujar ponderados. */
export function rankingPoints(player: PlayerResult): number {
  return Math.max(0, Math.round((player.guess?.points ?? 0) + (player.draw?.totalScore ?? 0) * RANKING.drawScoreWeight));
}

/** El mes (`YYYY-MM`) de una fecha, en un huso horario. */
export function monthOf(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit' }).formatToParts(date);
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  return `${year}-${month}`;
}
