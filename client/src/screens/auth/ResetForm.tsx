import { useState } from 'react';
import type { FormEvent } from 'react';
import { AUTH_CODE, PASSWORD_MAX_LENGTH, validatePassword } from '@flagazo/shared';
import { Button } from '../../components/Button';
import { useT } from '../../i18n';
import { forgotPassword, resetPassword } from '../../net/account';
import { useAppStore } from '../../store/useAppStore';
import { AuthField, CodeField, FormMessage, PasswordToggle, describeFailure, useCooldown } from './parts';
import type { FieldErrors } from './parts';

/** El código que llegó por email y la contraseña nueva, en un solo paso. */
export function ResetForm() {
  const email = useAppStore((s) => s.authEmail);
  const remember = useAppStore((s) => s.authRemember);
  const openAuth = useAppStore((s) => s.openAuth);
  const t = useT();

  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState<{ text: string; tone: 'error' | 'info' } | null>(null);
  const [sending, setSending] = useState(false);
  const [shakeKey, setShakeKey] = useState(0);
  const [cooldown, restartCooldown] = useCooldown();

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setMessage(null);
    const found: FieldErrors = {};
    if (code.length !== AUTH_CODE.length) found.code = t.auth.errors.CODE_EMPTY;
    const passCheck = validatePassword(password, { email });
    if (!passCheck.ok) found.password = t.auth.errors[passCheck.error];
    else if (password !== confirm) found.confirm = t.auth.errors.PASSWORDS_DONT_MATCH;
    setErrors(found);
    if (Object.values(found).some(Boolean)) {
      setShakeKey((key) => key + 1);
      return;
    }

    setSending(true);
    const result = await resetPassword({ email, code, password, remember });
    setSending(false);
    if (result.ok) return;
    const shown = describeFailure(result, t);
    if (shown.field) setErrors({ [shown.field]: shown.message });
    else setMessage({ text: shown.message, tone: 'error' });
    setShakeKey((key) => key + 1);
  }

  async function resend() {
    restartCooldown();
    setCode('');
    setErrors({});
    // Mismo pedido que el primero: el paso actual no cambia.
    const result = await forgotPassword(email);
    setMessage(
      result.ok ? { text: t.auth.codeResent, tone: 'info' } : { text: describeFailure(result, t).message, tone: 'error' },
    );
  }

  return (
    <form className="card auth-card" onSubmit={handleSubmit} noValidate>
      <div className="auth-card__head">
        <div className="auth-card__badge" aria-hidden="true">
          📬
        </div>
        <h1 className="auth-card__title">{t.auth.resetTitle}</h1>
        <p className="auth-card__pitch">{t.auth.resetText(email)}</p>
        <p className="auth-card__hint">{t.auth.spamHint}</p>
      </div>

      <CodeField
        label={t.auth.code}
        value={code}
        error={errors.code}
        onChange={(value) => {
          setCode(value);
          setErrors((current) => ({ ...current, code: undefined }));
        }}
        // Acá no se envía solo: falta la contraseña nueva.
        onComplete={() => undefined}
      />

      <AuthField
        label={t.auth.newPassword}
        help={t.auth.passwordHelp}
        error={errors.password}
        type={showPassword ? 'text' : 'password'}
        value={password}
        onChange={(e) => {
          setPassword(e.target.value);
          setErrors((current) => ({ ...current, password: undefined }));
        }}
        maxLength={PASSWORD_MAX_LENGTH}
        autoComplete="new-password"
        trailing={<PasswordToggle shown={showPassword} onToggle={() => setShowPassword((show) => !show)} t={t} />}
      />

      <AuthField
        label={t.auth.confirmPassword}
        error={errors.confirm}
        type={showPassword ? 'text' : 'password'}
        value={confirm}
        onChange={(e) => {
          setConfirm(e.target.value);
          setErrors((current) => ({ ...current, confirm: undefined }));
        }}
        maxLength={PASSWORD_MAX_LENGTH}
        autoComplete="new-password"
      />

      <FormMessage message={message?.text ?? null} tone={message?.tone} shakeKey={shakeKey} />

      <Button type="submit" size="lg" block variant="green" disabled={sending}>
        {sending ? t.auth.sending : t.auth.submitReset}
      </Button>

      <div className="auth-card__actions">
        <button type="button" className="auth-card__link" onClick={() => void resend()} disabled={cooldown > 0}>
          {cooldown > 0 ? t.auth.resendIn(cooldown) : t.auth.resend}
        </button>
        <button type="button" className="auth-card__link" onClick={() => openAuth('login', { email })}>
          {t.auth.backToLogin}
        </button>
      </div>
    </form>
  );
}
