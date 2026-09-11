import { GAME_NAME } from '@flagazo/shared';
import { useT } from '../i18n';
import './DonateButton.css';

/**
 * A dónde lleva.
 *
 * El valor por defecto es el de Flagazo. No es un secreto: es un botón hecho
 * justamente para que lo vea todo el mundo, así que tenerlo en el código no
 * expone nada y evita que el botón desaparezca si al desplegar no se configuró
 * nada. Antes iba solo por entorno y en el primer despliegue quedó invisible.
 *
 * `VITE_DONATE_URL` lo sigue pisando, para quien copie el proyecto y quiera
 * apuntarlo a su propia página de cobro.
 */
const URL = import.meta.env.VITE_DONATE_URL ?? 'https://ko-fi.com/flagazo';

/**
 * El botón de donar.
 *
 * Está en el menú y no en la pantalla final a propósito. En la final ya hay un
 * espacio de anuncio: dos pedidos de plata en la misma pantalla, justo cuando
 * la persona acaba de perder o ganar, se siente a manotazo. Acá está siempre a
 * mano y no interrumpe nada.
 *
 * Con `VITE_DONATE_URL` en vacío no se dibuja, que es la forma de sacarlo sin
 * tocar el código: nunca queda un botón que no lleva a ningún lado.
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
