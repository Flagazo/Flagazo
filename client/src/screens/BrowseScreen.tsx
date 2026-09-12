import { useCallback, useEffect, useRef, useState } from 'react';
import { GAME_MODES } from '@flagazo/shared';
import type { PublicParty } from '@flagazo/shared';
import { Button } from '../components/Button';
import { useT } from '../i18n';
import { errorMessage } from '../lib/errors';
import { joinParty, listPublicParties } from '../net/party';
import { useAppStore } from '../store/useAppStore';
import './BrowseScreen.css';

/** Cada cuánto se vuelve a pedir la lista mientras el buscador está abierto. */
const REFRESH_MS = 5_000;

export function BrowseScreen() {
  const goTo = useAppStore((s) => s.goTo);
  const isConnected = useAppStore((s) => s.connection.status === 'connected');
  const pushToast = useAppStore((s) => s.pushToast);
  const t = useT();

  const [parties, setParties] = useState<PublicParty[] | null>(null);
  const [busyCode, setBusyCode] = useState<string | null>(null);
  /*
   * Refrescar en segundo plano no debe hacer parpadear la lista: solo el primer
   * pedido muestra "buscando…". De ahí en más se reemplaza lo que ya está.
   */
  const refresh = useCallback(async () => {
    const result = await listPublicParties();
    if (result.ok) setParties(result.parties);
    else setParties((current) => current ?? []);
  }, []);

  // Un ref para que el intervalo no se reinicie en cada render.
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  useEffect(() => {
    if (!isConnected) return;
    void refreshRef.current();
    const timer = setInterval(() => void refreshRef.current(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [isConnected]);

  async function handleJoin(party: PublicParty) {
    setBusyCode(party.code);
    const result = await joinParty(party.code);
    setBusyCode(null);
    // Si sale bien, "room:state" navega solo al lobby.
    if (!result.ok) {
      pushToast(errorMessage(result.error), 'error');
      // Se llenó o se cerró entre que se listó y se tocó: la lista ya está vieja.
      void refresh();
    }
  }

  return (
    <main className="screen browse-screen">
      <header className="browse-head">
        <div>
          <h2 className="browse-head__title">{t.browse.title}</h2>
          <p className="browse-head__subtitle">{t.browse.subtitle}</p>
        </div>
        <div className="browse-head__actions">
          <Button variant="ghost" onClick={() => goTo('menu')}>
            {t.browse.back}
          </Button>
          <Button variant="cyan" icon="↻" onClick={() => void refresh()} disabled={!isConnected}>
            {t.browse.refresh}
          </Button>
        </div>
      </header>

      {parties === null ? (
        <p className="browse-empty">{t.browse.loading}</p>
      ) : parties.length === 0 ? (
        <div className="card browse-empty-card">
          <p className="browse-empty-card__title">{t.browse.empty}</p>
          <p className="browse-empty-card__hint">{t.browse.emptyHint}</p>
          <Button variant="pink" onClick={() => goTo('menu')}>
            {t.browse.createOne}
          </Button>
        </div>
      ) : (
        <ul className="browse-list">
          {parties.map((party) => (
            <PartyRow
              key={party.code}
              party={party}
              busy={busyCode !== null}
              joining={busyCode === party.code}
              onJoin={() => void handleJoin(party)}
            />
          ))}
        </ul>
      )}
    </main>
  );
}

function PartyRow({
  party,
  busy,
  joining,
  onJoin,
}: {
  party: PublicParty;
  busy: boolean;
  joining: boolean;
  onJoin: () => void;
}) {
  const t = useT();
  const drawing = party.kind === 'draw';
  const mode = GAME_MODES.find((info) => info.id === party.mode);
  const minutes = Math.floor(party.ageMs / 60_000);
  const almostFull = party.players >= party.maxPlayers - 2;

  return (
    <li className="card browse-row">
      <span className="browse-row__mode" aria-hidden="true">
        {drawing ? '🎨' : (mode?.emoji ?? '🏳️')}
      </span>

      <div className="browse-row__info">
        <p className="browse-row__host">{t.browse.hostedBy(party.hostNickname)}</p>
        <p className="browse-row__setup">
          {/* Qué juego es va primero: una sala de dibujo y una de adivinar no se parecen en nada. */}
          <span className="browse-row__tag">{t.kinds[party.kind].name}</span>
          {!drawing && mode && <span className="browse-row__tag">{t.modes[mode.id].name}</span>}
          <span className="browse-row__tag">{t.lobby.difficulties[party.difficulty]}</span>
          {drawing
            ? t.browse.drawSetup(party.drawRounds, party.drawSeconds)
            : t.browse.setup(party.totalRounds, party.flagsPerRound, party.secondsPerFlag)}
        </p>
      </div>

      <div className="browse-row__meta">
        <span className={`browse-row__slots ${almostFull ? 'browse-row__slots--hot' : ''}`}>
          {t.browse.slots(party.players, party.maxPlayers)}
        </span>
        <span className="browse-row__age">
          {minutes < 1 ? t.browse.justCreated : t.browse.minutesAgo(minutes)}
        </span>
      </div>

      <Button variant="green" onClick={onJoin} disabled={busy}>
        {joining ? '…' : t.browse.join}
      </Button>
    </li>
  );
}
