import { useState } from 'react';
import type { FormEvent } from 'react';
import { AUTH_CODE } from '@flagazo/shared';
import { Button } from '../../components/Button';
import { useT } from '../../i18n';
import { resendVerification, verifyEmail } from '../../net/account';
import { useAppStore } from '../../store/useAppStore';
import { CodeField, FormMessage, describeFailure, useCooldown } from './parts';

/** "Revisá tu email": se escribe el código de seis dígitos y se entra. */
export function VerifyForm() {
  const email = useAppStore((s) => s.authEmail);
  const remember = useAppStore((s) => s.authRemember);
  const openAuth = useAppStore((s) => s.openAuth);
  const t = useT();

  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState<string | undefined>();
  const [message, setMessage] = useState<{ text: string; tone: 'error' | 'info' } | null>(null);
  const [sending, setSending] = useState(false);
  const [shakeKey, setShakeKey] = useState(0);
  const [cooldown, restartCooldown] = useCooldown();

  async function submit(value = code) {
    if (sending) return;
    setMessage(null);
    if (value.length !== AUTH_CODE.length) {
      setCodeError(t.auth.errors.CODE_EMPTY);
      setShakeKey((key) => key + 1);
      return;
    }
    setSending(true);
    const result = await verifyEmail({ email, code: value, remember });
    setSending(false);
    if (result.ok) return;

    if (!result.ok && result.error === 'ALREADY_VERIFIED') {
      openAuth('login', { email });
      useAppStore.getState().pushToast(t.auth.errors.ALREADY_VERIFIED, 'info');
      return;
    }
    const shown = describeFailure(result, t);
    if (shown.field === 'code') setCodeError(shown.message);
    else setMessage({ text: shown.message, tone: 'error' });
    setShakeKey((key) => key + 1);
  }

  async function resend() {
    restartCooldown();
    setCodeError(undefined);
    setCode('');
    const result = await resendVerification(email);
    setMessage(
      result.ok
        ? { text: t.auth.codeResent, tone: 'info' }
        : { text: describeFailure(result, t).message, tone: 'error' },
    );
  }

  return (
    <form
      className="card auth-card"
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        void submit();
      }}
      noValidate
    >
      <div className="auth-card__head">
        <div className="auth-card__badge" aria-hidden="true">
          📬
        </div>
        <h1 className="auth-card__title">{t.auth.verifyTitle}</h1>
        <p className="auth-card__pitch">{t.auth.verifyText(email)}</p>
        <p className="auth-card__hint">{t.auth.spamHint}</p>
      </div>

      <CodeField
        label={t.auth.code}
        value={code}
        error={codeError}
        onChange={(value) => {
          setCode(value);
          setCodeError(undefined);
        }}
        onComplete={(value) => void submit(value)}
      />

      <FormMessage message={message?.text ?? null} tone={message?.tone} shakeKey={shakeKey} />

      <Button type="submit" size="lg" block variant="green" disabled={sending}>
        {sending ? t.auth.sending : t.auth.submitVerify}
      </Button>

      <div className="auth-card__actions">
        <button type="button" className="auth-card__link" onClick={() => void resend()} disabled={cooldown > 0}>
          {cooldown > 0 ? t.auth.resendIn(cooldown) : t.auth.resend}
        </button>
        <button type="button" className="auth-card__link" onClick={() => openAuth('register', { email })}>
          {t.auth.changeEmail}
        </button>
      </div>
    </form>
  );
}
