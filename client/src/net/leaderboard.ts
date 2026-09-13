import type { LeaderboardMetric, LeaderboardResponse, UserStatsSummary } from '@flagazo/shared';
import { apiRequest } from './api';

/** La tabla de un mes (sin período: el actual) o de todos los tiempos (`all`). */
export function fetchLeaderboard(metric: LeaderboardMetric, period?: string) {
  const query = new URLSearchParams({ metric });
  if (period) query.set('period', period);
  return apiRequest<LeaderboardResponse>(`/leaderboard/monthly?${query.toString()}`);
}

export function fetchMyStats() {
  return apiRequest<UserStatsSummary>('/me/stats');
}
