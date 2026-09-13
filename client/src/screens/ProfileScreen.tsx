import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { AVATAR, USERNAME_MAX_LENGTH, nicknameKey, validateUsername } from '@flagazo/shared';
import type { AccountInfo, OAuthProvider, UserStatsSummary } from '@flagazo/shared';
import { AccountAvatar } from '../components/AccountAvatar';
import { Button } from '../components/Button';
import { useLocale, useT } from '../i18n';
import { errorMessage } from '../lib/errors';
import { logout, startOAuth } from '../net/account';
import { fetchMyStats } from '../net/leaderboard';
import { applyProviderAvatar, changeUsername, deleteAccount, removeAvatar, uploadAvatar } from '../net/profile';
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

        <DeleteAccountSection user={user} />

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

/**
 * Borrar la cuenta. Cerrado, es un link discreto; abierto, pide escribir el
 * username y, si la cuenta tiene, la contraseña. El servidor vuelve a validar las dos.
 */
function DeleteAccountSection({ user }: { user: AccountInfo }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const matches = nicknameKey(confirm) === nicknameKey(user.username);
  const ready = matches && (!user.hasPassword || password.length > 0);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    const result = await deleteAccount({ confirm, ...(user.hasPassword ? { password } : {}) });
    setBusy(false);
    if (result.ok) return;
    const errors = t.profile.errors;
    if (result.error === 'CONFIRMATION_INVALID') setError(errors.CONFIRMATION_INVALID);
    else if (result.error === 'INVALID_CREDENTIALS') setError(errors.WRONG_PASSWORD);
    else setError(describeFailure(result, t).message);
  }

  function close() {
    setOpen(false);
    setConfirm('');
    setPassword('');
    setError(null);
  }

  return (
    <div className="profile-section profile-danger">
      <h2>{t.profile.deleteTitle}</h2>
      <p className="profile-hint">{t.profile.deleteText}</p>
      {open ? (
        <form className="profile-danger__form" onSubmit={submit} noValidate>
          <label className="profile-danger__label">
            {t.profile.deleteConfirm(user.username)}
            <input
              className={`profile-name-form__input ${error && !matches ? 'is-error' : ''}`}
              value={confirm}
              onChange={(event) => {
                setConfirm(event.target.value);
                setError(null);
              }}
              placeholder={user.username}
              autoComplete="off"
              spellCheck={false}
              autoFocus
            />
          </label>
          {user.hasPassword && (
            <label className="profile-danger__label">
              {t.profile.deletePassword}
              <input
                className="profile-name-form__input"
                type="password"
                value={password}
                onChange={(event) => {
                  setPassword(event.target.value);
                  setError(null);
                }}
                autoComplete="current-password"
              />
            </label>
          )}
          {error && <p className="profile-name-form__error" role="alert">{error}</p>}
          <div className="profile-name-form__actions">
            <Button type="submit" variant="pink" disabled={!ready || busy}>
              {busy ? t.auth.sending : t.profile.deleteSubmit}
            </Button>
            <Button variant="ghost" onClick={close} disabled={busy}>
              {t.profile.cancel}
            </Button>
          </div>
        </form>
      ) : (
        <button type="button" className="profile-link profile-danger__open" onClick={() => setOpen(true)}>
          {t.profile.deleteOpen}
        </button>
      )}
    </div>
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
