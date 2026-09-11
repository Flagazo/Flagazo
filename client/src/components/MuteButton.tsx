import { useEffect, useState } from 'react';
import { sound } from '../audio/SoundManager';
import { useT } from '../i18n';
import './MuteButton.css';

/**
 * Silenciar el juego.
 *
 * El estado vive en el SoundManager (no en el store de la partida) porque es una
 * preferencia del aparato, no del juego: se recuerda entre visitas y no tiene
 * nada que ver con lo que decida el servidor.
 */
export function MuteButton() {
  const [muted, setMuted] = useState(sound.isMuted);
  const t = useT();

  useEffect(() => sound.subscribe(setMuted), []);

  return (
    <button
      type="button"
      className="mute-btn"
      onClick={() => {
        sound.toggleMuted();
        // Un sonidito al activar: confirma que se escucha.
        if (muted) sound.play('join');
      }}
      aria-pressed={muted}
      title={muted ? t.topbar.unmute : t.topbar.mute}
      aria-label={muted ? t.topbar.unmute : t.topbar.mute}
    >
      {muted ? '🔇' : '🔊'}
    </button>
  );
}
