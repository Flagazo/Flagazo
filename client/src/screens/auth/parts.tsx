import { useEffect, useId, useState } from 'react';
import type { InputHTMLAttributes, ReactNode } from 'react';
import { AUTH_CODE, cleanAuthCode } from '@flagazo/shared';
import type { OAuthProvider } from '@flagazo/shared';
import type { Dictionary } from '../../i18n';
import { errorMessage } from '../../lib/errors';
import { startOAuth } from '../../net/account';
import type { ClientApiResult } from '../../net/api';
import './OAuthButtons.css';

/** Piezas que comparten todos los pasos de la pantalla de cuenta. */

export type Field = 'username' | 'email' | 'password' | 'confirm' | 'code';
export type FieldErrors = Partial<Record<Field, string>>;

interface AuthFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  help?: string;
  error?: string;
  trailing?: ReactNode;
}

export function AuthField({ label, help, error, trailing, className = '', ...input }: AuthFieldProps) {
  const id = useId();
  const messageId = `${id}-message`;
  const message = error ?? help;
  return (
    <div className={`auth-field ${error ? 'auth-field--error' : ''}`}>
      <label className="auth-field__label" htmlFor={id}>
        {label}
      </label>
      <div className="auth-field__box">
        <input
          id={id}
          className={`auth-field__input ${className}`}
          aria-invalid={Boolean(error)}
          aria-describedby={message ? messageId : undefined}
          {...input}
        />
        {trailing}
      </div>
      {message && (
        <p id={messageId} className="auth-field__message">
          {message}
        </p>
      )}
    </div>
  );
}

/**
 * El código de seis dígitos. Un input común, grande y espaciado.
 *
 * `one-time-code` hace que el celular ofrezca el código que acaba de llegar, y
 * pegar "483 921" o "483-921" funciona igual. Al completar los seis se envía solo.
 */
export function CodeField({
  label,
  value,
  error,
  onChange,
  onComplete,
}: {
  label: string;
  value: string;
  error?: string;
  onChange: (code: string) => void;
  onComplete: (code: string) => void;
}) {
  return (
    <AuthField
      label={label}
      error={error}
      className="auth-field__input--code"
      value={value}
      onChange={(e) => {
        const code = cleanAuthCode(e.target.value);
        onChange(code);
        if (code.length === AUTH_CODE.length && code !== value) onComplete(code);
      }}
      inputMode="numeric"
      autoComplete="one-time-code"
      placeholder={'•'.repeat(AUTH_CODE.length)}
      maxLength={AUTH_CODE.length + 4}
      autoFocus
    />
  );
}

export function PasswordToggle({ shown, onToggle, t }: { shown: boolean; onToggle: () => void; t: Dictionary }) {
  return (
    <button
      type="button"
      className="auth-field__toggle"
      onClick={onToggle}
      aria-label={shown ? t.auth.hidePassword : t.auth.showPassword}
      aria-pressed={shown}
    >
      {shown ? '🙈' : '👁️'}
    </button>
  );
}

/** Mensaje general del formulario. `shakeKey` lo hace temblar de nuevo en cada error. */
export function FormMessage({ message, shakeKey, tone = 'error' }: { message: string | null; shakeKey: number; tone?: 'error' | 'info' }) {
  if (!message) return null;
  return (
    <p key={shakeKey} className={`auth-card__${tone} ${tone === 'error' ? 'shake' : ''}`} role={tone === 'error' ? 'alert' : 'status'}>
      {message}
    </p>
  );
}

/**
 * Segundos que faltan para poder pedir otro código. Arranca en la espera
 * completa: quien llega a esta pantalla acaba de recibir uno.
 */
export function useCooldown(): [seconds: number, restart: () => void] {
  const [until, setUntil] = useState(() => Date.now() + AUTH_CODE.resendCooldownMs);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (now >= until) return;
    const timer = setTimeout(() => setNow(Date.now()), 250);
    return () => clearTimeout(timer);
  }, [now, until]);

  const restart = () => {
    const start = Date.now();
    setUntil(start + AUTH_CODE.resendCooldownMs);
    setNow(start);
  };
  return [Math.max(0, Math.ceil((until - now) / 1000)), restart];
}

/** Traduce la respuesta del servidor a un mensaje, y dice qué campo marcar si corresponde. */
export function describeFailure(
  result: Extract<ClientApiResult<unknown>, { ok: false }>,
  t: Dictionary,
): { message: string; field?: Field } {
  const errors = t.auth.errors;
  if (result.error === 'NETWORK') return { message: errors.NETWORK };

  const { error, reason, retryAfterMs } = result as Extract<typeof result, { field?: unknown }>;
  switch (error) {
    case 'USERNAME_INVALID':
      return { field: 'username', message: reason === 'EMPTY' ? errors.USERNAME_EMPTY : errorMessage(reason ?? '') };
    case 'EMAIL_INVALID':
      return { field: 'email', message: reason === 'EMAIL_EMPTY' ? errors.EMAIL_EMPTY : errors.EMAIL_INVALID };
    case 'PASSWORD_INVALID': {
      const message = errors[reason as keyof typeof errors];
      return { field: 'password', message: typeof message === 'string' ? message : errors.GENERIC };
    }
    case 'PASSWORD_TOO_COMMON':
      return { field: 'password', message: errors.PASSWORD_TOO_COMMON };
    case 'USERNAME_TAKEN':
      return { field: 'username', message: errors.USERNAME_TAKEN };
    case 'CODE_INVALID':
    case 'CODE_EXPIRED':
    case 'CODE_LOCKED':
      return { field: 'code', message: errors[error] };
    case 'INVALID_CREDENTIALS':
    case 'ACCOUNTS_DISABLED':
    case 'ALREADY_VERIFIED':
    case 'EMAIL_NOT_VERIFIED':
      return { message: errors[error] };
    case 'RATE_LIMITED':
      return { message: errors.RATE_LIMITED(Math.ceil((retryAfterMs ?? 60_000) / 1000)) };
    default:
      return { message: errors.GENERIC };
  }
}

/** Logos oficiales, dibujados en línea: sin pedir imágenes a Google ni a Discord. */
function GoogleLogo() {
  return (
    <svg viewBox="0 0 48 48" width="20" height="20" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

function DiscordLogo() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <path
        fill="currentColor"
        d="M20.3 4.4A19.8 19.8 0 0 0 15.4 3l-.6 1.3a18.3 18.3 0 0 0-5.5 0L8.7 3a19.7 19.7 0 0 0-4.9 1.5C.7 9.1-.2 13.7.3 18.2a19.9 19.9 0 0 0 6 3l1.3-2.1c-.7-.3-1.4-.6-2-1l.5-.4a14.2 14.2 0 0 0 12 0l.5.4c-.6.4-1.3.7-2 1l1.3 2.1a19.8 19.8 0 0 0 6-3c.6-5.2-.9-9.8-3.6-13.8zM8.5 15.4c-1.2 0-2.2-1.1-2.2-2.4s1-2.4 2.2-2.4 2.2 1.1 2.2 2.4-1 2.4-2.2 2.4zm7 0c-1.2 0-2.2-1.1-2.2-2.4s1-2.4 2.2-2.4 2.2 1.1 2.2 2.4-1 2.4-2.2 2.4z"
      />
    </svg>
  );
}

/**
 * "Continuar con Google" y "Continuar con Discord". Solo los que el servidor
 * tiene configurados; sin ninguno, no se dibuja nada (ni el separador).
 * `divider` agrega el "o con tu email" que los separa del formulario.
 */
export function OAuthButtons({
  providers,
  remember,
  t,
  divider = true,
}: {
  providers: readonly OAuthProvider[];
  remember: boolean;
  t: Dictionary;
  divider?: boolean;
}) {
  const [leaving, setLeaving] = useState<OAuthProvider | null>(null);
  // Si vuelve con el botón "atrás", el navegador puede restaurar la página tal
  // cual quedó: con los botones deshabilitados. Esto los reactiva.
  useEffect(() => {
    const reset = (event: PageTransitionEvent) => {
      if (event.persisted) setLeaving(null);
    };
    window.addEventListener('pageshow', reset);
    return () => window.removeEventListener('pageshow', reset);
  }, []);
  if (providers.length === 0) return null;
  return (
    <>
      <div className="oauth-buttons">
        {providers.map((provider) => (
          <button
            key={provider}
            type="button"
            className={`oauth-button oauth-button--${provider}`}
            disabled={leaving !== null}
            onClick={() => {
              setLeaving(provider);
              startOAuth(provider, remember);
            }}
          >
            {provider === 'google' ? <GoogleLogo /> : <DiscordLogo />}
            <span>{leaving === provider ? t.auth.sending : t.auth.continueWith(PROVIDER_NAMES[provider])}</span>
          </button>
        ))}
      </div>
      {divider && (
        <div className="auth-divider" role="separator">
          <span>{t.auth.orWithEmail}</span>
        </div>
      )}
    </>
  );
}

const PROVIDER_NAMES: Record<OAuthProvider, string> = { google: 'Google', discord: 'Discord' };
