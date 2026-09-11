import { useState } from 'react';
import type { FormEvent } from 'react';
import { NICKNAME_MAX_LENGTH, sanitizeNickname, validateNickname } from '@flagazo/shared';
import { Button } from '../components/Button';
import { Logo } from '../components/Logo';
import { useT } from '../i18n';
import { errorMessage } from '../lib/errors';
import { EXAMPLE_NAME } from '../lib/exampleName';
import { storage } from '../lib/storage';
import { submitNickname } from '../net/connection';
import { useAppStore } from '../store/useAppStore';
import './NicknameScreen.css';

export function NicknameScreen() {
  const currentNickname = useAppStore((s) => s.session.nickname);
  const status = useAppStore((s) => s.connection.status);
  const goTo = useAppStore((s) => s.goTo);
  const t = useT();

  const [value, setValue] = useState(() => currentNickname ?? storage.getNickname() ?? '');
  const [serverError, setServerError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [sending, setSending] = useState(false);
  const [shakeKey, setShakeKey] = useState(0);

  const validation = validateNickname(value);
  const length = [...sanitizeNickname(value)].length;
  const isConnected = status === 'connected';

  // Mientras escribe solo mostramos errores "duros"; "muy corto" espera al envío.
  const liveError =
    !validation.ok && (submitted || (validation.error !== 'TOO_SHORT' && validation.error !== 'EMPTY'))
      ? errorMessage(validation.error)
      : null;
  const error = serverError ?? liveError;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitted(true);
    setServerError(null);
    if (!validation.ok) {
      setShakeKey((k) => k + 1);
      return;
    }
    setSending(true);
    const result = await submitNickname(validation.value);
    setSending(false);
    if (result.ok) {
      goTo('menu');
    } else {
      setServerError(errorMessage(result.error));
      setShakeKey((k) => k + 1);
    }
  }

  return (
    <main className="screen nickname-screen">
      <div className="nickname-screen__hero">
        <Logo />
        <p className="nickname-screen__tagline">{t.nickname.tagline}</p>
      </div>

      <form className="card nickname-card" onSubmit={handleSubmit} noValidate>
        <label className="nickname-card__label" htmlFor="nickname">
          {t.nickname.label}
        </label>

        <div key={shakeKey} className={`nickname-field ${error ? 'nickname-field--error shake' : ''}`}>
          <input
            id="nickname"
            className="nickname-field__input"
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setServerError(null);
            }}
            placeholder={t.nickname.placeholder(EXAMPLE_NAME)}
            maxLength={NICKNAME_MAX_LENGTH + 8}
            autoComplete="nickname"
            autoCapitalize="words"
            spellCheck={false}
            autoFocus
            aria-invalid={Boolean(error)}
            aria-describedby="nickname-help"
          />
          <span className={`nickname-field__count ${length > NICKNAME_MAX_LENGTH ? 'is-over' : ''}`}>
            {length}/{NICKNAME_MAX_LENGTH}
          </span>
        </div>

        <p id="nickname-help" className={`nickname-card__help ${error ? 'is-error' : ''}`}>
          {error ?? t.nickname.help}
        </p>

        <Button type="submit" size="lg" block disabled={!isConnected || sending} icon={isConnected ? '▶' : undefined}>
          {!isConnected ? t.nickname.connecting : sending ? t.nickname.entering : t.nickname.play}
        </Button>
      </form>
    </main>
  );
}
