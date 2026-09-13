import { useEffect, useState } from 'react';
import { ALL_TIME_PERIOD, LEADERBOARD_METRICS } from '@flagazo/shared';
import type { LeaderboardEntry, LeaderboardMetric, LeaderboardResponse } from '@flagazo/shared';
import { AccountAvatar } from '../components/AccountAvatar';
import { Button } from '../components/Button';
import { useLocale, useT } from '../i18n';
import { fetchLeaderboard } from '../net/leaderboard';
import { useAppStore } from '../store/useAppStore';
import './RankingScreen.css';

const MEDALS = ['🥇', '🥈', '🥉'];

/**
 * El ranking: el mes en curso por defecto, con los meses anteriores y el de
 * todos los tiempos a un toque. Lo que se muestra lo calculó el servidor.
 */
export function RankingScreen() {
  const signedIn = useAppStore((s) => s.account.user !== null);
  const goTo = useAppStore((s) => s.goTo);
  const openAuth = useAppStore((s) => s.openAuth);
  const t = useT();
  const locale = useLocale();

  const [metric, setMetric] = useState<LeaderboardMetric>('points');
  /** undefined = el mes actual (lo decide el servidor, con su huso horario). */
  const [period, setPeriod] = useState<string | undefined>(undefined);
  const [data, setData] = useState<LeaderboardResponse | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    void fetchLeaderboard(metric, period).then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setData(result.data);
        setStatus('ready');
      } else {
        setStatus('error');
      }
    });
    return () => {
      cancelled = true;
    };
  }, [metric, period]);

  // 'always': en español "9800" saldría sin punto al lado de "12.840".
  const numbers = new Intl.NumberFormat(locale === 'es' ? 'es' : 'en', { useGrouping: 'always' });
  const periodName = (value: string) => {
    if (value === ALL_TIME_PERIOD) return t.ranking.allTime;
    const [year, month] = value.split('-').map(Number);
    const date = new Date(Date.UTC(year!, month! - 1, 15));
    const name = date.toLocaleDateString(locale === 'es' ? 'es' : 'en', { month: 'long', timeZone: 'UTC' });
    const thisYear = new Date().getUTCFullYear();
    return year === thisYear ? name : `${name} ${year}`;
  };

  const shownPeriod = data?.period ?? period;
  const choices = Array.from(new Set([...(data ? [data.period] : []), ...(data?.periods ?? [])]))
    .filter((value) => value !== ALL_TIME_PERIOD)
    .sort()
    .reverse();

  const podium = data?.entries.slice(0, 3) ?? [];
  const rest = data?.entries.slice(3) ?? [];
  const meVisible = data?.me && data.entries.some((entry) => entry.userId === data.me!.userId);

  return (
    <main className="screen ranking-screen">
      <header className="ranking-hero">
        <div className="ranking-hero__trophy" aria-hidden="true">
          🏆
        </div>
        <h1>
          {shownPeriod === ALL_TIME_PERIOD
            ? t.ranking.titleAllTime
            : t.ranking.title(shownPeriod ? periodName(shownPeriod) : '…')}
        </h1>
      </header>

      <div className="ranking-controls">
        <div className="ranking-tabs" role="tablist" aria-label={t.ranking.metricLabel}>
          {LEADERBOARD_METRICS.map((option) => (
            <button
              key={option}
              type="button"
              role="tab"
              aria-selected={metric === option}
              className={`ranking-tabs__tab ${metric === option ? 'is-active' : ''}`}
              onClick={() => setMetric(option)}
            >
              {t.ranking.metrics[option]}
            </button>
          ))}
        </div>
        <label className="ranking-period">
          <span className="visually-hidden">{t.ranking.periodLabel}</span>
          <select value={shownPeriod ?? ''} onChange={(event) => setPeriod(event.target.value)}>
            {choices.map((value) => (
              <option key={value} value={value}>
                {periodName(value)}
              </option>
            ))}
            <option value={ALL_TIME_PERIOD}>{t.ranking.allTime}</option>
          </select>
        </label>
      </div>

      <section className={`card ranking-card ${status === 'loading' ? 'is-loading' : ''}`}>
        {status === 'error' && <p className="ranking-empty">{t.ranking.error}</p>}

        {status !== 'error' && data && data.entries.length === 0 && (
          <div className="ranking-empty">
            <p>{t.ranking.empty}</p>
            <Button onClick={() => goTo('menu')}>{t.ranking.play}</Button>
          </div>
        )}

        {podium.length > 0 && (
          <ol className="podium">
            {podium.map((entry, index) => (
              <li key={entry.userId} className={`podium__place podium__place--${index + 1}`}>
                <span className="podium__medal" aria-hidden="true">
                  {MEDALS[entry.rank - 1] ?? `#${entry.rank}`}
                </span>
                <AccountAvatar seed={entry.userId} name={entry.username} url={entry.avatarUrl} size={index === 0 ? 76 : 60} />
                <strong className="podium__name">{entry.username}</strong>
                <span className="podium__value">{numbers.format(entry.value)}</span>
              </li>
            ))}
          </ol>
        )}

        {rest.length > 0 && (
          <ol className="ranking-list" start={4}>
            {rest.map((entry) => (
              <RankingRow key={entry.userId} entry={entry} format={numbers.format} highlight={entry.userId === data?.me?.userId} />
            ))}
          </ol>
        )}
      </section>

      {data?.me && !meVisible && (
        <section className="card ranking-me" aria-label={t.ranking.yourPosition}>
          <span className="ranking-me__label">{t.ranking.yourPosition}</span>
          <ol className="ranking-list">
            <RankingRow entry={data.me} format={numbers.format} highlight />
          </ol>
        </section>
      )}

      {!signedIn && (
        <section className="card ranking-cta">
          <p>{t.ranking.guestPitch}</p>
          <Button variant="cyan" onClick={() => openAuth('register')}>
            {t.auth.createAccount}
          </Button>
        </section>
      )}

      <p className="ranking-rules">{t.ranking.rules}</p>
      <Button variant="ghost" onClick={() => goTo('menu')}>
        {t.profile.back}
      </Button>
    </main>
  );
}

function RankingRow({ entry, format, highlight }: { entry: LeaderboardEntry; format: (value: number) => string; highlight: boolean }) {
  return (
    <li className={`ranking-row ${highlight ? 'is-me' : ''}`}>
      <span className="ranking-row__rank">#{entry.rank}</span>
      <AccountAvatar seed={entry.userId} name={entry.username} url={entry.avatarUrl} size={36} />
      <span className="ranking-row__name">{entry.username}</span>
      <span className="ranking-row__value">{format(entry.value)}</span>
    </li>
  );
}
