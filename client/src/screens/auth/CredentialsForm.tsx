import { useState } from 'react';
import type { FormEvent } from 'react';
import {
  EMAIL_MAX_LENGTH,
  PASSWORD_MAX_LENGTH,
  USERNAME_MAX_LENGTH,
  validateEmail,
  validatePassword,
  validateUsername,
} from '@flagazo/shared';
import { Button } from '../../components/Button';
import { useT } from '../../i18n';
import { errorMessage } from '../../lib/errors';
import { login, register } from '../../net/account';
import { useAppStore } from '../../store/useAppStore';
import { AuthField, FormMessage, OAuthButtons, PasswordToggle, describeFailure } from './parts';
import type { Field, FieldErrors } from './parts';

/**
 * Iniciar sesión o crear una cuenta, con pestañas. Cambiar de una a otra
 * conserva el email y la contraseña escritos.
 */
export function CredentialsForm({ onGuest }: { onGuest: () => void }) {
  const mode = useAppStore((s) => (s.authMode === 'register' ? 'register' : 'login'));
  const openAuth = useAppStore((s) => s.openAuth);
  const savedEmail = useAppStore((s) => s.authEmail);
  const savedRemember = useAppStore((s) => s.authRemember);
  const providers = useAppStore((s) => s.account.providers);
  const t = useT();

  const [username, setUsername] = useState('');
  const [email, setEmail] = useState(savedEmail);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [remember, setRemember] = useState(savedRemember);
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [shakeKey, setShakeKey] = useState(0);

  const isRegister = mode === 'register';

  function switchMode(next: 'login' | 'register') {
    setErrors({});
    setFormError(null);
    openAuth(next, { email });
  }

  function clearError(field: Field) {
    setErrors((current) => ({ ...current, [field]: undefined }));
    setFormError(null);
  }

  /** Lo que se puede chequear antes de molestar al servidor. */
  function localErrors(): FieldErrors {
    const found: FieldErrors = {};
    const mailCheck = validateEmail(email);
    if (!mailCheck.ok) found.email = t.auth.errors[mailCheck.error];

    if (isRegister) {
      const nameCheck = validateUsername(username);
      if (!nameCheck.ok) {
        found.username = nameCheck.error === 'EMPTY' ? t.auth.errors.USERNAME_EMPTY : errorMessage(nameCheck.error);
      }
      const passCheck = validatePassword(password, { email, username });
      if (!passCheck.ok) found.password = t.auth.errors[passCheck.error];
      else if (password !== confirm) found.confirm = t.auth.errors.PASSWORDS_DONT_MATCH;
    } else if (password.length === 0) {
      found.password = t.auth.errors.PASSWORD_TOO_SHORT;
    }
    return found;
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const found = localErrors();
    setErrors(found);
    setFormError(null);
    if (Object.values(found).some(Boolean)) {
      setShakeKey((key) => key + 1);
      return;
    }

    setSending(true);
    const result = isRegister
      ? await register({ username, email, password, remember })
      : await login({ email, password, remember });
    setSending(false);
    // Si salió bien (o falta verificar), la navegación la hace net/account.
    if (result.ok || result.error === 'EMAIL_NOT_VERIFIED') return;

    const shown = describeFailure(result, t);
    if (shown.field) setErrors({ [shown.field]: shown.message });
    else setFormError(shown.message);
    setShakeKey((key) => key + 1);
  }

  return (
    <form className="card auth-card" onSubmit={handleSubmit} noValidate>
      <div className="auth-tabs" role="tablist">
        {(['login', 'register'] as const).map((option) => (
          <button
            key={option}
            type="button"
            role="tab"
            aria-selected={mode === option}
            className={`auth-tabs__tab ${mode === option ? 'is-active' : ''}`}
            onClick={() => switchMode(option)}
          >
            {option === 'login' ? t.auth.loginTab : t.auth.registerTab}
          </button>
        ))}
      </div>

      <div className="auth-card__head">
        <h1 className="auth-card__title">{isRegister ? t.auth.registerTitle : t.auth.loginTitle}</h1>
        {isRegister && <p className="auth-card__pitch">{t.auth.pitch}</p>}
      </div>

      {/* Lo más rápido primero: con Google o Discord no hay que verificar ningún email. */}
      <OAuthButtons providers={providers} remember={remember} t={t} />

      {isRegister && (
        <AuthField
          label={t.auth.username}
          help={t.auth.usernameHelp}
          error={errors.username}
          value={username}
          onChange={(e) => {
            setUsername(e.target.value);
            clearError('username');
          }}
          maxLength={USERNAME_MAX_LENGTH + 8}
          autoComplete="username"
          autoCapitalize="words"
          spellCheck={false}
          autoFocus
        />
      )}

      <AuthField
        label={t.auth.email}
        error={errors.email}
        type="email"
        inputMode="email"
        value={email}
        onChange={(e) => {
          setEmail(e.target.value);
          clearError('email');
        }}
        maxLength={EMAIL_MAX_LENGTH}
        // En el login el navegador ofrece la cuenta guardada por el email.
        autoComplete={isRegister ? 'email' : 'username'}
        autoCapitalize="none"
        spellCheck={false}
        autoFocus={!isRegister}
      />

      <AuthField
        label={t.auth.password}
        help={isRegister ? t.auth.passwordHelp : undefined}
        error={errors.password}
        type={showPassword ? 'text' : 'password'}
        value={password}
        onChange={(e) => {
          setPassword(e.target.value);
          clearError('password');
        }}
        maxLength={PASSWORD_MAX_LENGTH}
        autoComplete={isRegister ? 'new-password' : 'current-password'}
        trailing={<PasswordToggle shown={showPassword} onToggle={() => setShowPassword((show) => !show)} t={t} />}
      />

      {isRegister && (
        <AuthField
          label={t.auth.confirmPassword}
          error={errors.confirm}
          type={showPassword ? 'text' : 'password'}
          value={confirm}
          onChange={(e) => {
            setConfirm(e.target.value);
            clearError('confirm');
          }}
          maxLength={PASSWORD_MAX_LENGTH}
          autoComplete="new-password"
        />
      )}

      <div className="auth-card__row">
        <label className="auth-remember">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          <span>{t.auth.remember}</span>
        </label>
        {!isRegister && (
          <button type="button" className="auth-card__link" onClick={() => openAuth('forgot', { email })}>
            {t.auth.forgotLink}
          </button>
        )}
      </div>

      <FormMessage message={formError} shakeKey={shakeKey} />

      <Button type="submit" size="lg" block variant={isRegister ? 'green' : 'yellow'} disabled={sending}>
        {sending ? t.auth.sending : isRegister ? t.auth.submitRegister : t.auth.submitLogin}
      </Button>

      <button type="button" className="auth-card__guest" onClick={onGuest}>
        {t.auth.guest}
      </button>
    </form>
  );
}
