import { useState } from 'react';
import type { FormEvent } from 'react';
import { EMAIL_MAX_LENGTH, validateEmail } from '@flagazo/shared';
import { Button } from '../../components/Button';
import { useT } from '../../i18n';
import { forgotPassword } from '../../net/account';
import { useAppStore } from '../../store/useAppStore';
import { AuthField, FormMessage, describeFailure } from './parts';

/** "¿Olvidaste tu contraseña?": se pide el email y se manda un código. */
export function ForgotForm() {
  const savedEmail = useAppStore((s) => s.authEmail);
  const openAuth = useAppStore((s) => s.openAuth);
  const t = useT();

  const [email, setEmail] = useState(savedEmail);
  const [emailError, setEmailError] = useState<string | undefined>();
  const [formError, setFormError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [shakeKey, setShakeKey] = useState(0);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    const check = validateEmail(email);
    if (!check.ok) {
      setEmailError(t.auth.errors[check.error]);
      setShakeKey((key) => key + 1);
      return;
    }
    setSending(true);
    const result = await forgotPassword(check.value);
    setSending(false);
    if (result.ok) return; // pasa al paso del código
    setFormError(describeFailure(result, t).message);
    setShakeKey((key) => key + 1);
  }

  return (
    <form className="card auth-card" onSubmit={handleSubmit} noValidate>
      <div className="auth-card__head">
        <div className="auth-card__badge" aria-hidden="true">
          🔑
        </div>
        <h1 className="auth-card__title">{t.auth.forgotTitle}</h1>
        <p className="auth-card__pitch">{t.auth.forgotText}</p>
      </div>

      <AuthField
        label={t.auth.email}
        error={emailError}
        type="email"
        inputMode="email"
        value={email}
        onChange={(e) => {
          setEmail(e.target.value);
          setEmailError(undefined);
        }}
        maxLength={EMAIL_MAX_LENGTH}
        autoComplete="email"
        autoCapitalize="none"
        spellCheck={false}
        autoFocus
      />

      <FormMessage message={formError} shakeKey={shakeKey} />

      <Button type="submit" size="lg" block disabled={sending}>
        {sending ? t.auth.sending : t.auth.submitForgot}
      </Button>

      <button type="button" className="auth-card__guest" onClick={() => openAuth('login', { email })}>
        {t.auth.backToLogin}
      </button>
    </form>
  );
}
