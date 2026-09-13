import { and, asc, count, desc, eq, gt, isNotNull, sql } from 'drizzle-orm';
import { ALL_TIME_PERIOD, RANKING } from '@flagazo/shared';
import type { LeaderboardEntry, LeaderboardMetric, LeaderboardResponse, UserStatsSummary } from '@flagazo/shared';
import { avatarUrl } from '../auth/accounts';
import type { Database } from '../db/client';
import { leaderboardEntries, userStats, users } from '../db/schema';

/** Lecturas del ranking y de las estadísticas del perfil. */
export class LeaderboardService {
  constructor(private readonly db: Database) {}

  /**
   * La tabla de un período y una métrica, y la fila de quien pregunta.
   *
   * Puestos con empates compartidos: mismo valor, mismo puesto. Dentro de un
   * empate se lista primero quien llegó antes a ese valor.
   */
  async table(period: string, metric: LeaderboardMetric, viewerId: string | null): Promise<LeaderboardResponse> {
    const rows = await this.db
      .select({
        userId: leaderboardEntries.userId,
        value: leaderboardEntries.value,
        username: users.username,
        avatarVersion: users.avatarVersion,
      })
      .from(leaderboardEntries)
      .innerJoin(users, eq(users.id, leaderboardEntries.userId))
      .where(and(eq(leaderboardEntries.period, period), eq(leaderboardEntries.metric, metric)))
      .orderBy(desc(leaderboardEntries.value), asc(leaderboardEntries.updatedAt))
      .limit(RANKING.pageSize);

    const entries: LeaderboardEntry[] = [];
    rows.forEach((row, index) => {
      const previous = entries[index - 1];
      entries.push({
        rank: previous && previous.value === row.value ? previous.rank : index + 1,
        userId: row.userId,
        username: row.username,
        avatarUrl: avatarUrl({ id: row.userId, avatarVersion: row.avatarVersion }),
        value: row.value,
      });
    });

    return {
      period,
      metric,
      entries,
      me: viewerId ? await this.rowOf(period, metric, viewerId, entries) : null,
      periods: await this.periods(metric),
    };
  }

  /** La fila de una cuenta, esté o no entre las primeras. */
  private async rowOf(
    period: string,
    metric: LeaderboardMetric,
    userId: string,
    shown: LeaderboardEntry[],
  ): Promise<LeaderboardEntry | null> {
    const visible = shown.find((entry) => entry.userId === userId);
    if (visible) return visible;

    const [mine] = await this.db
      .select({ value: leaderboardEntries.value, username: users.username, avatarVersion: users.avatarVersion })
      .from(leaderboardEntries)
      .innerJoin(users, eq(users.id, leaderboardEntries.userId))
      .where(
        and(
          eq(leaderboardEntries.period, period),
          eq(leaderboardEntries.metric, metric),
          eq(leaderboardEntries.userId, userId),
        ),
      )
      .limit(1);
    if (!mine) return null;

    // Puesto = cuántos tienen más, más uno. Los empatados comparten puesto.
    const [ahead] = await this.db
      .select({ total: count() })
      .from(leaderboardEntries)
      .where(
        and(
          eq(leaderboardEntries.period, period),
          eq(leaderboardEntries.metric, metric),
          gt(leaderboardEntries.value, mine.value),
        ),
      );
    return {
      rank: (ahead?.total ?? 0) + 1,
      userId,
      username: mine.username,
      avatarUrl: avatarUrl({ id: userId, avatarVersion: mine.avatarVersion }),
      value: mine.value,
    };
  }

  /** Los meses con datos, del más nuevo al más viejo. */
  async periods(metric: LeaderboardMetric): Promise<string[]> {
    const rows = await this.db
      .selectDistinct({ period: leaderboardEntries.period })
      .from(leaderboardEntries)
      .where(and(eq(leaderboardEntries.metric, metric), sql`${leaderboardEntries.period} <> ${ALL_TIME_PERIOD}`))
      .orderBy(desc(leaderboardEntries.period));
    return rows.map((row) => row.period);
  }

  async statsOf(userId: string): Promise<UserStatsSummary> {
    const row = await this.db.query.userStats.findFirst({ where: eq(userStats.userId, userId) });
    const [points] = await this.db
      .select({ value: leaderboardEntries.value })
      .from(leaderboardEntries)
      .where(
        and(
          eq(leaderboardEntries.period, ALL_TIME_PERIOD),
          eq(leaderboardEntries.metric, 'points'),
          eq(leaderboardEntries.userId, userId),
          isNotNull(leaderboardEntries.value),
        ),
      )
      .limit(1);

    return {
      gamesPlayed: row?.gamesPlayed ?? 0,
      gamesWon: row?.gamesWon ?? 0,
      guessGames: row?.guessGames ?? 0,
      guessWins: row?.guessWins ?? 0,
      drawGames: row?.drawGames ?? 0,
      drawWins: row?.drawWins ?? 0,
      roundsPlayed: row?.roundsPlayed ?? 0,
      roundsWon: row?.roundsWon ?? 0,
      correctAnswers: row?.correctAnswers ?? 0,
      wrongAnswers: row?.wrongAnswers ?? 0,
      missedAnswers: row?.missedAnswers ?? 0,
      bestStreak: row?.bestStreak ?? 0,
      averageAnswerMs: row && row.correctAnswers > 0 ? Math.round(row.correctMsTotal / row.correctAnswers) : null,
      guessPoints: row?.guessPoints ?? 0,
      drawScore: row?.drawScore ?? 0,
      drawBestScore: row?.drawBestScore ?? 0,
      totalPoints: points?.value ?? 0,
    };
  }
}
