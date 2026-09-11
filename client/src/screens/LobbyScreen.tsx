import { useState } from 'react';
import {
  DIFFICULTY_OPTIONS,
  GAME_MODES,
  MIN_FLAGS_PER_ROUND,
  SECONDS_PER_FLAG_OPTIONS,
  TOTAL_ROUNDS_OPTIONS,
  fitsInGame,
  maxFlagsPerRoundFor,
} from '@flagazo/shared';
import type { GameSettings, PartyVisibility, PublicPlayer } from '@flagazo/shared';
import { AdSlot } from '../components/AdSlot';
import { Button } from '../components/Button';
import { NumberField } from '../components/NumberField';
import { OptionGroup } from '../components/OptionGroup';
import { useT } from '../i18n';
import { avatarColor, avatarInitial } from '../lib/avatar';
import { errorMessage } from '../lib/errors';
import { storage } from '../lib/storage';
import {
  copyPartyCode,
  kickPlayer,
  leaveParty,
  setVisibility,
  startGame,
  updateSettings,
} from '../net/party';
import { selectIsHost, useAppStore } from '../store/useAppStore';
import './LobbyScreen.css';

const numberOptions = (values: readonly number[], suffix = '') =>
  values.map((value) => ({ value, label: `${value}${suffix}` }));

/** Duración aproximada: el tiempo de cada bandera más unos segundos de revelación. */
const REVEAL_SECONDS = 4;
function estimatedMinutes(totalFlags: number, secondsPerFlag: number): number {
  return Math.max(1, Math.round((totalFlags * (secondsPerFlag + REVEAL_SECONDS)) / 60));
}

export function LobbyScreen() {
  const room = useAppStore((s) => s.room);
  const myId = useAppStore((s) => s.session.playerId);
  const isHost = useAppStore(selectIsHost);
  const isConnected = useAppStore((s) => s.connection.status === 'connected');
  const pushToast = useAppStore((s) => s.pushToast);
  const t = useT();

  const [busy, setBusy] = useState(false);
  // Preferencia local de cada jugador, no de la party: si estás compartiendo
  // pantalla no querés que el código quede a la vista de cualquiera.
  const [hideCode, setHideCode] = useState(storage.getHideCode);

  function toggleHideCode() {
    setHideCode((hidden) => {
      storage.setHideCode(!hidden);
      return !hidden;
    });
  }

  // Entre que se sale de la party y se navega al menú puede haber un render sin sala.
  if (!room) return null;

  const canEdit = isHost && isConnected;

  async function applySettings(patch: Partial<GameSettings>) {
    const result = await updateSettings(patch);
    if (!result.ok) pushToast(errorMessage(result.error), 'error');
  }

  async function handleVisibility(next: PartyVisibility) {
    const result = await setVisibility(next);
    if (!result.ok) pushToast(errorMessage(result.error), 'error');
  }

  async function handleKick(player: PublicPlayer) {
    const result = await kickPlayer(player.id);
    if (result.ok) pushToast(t.lobby.kicked(player.nickname), 'info');
    else pushToast(errorMessage(result.error), 'error');
  }

  async function handleStart() {
    setBusy(true);
    const result = await startGame();
    setBusy(false);
    // Si sale bien, el servidor manda room:state con la partida y la
    // navegación a la pantalla de juego la hace la capa de conexión.
    if (!result.ok) pushToast(errorMessage(result.error), 'error');
  }

  async function handleLeave() {
    setBusy(true);
    const result = await leaveParty();
    setBusy(false);
    // NOT_IN_PARTY significa que el servidor ya nos sacó: no es un error para el jugador.
    if (!result.ok && result.error !== 'NOT_IN_PARTY') {
      pushToast(errorMessage(result.error), 'error');
    }
  }

  const currentMode = GAME_MODES.find((info) => info.id === room.settings.mode) ?? GAME_MODES[0]!;
  const { totalRounds, flagsPerRound, secondsPerFlag } = room.settings;
  const totalFlags = totalRounds * flagsPerRound;
  /** Con más rondas entran menos banderas en cada una sin pasar el tope de la partida. */
  const maxFlags = maxFlagsPerRoundFor(totalRounds);
  const difficultyOptions = DIFFICULTY_OPTIONS.map((value) => ({
    value,
    label: t.lobby.difficulties[value],
  }));
  const roundOptions = TOTAL_ROUNDS_OPTIONS.map((rounds) => ({
    value: rounds,
    label: String(rounds),
    // La misma regla que hace cumplir el servidor, no una copia de la desigualdad.
    disabled: !fitsInGame(rounds, flagsPerRound),
    disabledReason: t.lobby.roundsTooMany(rounds, flagsPerRound),
  }));

  const showCodeLabel = hideCode ? t.lobby.showCode : t.lobby.hideCode;

  return (
    <main className="screen lobby-screen">
      <section className="card lobby-code">
        <p className="lobby-code__label">{t.lobby.codeLabel}</p>

        <div className="lobby-code__row">
          <button
            type="button"
            className="lobby-code__value"
            onClick={() => void copyPartyCode(room.code)}
            title={t.lobby.copyCode}
          >
            {/* Aunque esté tapado se puede copiar: es justo para pasarlo sin mostrarlo. */}
            {hideCode ? (
              <>
                <span className="lobby-code__masked" aria-hidden="true">
                  {'•'.repeat(room.code.length)}
                </span>
                <span className="visually-hidden">{t.lobby.codeHidden}</span>
              </>
            ) : (
              <span>{room.code}</span>
            )}
            <span className="lobby-code__copy" aria-hidden="true">📋</span>
          </button>

          <button
            type="button"
            className="lobby-code__eye"
            onClick={toggleHideCode}
            aria-pressed={hideCode}
            title={showCodeLabel}
            aria-label={showCodeLabel}
          >
            {hideCode ? '🙈' : '👁️'}
          </button>
        </div>

        <p className="lobby-code__hint">
          {hideCode ? t.lobby.hintHidden : t.lobby.hintVisible}
        </p>

        {/* El host la publica o la esconde en cualquier momento; el resto solo
            ve en cuál de las dos está, que cambia quién puede caer acá. */}
        <div className="lobby-visibility">
          {isHost ? (
            <div className="lobby-visibility__options" role="group" aria-label={t.lobby.visibility}>
              {(['private', 'public'] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  className={`lobby-visibility__option ${
                    room.visibility === option ? 'lobby-visibility__option--selected' : ''
                  }`}
                  onClick={() => void handleVisibility(option)}
                  aria-pressed={room.visibility === option}
                  disabled={!isConnected}
                >
                  <span aria-hidden="true">{option === 'public' ? '🌐' : '🔒'}</span>
                  {t.lobby[option]}
                </button>
              ))}
            </div>
          ) : (
            <span className="lobby-visibility__badge">
              {room.visibility === 'public' ? t.lobby.publicBadge : t.lobby.privateBadge}
            </span>
          )}
          <p className="lobby-visibility__hint">
            {room.visibility === 'public' ? t.lobby.publicHint : t.lobby.privateHint}
          </p>
        </div>
      </section>

      <section className="card lobby-panel">
        <header className="lobby-panel__head">
          <h2 className="lobby-panel__title">{t.lobby.players}</h2>
          <span className="lobby-panel__count">
            {room.players.length}/{room.maxPlayers}
          </span>
        </header>

        <ul className="player-list">
          {room.players.map((player) => (
            <li
              key={player.id}
              className={`player-row ${player.connected ? '' : 'player-row--away'}`}
            >
              <span className="player-row__avatar" style={{ background: avatarColor(player.id) }}>
                {avatarInitial(player.nickname)}
              </span>
              <span className="player-row__name">
                {player.nickname}
                {player.id === myId && <span className="player-row__tag">{t.common.you}</span>}
              </span>
              {player.id === room.hostId && (
                <span className="player-row__crown" title={t.common.host}>👑</span>
              )}
              {!player.connected && (
                <span className="player-row__status">{t.common.disconnected}</span>
              )}
              {isHost && player.id !== myId && (
                <button
                  type="button"
                  className="player-row__kick"
                  onClick={() => void handleKick(player)}
                  title={t.lobby.kick(player.nickname)}
                  aria-label={t.lobby.kick(player.nickname)}
                >
                  ✕
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className="card lobby-panel">
        <header className="lobby-panel__head">
          <h2 className="lobby-panel__title">{t.lobby.settings}</h2>
          {!isHost && <span className="lobby-panel__count">{t.lobby.hostDecides}</span>}
        </header>

        {/* El modo va arriba y a lo ancho: es la decisión que más cambia
            cómo se juega, y necesita lugar para explicarse. */}
        <fieldset className="mode-picker">
          <legend className="mode-picker__label">{t.lobby.mode}</legend>
          <div className="mode-picker__options">
            {GAME_MODES.map((info) => {
              const selected = info.id === room.settings.mode;
              return (
                <label
                  key={info.id}
                  className={`mode-option ${selected ? 'mode-option--selected' : ''}`}
                  title={t.modes[info.id].description}
                >
                  <input
                    type="radio"
                    className="visually-hidden"
                    name="modo"
                    checked={selected}
                    disabled={!canEdit}
                    onChange={() => void applySettings({ mode: info.id })}
                  />
                  <span className="mode-option__emoji" aria-hidden="true">{info.emoji}</span>
                  <span className="mode-option__name">{t.modes[info.id].name}</span>
                </label>
              );
            })}
          </div>
          {/* El nombre va acá además de en la casilla: en pantallas angostas la
              casilla se queda solo con el emoji y este es el único lugar donde
              se lee de qué modo se trata. */}
          <p className="mode-picker__description">
            <strong className="mode-picker__current">{t.modes[currentMode.id].name}</strong>
            {t.modes[currentMode.id].description}
          </p>
        </fieldset>

        <div className="lobby-settings">
          <OptionGroup
            label={t.lobby.difficulty}
            value={room.settings.difficulty}
            options={difficultyOptions}
            onChange={(difficulty) => void applySettings({ difficulty })}
            readOnly={!canEdit}
          />
          <OptionGroup
            label={t.lobby.roundsLabel}
            hint={t.lobby.roundsHint}
            value={room.settings.totalRounds}
            options={roundOptions}
            onChange={(totalRounds) => void applySettings({ totalRounds })}
            readOnly={!canEdit}
          />
          <NumberField
            label={t.lobby.flagsPerRound}
            hint={`${MIN_FLAGS_PER_ROUND}–${maxFlags}`}
            value={room.settings.flagsPerRound}
            min={MIN_FLAGS_PER_ROUND}
            max={maxFlags}
            onCommit={(flagsPerRound) => void applySettings({ flagsPerRound })}
            readOnly={!canEdit}
          />
          <OptionGroup
            label={t.lobby.secondsPerFlag}
            value={room.settings.secondsPerFlag}
            options={numberOptions(SECONDS_PER_FLAG_OPTIONS, 's')}
            onChange={(secondsPerFlag) => void applySettings({ secondsPerFlag })}
            readOnly={!canEdit}
          />
        </div>

        <p className="lobby-summary">
          {t.lobby.summary(
            totalRounds,
            flagsPerRound,
            totalFlags,
            estimatedMinutes(totalFlags, secondsPerFlag),
          )}
        </p>
      </section>

      <AdSlot placement="lobby" />

      <div className="lobby-actions">
        <Button variant="ghost" onClick={() => void handleLeave()} disabled={busy}>
          {t.common.leave}
        </Button>
        <Button
          variant="green"
          size="lg"
          icon="▶"
          disabled={!canEdit || busy}
          onClick={() => void handleStart()}
        >
          {isHost ? t.lobby.start : t.common.waitingForHost}
        </Button>
      </div>
    </main>
  );
}
