import { useT } from '../i18n';
import { useAppStore } from '../store/useAppStore';

/**
 * Los que entraron con la partida ya empezada.
 *
 * Están en la party pero no en la partida, así que no aparecen en la tabla:
 * sin esto no habría ninguna señal de que están ahí esperando. Lo usan las
 * pantallas de los dos juegos; los estilos viven en `GameScreen.css`.
 */
export function WaitingPlayers() {
  // Se selecciona el array tal cual y se filtra afuera: un selector que devuelve
  // un array nuevo en cada llamada hace que zustand vea siempre un cambio y
  // entre en un bucle de renders.
  const players = useAppStore((s) => s.room?.players);
  const t = useT();
  const waiting = players?.filter((player) => player.waiting) ?? [];
  if (waiting.length === 0) return null;

  return (
    <p className="standings__waiting">
      <span className="standings__waiting-label">{t.game.playingNext}</span>
      {waiting.map((player) => player.nickname).join(', ')}
    </p>
  );
}
