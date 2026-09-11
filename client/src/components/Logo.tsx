import { GAME_NAME } from '@flagazo/shared';
import './Logo.css';

interface LogoProps {
  size?: 'sm' | 'lg';
  /** Si se pasa, el logo es un botón. Si no, es solo decoración. */
  onClick?: () => void;
  label?: string;
}

export function Logo({ size = 'lg', onClick, label }: LogoProps) {
  const content = (
    <>
      {/*
        Mismo degradé que `client/public/favicon.svg`, pero sobre la tela.
        En el favicon va en el cuadro; acá la bandera va suelta sobre el fondo del
        juego y no hay cuadro donde ponerlo. Si cambian los colores, cambiar los dos.
      */}
      <svg className="logo__flag" viewBox="0 0 64 64" aria-hidden="true">
        <defs>
          <linearGradient id="logo-cloth" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="var(--pink)" />
            <stop offset="1" stopColor="var(--orange)" />
          </linearGradient>
        </defs>
        <rect x="11" y="8" width="8" height="48" rx="4" fill="#fff" />
        <g className="logo__cloth">
          <path
            d="M19 12c8-5 15 5 23 0 3-2 6-1.5 8 0v26c-2-1.5-5-2-8 0-8 5-15-5-23 0z"
            fill="url(#logo-cloth)"
          />
        </g>
      </svg>
      {/*
        Cada letra lleva su posición: el CSS la usa para sacar su color del mismo
        degradé que el ícono, así la palabra va de rosa a naranja igual que el
        cuadro del favicon. Se pasa la posición y no el color para que los dos
        extremos sigan viviendo solo en `theme.css`.
      */}
      <span className="logo__word" aria-hidden="true">
        {[...GAME_NAME.toUpperCase()].map((letter, i, all) => (
          <span
            key={i}
            className="logo__letter"
            style={
              {
                animationDelay: `${i * 60}ms`,
                '--i': i,
                '--last': Math.max(1, all.length - 1),
              } as React.CSSProperties
            }
          >
            {letter}
          </span>
        ))}
      </span>
    </>
  );

  if (!onClick) {
    return (
      <div className={`logo logo--${size}`} role="img" aria-label={GAME_NAME}>
        {content}
      </div>
    );
  }

  return (
    <button
      type="button"
      className={`logo logo--${size} logo--button`}
      onClick={onClick}
      title={label}
      aria-label={label ?? GAME_NAME}
    >
      {content}
    </button>
  );
}
