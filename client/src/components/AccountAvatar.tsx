import { useState } from 'react';
import { avatarColor, avatarInitial } from '../lib/avatar';
import './AccountAvatar.css';

interface AccountAvatarProps {
  /** Semilla del color cuando no hay foto: el id de la cuenta o del jugador. */
  seed: string;
  name: string;
  url: string | null;
  /** En px. Sin tamaño, lo decide el CSS de quien lo usa (la clase que le pasa). */
  size?: number;
  className?: string;
}

/**
 * La foto de perfil en círculo, o el círculo de color con la inicial si no hay
 * foto (o si la foto no carga: nunca queda un ícono de imagen rota).
 */
export function AccountAvatar({ seed, name, url, size, className = '' }: AccountAvatarProps) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const showImage = url && failedUrl !== url;

  return (
    <span
      className={`account-avatar ${className}`}
      style={{
        ...(size ? { width: size, height: size, fontSize: size * 0.45 } : {}),
        background: showImage ? undefined : avatarColor(seed),
      }}
      aria-hidden="true"
    >
      {showImage ? (
        <img src={url} alt="" loading="lazy" decoding="async" onError={() => setFailedUrl(url)} />
      ) : (
        avatarInitial(name)
      )}
    </span>
  );
}
