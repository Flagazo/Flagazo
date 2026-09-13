import { useAppStore } from '../store/useAppStore';
import { AccountAvatar } from './AccountAvatar';

interface PlayerAvatarProps {
  playerId: string;
  nickname: string;
  /** La clase de la pantalla que lo usa: define el tamaño y el borde. */
  className: string;
}

/**
 * El avatar de un jugador de la sala: su foto si juega con cuenta y tiene una, o
 * el círculo de color con la inicial de siempre.
 *
 * La foto sale del snapshot de la sala y no del de la partida, así los motores de
 * juego no tienen que saber nada de cuentas. Si el jugador ya se fue de la sala,
 * queda el círculo de color.
 */
export function PlayerAvatar({ playerId, nickname, className }: PlayerAvatarProps) {
  const url = useAppStore((s) => s.room?.players.find((player) => player.id === playerId)?.avatarUrl ?? null);
  return <AccountAvatar className={className} seed={playerId} name={nickname} url={url} />;
}
