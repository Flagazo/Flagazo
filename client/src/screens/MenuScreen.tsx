import { useState } from 'react';
import type { FormEvent } from 'react';
import { DEFAULT_VISIBILITY, isValidPartyCode } from '@flagazo/shared';
import type { PartyVisibility } from '@flagazo/shared';
import { Button } from '../components/Button';
import { AccountAvatar } from '../components/AccountAvatar';
import { CodeInput } from '../components/CodeInput';
import { DonateButton } from '../components/DonateButton';
import { useT } from '../i18n';
import { errorMessage } from '../lib/errors';
import { createParty, joinParty } from '../net/party';
import { useAppStore } from '../store/useAppStore';
import './MenuScreen.css';

export function MenuScreen() {
  const nickname = useAppStore((s) => s.session.nickname) ?? '';
  const playerId = useAppStore((s) => s.session.playerId) ?? nickname;
  const isConnected = useAppStore((s) => s.connection.status === 'connected');
  const goTo = useAppStore((s) => s.goTo);
  const account = useAppStore((s) => s.account.user);
  const accountsEnabled = useAppStore((s) => s.account.enabled);
  const pushToast = useAppStore((s) => s.pushToast);
  const t = useT();

  const [code, setCode] = useState('');
  const [invalidKey, setInvalidKey] = useState(0);
  const [busy, setBusy] = useState(false);
  /*
   * Privada por defecto: publicar la party tiene que ser algo que el host elige,
   * no algo que le pasa por no haber mirado. Igual se puede cambiar en el lobby.
   */
  const [visibility, setVisibility] = useState<PartyVisibility>(DEFAULT_VISIBILITY);

  // Al entrar a una party el servidor manda "room:state" y la navegación
  // al lobby la hace la capa de conexión: acá solo se avisan los errores.
  async function handleCreate() {
    setBusy(true);
    const result = await createParty(visibility);
    setBusy(false);
    if (!result.ok) pushToast(errorMessage(result.error), 'error');
  }

  async function handleJoin(event?: FormEvent) {
    event?.preventDefault();
    if (!isValidPartyCode(code)) {
      setInvalidKey((k) => k + 1);
      pushToast(t.menu.codeLength, 'error');
      return;
    }
    setBusy(true);
    const result = await joinParty(code);
    setBusy(false);
    if (!result.ok) {
      setInvalidKey((k) => k + 1);
      pushToast(errorMessage(result.error), 'error');
    }
  }

  return (
    <main className="screen menu-screen">
      <div className="player-chip">
        {/* Con cuenta, su foto (y su color); como invitado, el círculo de color de siempre. */}
        <AccountAvatar
          className="player-chip__avatar"
          seed={account?.id ?? playerId}
          name={nickname}
          url={account?.avatarUrl ?? null}
          size={44}
        />
        <span className="player-chip__text">
          <small>{t.menu.playingAs}</small>
          <strong>{nickname}</strong>
        </span>
        {accountsEnabled && (
          <button type="button" className="player-chip__edit player-chip__ranking" onClick={() => goTo('ranking')}>
            🏆 {t.ranking.open}
          </button>
        )}
        <button type="button" className="player-chip__edit" onClick={() => goTo(account ? 'profile' : 'nickname')}>
          {t.menu.change}
        </button>
      </div>

      <div className="menu-grid">
        <section className="card menu-card menu-card--create">
          <div className="menu-card__badge" aria-hidden="true">🎉</div>
          <h2 className="menu-card__title">{t.menu.createTitle}</h2>
          <p className="menu-card__text">{t.menu.createText}</p>

          <fieldset className="visibility">
            <legend className="visibility__label">{t.menu.visibility}</legend>
            <div className="visibility__options">
              {(['private', 'public'] as const).map((option) => (
                <label
                  key={option}
                  className={`visibility__option ${
                    visibility === option ? 'visibility__option--selected' : ''
                  }`}
                >
                  <input
                    type="radio"
                    className="visually-hidden"
                    name="visibility"
                    checked={visibility === option}
                    onChange={() => setVisibility(option)}
                  />
                  <span aria-hidden="true">{option === 'public' ? '🌐' : '🔒'}</span>
                  {t.menu[option]}
                </label>
              ))}
            </div>
            <p className="visibility__hint">
              {visibility === 'public' ? t.menu.publicHint : t.menu.privateHint}
            </p>
          </fieldset>

          <Button
            variant="pink"
            size="lg"
            block
            onClick={() => void handleCreate()}
            disabled={!isConnected || busy}
          >
            {t.menu.create}
          </Button>
        </section>

        <form className="card menu-card menu-card--join" onSubmit={(e) => void handleJoin(e)}>
          <div className="menu-card__badge" aria-hidden="true">🔑</div>
          <h2 className="menu-card__title">{t.menu.joinTitle}</h2>
          <CodeInput
            key={invalidKey}
            value={code}
            onChange={setCode}
            invalid={invalidKey > 0 && !isValidPartyCode(code)}
          />
          <Button
            type="submit"
            variant="cyan"
            size="lg"
            block
            disabled={!isConnected || busy || code.length === 0}
          >
            {t.menu.join}
          </Button>
        </form>
      </div>

      {/* A lo ancho y abajo: es la puerta para el que no tiene con quién jugar,
          no una tercera forma de hacer lo mismo que las dos de arriba. */}
      <section className="card menu-browse">
        <span className="menu-browse__badge" aria-hidden="true">🌐</span>
        <div className="menu-browse__text">
          <h2 className="menu-browse__title">{t.menu.browseTitle}</h2>
          <p className="menu-browse__hint">{t.menu.browseText}</p>
        </div>
        <Button variant="green" onClick={() => goTo('browse')} disabled={!isConnected}>
          {t.menu.browse}
        </Button>
      </section>

      <DonateButton />
    </main>
  );
}
