import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { AVATAR, USERNAME_MAX_LENGTH, validateUsername } from '@flagazo/shared';
import type { OAuthProvider, UserStatsSummary } from '@flagazo/shared';
import { AccountAvatar } from '../components/AccountAvatar';
import { Button } from '../components/Button';
import { useLocale, useT } from '../i18n';
import { errorMessage } from '../lib/errors';
import { logout, startOAuth } from '../net/account';
import { fetchMyStats } from '../net/leaderboard';
import { applyProviderAvatar, changeUsername, removeAvatar, uploadAvatar } from '../net/profile';
import { useAppStore } from '../store/useAppStore';
import { describeFailure } from './auth/parts';
import './ProfileScreen.css';

const PROVIDER_NAMES: Record<OAuthProvider, string> = { google: 'Google', discord: 'Discord' };

/**
 * El perfil: foto, nombre, cuentas vinculadas y, más adelante, estadísticas.
 *
 * Todo lo que se cambia acá lo valida el servidor; la pantalla solo evita mandar
 * lo que ya se sabe que va a rebotar.
 */
export function ProfileScreen() {
  const user = useAppStore((s) => s.account.user);
  const enabledProviders = useAppStore((s) => s.account.providers);
  const goTo = useAppStore((s) => s.goTo);
  const pushToast = useAppStore((s) => s.pushToast);
  const t = useT();
  const locale = useLocale();

  const fileInput = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [stats, setStats] = useState<UserStatsSummary | null>(null);
  const userId = user?.id;

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    void fetchMyStats().then((result) => {
      if (!cancelled && result.ok) setStats(result.data);
    });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  if (!user) {
    // Cerró sesión desde otra pestaña, o la sesión venció: no hay perfil que mostrar.
    return (
      <main className="screen profile-screen">
        <div className="card profile-card profile-card--empty">
          <p>{t.profile.signedOut}</p>
          <Button onClick={() => goTo('menu')}>{t.profile.back}</Button>
        </div>
      </main>
    );
  }

  async function saveName(event: FormEvent) {
    event.preventDefault();
    const check = validateUsername(draft);
    if (!check.ok) {
      setNameError(check.error === 'EMPTY' ? t.auth.errors.USERNAME_EMPTY : errorMessage(check.error));
      return;
    }
    setBusy('name');
    const result = await changeUsername(check.value);
    setBusy(null);
    if (result.ok) {
      setEditing(false);
      pushToast(t.profile.nameSaved, 'success');
    } else {
      setNameError(describeFailure(result, t).message);
    }
  }

  async function run(key: string, action: () => Promise<{ ok: boolean; error?: string }>, success: string) {
    setBusy(key);
    const result = await action();
    setBusy(null);
    if (result.ok) pushToast(success, 'success');
    else pushToast(avatarError(result.error ?? ''), 'error');
  }

  function avatarError(code: string): string {
    const errors = t.profile.errors;
    return errors[code as keyof typeof errors] ?? t.auth.errors.GENERIC;
  }

  const since = new Date(user.createdAt).toLocaleDateString(locale === 'es' ? 'es' : 'en', {
    year: 'numeric',
    month: 'long',
  });
  const linkable = enabledProviders.filter((provider) => !user.providers.includes(provider));

  return (
    <main className="screen profile-screen">
      <section className="card profile-card">
        <div className="profile-hero">
          <button
            type="button"
            className="profile-hero__photo"
            onClick={() => fileInput.current?.click()}
            disabled={busy !== null}
            aria-label={t.profile.changePhoto}
          >
            <AccountAvatar seed={user.id} name={user.username} url={user.avatarUrl} size={112} />
            <span className="profile-hero__camera" aria-hidden="true">
              📷
            </span>
          </button>
          <input
            ref={fileInput}
            type="file"
            accept={AVATAR.types.join(',')}
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = ''; // que elegir el mismo archivo otra vez también dispare
              if (file) void run('upload', () => uploadAvatar(file), t.profile.photoSaved);
            }}
          />

          {editing ? (
            <form className="profile-name-form" onSubmit={saveName} noValidate>
              <input
                className={`profile-name-form__input ${nameError ? 'is-error' : ''}`}
                value={draft}
                onChange={(event) => {
                  setDraft(event.target.value);
                  setNameError(null);
                }}
                maxLength={USERNAME_MAX_LENGTH + 8}
                aria-label={t.auth.username}
                aria-invalid={Boolean(nameError)}
                autoFocus
                spellCheck={false}
              />
              <div className="profile-name-form__actions">
                <Button type="submit" variant="green" disabled={busy !== null}>
                  {busy === 'name' ? t.auth.sending : t.profile.save}
                </Button>
                <Button variant="ghost" onClick={() => setEditing(false)}>
                  {t.profile.cancel}
                </Button>
              </div>
              {nameError && <p className="profile-name-form__error">{nameError}</p>}
            </form>
          ) : (
            <div className="profile-hero__name">
              <h1>{user.username}</h1>
              <button
                type="button"
                className="profile-link"
                onClick={() => {
                  setDraft(user.username);
                  setNameError(null);
                  setEditing(true);
                }}
              >
                ✏️ {t.profile.editName}
              </button>
            </div>
          )}

          <p className="profile-hero__meta">
            {user.email && (
              <span>
                {user.email} {user.emailVerified && <span className="profile-badge">✓ {t.profile.verified}</span>}
              </span>
            )}
            <span>{t.profile.memberSince(since)}</span>
          </p>
        </div>

        <div className="profile-section">
          <h2>{t.profile.photo}</h2>
          <div className="profile-actions">
            <Button variant="cyan" onClick={() => fileInput.current?.click()} disabled={busy !== null}>
              {busy === 'upload' ? t.auth.sending : t.profile.uploadPhoto}
            </Button>
            {user.providerAvatars.map((provider) => (
              <Button
                key={provider}
                variant="ghost"
                disabled={busy !== null}
                onClick={() => void run(provider, () => applyProviderAvatar(provider), t.profile.photoSaved)}
              >
                {t.profile.useProviderPhoto(PROVIDER_NAMES[provider])}
              </Button>
            ))}
            {user.avatarUrl && (
              <Button variant="ghost" disabled={busy !== null} onClick={() => void run('remove', removeAvatar, t.profile.photoRemoved)}>
                {t.profile.removePhoto}
              </Button>
            )}
          </div>
          <p className="profile-hint">{t.profile.photoHint}</p>
        </div>

        {(user.providers.length > 0 || linkable.length > 0) && (
          <div className="profile-section">
            <h2>{t.profile.linked}</h2>
            <ul className="profile-providers">
              {user.providers.map((provider) => (
                <li key={provider}>
                  <span>{PROVIDER_NAMES[provider]}</span>
                  <span className="profile-badge">✓ {t.profile.linkedBadge}</span>
                </li>
              ))}
              {linkable.map((provider) => (
                <li key={provider}>
                  <span>{PROVIDER_NAMES[provider]}</span>
                  <button type="button" className="profile-link" onClick={() => startOAuth(provider, true)}>
                    {t.profile.link}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="profile-section">
          <h2>{t.profile.stats}</h2>
          <div className="profile-stats">
            {statCards(stats, t, locale).map(([label, value]) => (
              <div key={label} className="profile-stat">
                <strong>{value}</strong>
                <span>{label}</span>
              </div>
            ))}
          </div>
          {stats?.gamesPlayed === 0 && <p className="profile-hint">{t.profile.statsEmpty}</p>}
        </div>

        <div className="profile-footer">
          <Button onClick={() => goTo('menu')}>{t.profile.back}</Button>
          <Button variant="ghost" onClick={() => void logout().then((result) => result.ok && goTo('menu'))}>
            {t.auth.logout}
          </Button>
        </div>
      </section>
    </main>
  );
}

/** Las tarjetas de estadísticas. Mientras cargan, guiones. */
function statCards(stats: UserStatsSummary | null, t: ReturnType<typeof useT>, locale: string): [string, string][] {
  // 'always': en español "9800" saldría sin punto al lado de "12.840".
  const numbers = new Intl.NumberFormat(locale === 'es' ? 'es' : 'en', { useGrouping: 'always' });
  const show = (value: number | undefined) => (value === undefined ? '—' : numbers.format(value));
  const average = stats?.averageAnswerMs;
  return [
    [t.profile.statGames, show(stats?.gamesPlayed)],
    [t.profile.statWins, show(stats?.gamesWon)],
    [t.profile.statPoints, show(stats?.totalPoints)],
    [t.profile.statCorrect, show(stats?.correctAnswers)],
    [t.profile.statBestStreak, show(stats?.bestStreak)],
    [
      t.profile.statAverage,
      average
        ? `${new Intl.NumberFormat(locale === 'es' ? 'es' : 'en', { maximumFractionDigits: 1, minimumFractionDigits: 1 }).format(average / 1000)} s`
        : '—',
    ],
  ];
}
