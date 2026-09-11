import { GAME_NAME } from '@flagazo/shared';
import { useT } from '../i18n';
import './DonateButton.css';

/**
 * A dónde lleva. Va por entorno y no en el código porque cambia según quién
 * despliegue, y así el repositorio no lleva el link de cobro de nadie.
 */
const URL = import.meta.env.VITE_DONATE_URL;

/**
 * El botón de donar.
 *
 * Está en el menú y no en la pantalla final a propósito. En la final ya hay un
 * espacio de anuncio: dos pedidos de plata en la misma pantalla, justo cuando
 * la persona acaba de perder o ganar, se siente a manotazo. Acá está siempre a
 * mano y no interrumpe nada.
 *
 * Si no hay URL configurada no se dibuja: nunca queda un botón que no lleva a
 * ningún lado.
 */
export function DonateButton() {
  const t = useT();
  if (!URL) return null;

  return (
    <a
      className="donate"
      href={URL}
      /* Se abre aparte: nadie quiere perder la sala en la que está por una donación. */
      target="_blank"
      rel="noopener noreferrer"
    >
      <span className="donate__icon" aria-hidden="true">
        ☕
      </span>
      <span className="donate__text">
        <strong>{t.donate.title(GAME_NAME)}</strong>
        <small>{t.donate.text}</small>
      </span>
      <span className="donate__cta">{t.donate.action}</span>
    </a>
  );
}
