import { useEffect, useRef, useState } from 'react';
import { serverNow } from '../net/clock';

/**
 * Animación del tiempo contra el reloj del servidor.
 *
 * El servidor manda instantes absolutos ("esta bandera termina en T") y cada
 * cliente los traduce con el desfase que midió en `time:sync`. Así la barra
 * corre suave a 60 fps sin recibir un mensaje por segundo, y dos personas con
 * relojes distintos ven lo mismo.
 */

/** Fracción transcurrida entre dos instantes, de 0 a 1. */
export function useProgress(startsAt: number, endsAt: number): number {
  const [progress, setProgress] = useState(() => progressAt(startsAt, endsAt));
  const ventana = useRef({ startsAt, endsAt });

  /*
   * Ajuste durante el render, no en un efecto.
   *
   * Cuando empieza una bandera nueva, el valor guardado todavía es el de la
   * anterior (≈1, o sea "terminada") hasta el próximo frame. Con los modos que
   * se aclaran con el tiempo, ese frame mostraba la bandera casi nítida: un
   * parpadeo corto, pero suficiente para leerla y arruinar el modo.
   */
  if (ventana.current.startsAt !== startsAt || ventana.current.endsAt !== endsAt) {
    ventana.current = { startsAt, endsAt };
    setProgress(progressAt(startsAt, endsAt));
  }

  useEffect(() => {
    let frame = 0;
    const tick = () => {
      setProgress(progressAt(startsAt, endsAt));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [startsAt, endsAt]);

  return progress;
}

function progressAt(startsAt: number, endsAt: number): number {
  const total = endsAt - startsAt;
  if (total <= 0) return 1;
  return Math.min(1, Math.max(0, (serverNow() - startsAt) / total));
}

/**
 * Segundos que faltan, redondeados hacia arriba.
 * Solo dispara un render cuando cambia el número, no en cada frame.
 */
export function useSecondsLeft(endsAt: number): number {
  const [seconds, setSeconds] = useState(() => secondsAt(endsAt));
  const latest = useRef(seconds);
  const ventana = useRef(endsAt);

  // Mismo motivo que en useProgress: al cambiar de fase, el número viejo ya no vale.
  if (ventana.current !== endsAt) {
    ventana.current = endsAt;
    const ahora = secondsAt(endsAt);
    latest.current = ahora;
    setSeconds(ahora);
  }

  useEffect(() => {
    let frame = 0;
    const tick = () => {
      const next = secondsAt(endsAt);
      if (next !== latest.current) {
        latest.current = next;
        setSeconds(next);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [endsAt]);

  return seconds;
}

function secondsAt(endsAt: number): number {
  return Math.max(0, Math.ceil((endsAt - serverNow()) / 1000));
}
