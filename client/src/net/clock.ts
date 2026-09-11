import { ACK_TIMEOUT_MS } from '@flagazo/shared';
import type { GameSocket } from './socket';

/**
 * Sincronización de reloj con el servidor.
 *
 * El servidor anuncia instantes absolutos ("la ronda termina en T").
 * Cada cliente convierte T a su propio reloj con este desfase, así la barra
 * de tiempo se anima localmente y fluida sin recibir un mensaje por segundo.
 */
interface Sample {
  rttMs: number;
  offsetMs: number;
}

const MAX_SAMPLES = 5;
let samples: Sample[] = [];
let offsetMs = 0;

/** Hora actual estimada del servidor, en ms epoch. */
export function serverNow(): number {
  return Date.now() + offsetMs;
}

/** Mide una vez. Devuelve el ping (RTT) en ms o null si no hubo respuesta. */
export async function measureClock(socket: GameSocket): Promise<number | null> {
  const clientSentAt = Date.now();
  try {
    const { serverTime } = await socket
      .timeout(ACK_TIMEOUT_MS)
      .emitWithAck('time:sync', { clientSentAt });
    const receivedAt = Date.now();
    const rttMs = receivedAt - clientSentAt;
    // Suponemos que ida y vuelta tardan lo mismo.
    const sample = { rttMs, offsetMs: serverTime + rttMs / 2 - receivedAt };

    samples = [...samples, sample].slice(-MAX_SAMPLES);
    // La muestra con menor ping es la más confiable.
    offsetMs = samples.reduce((best, s) => (s.rttMs < best.rttMs ? s : best)).offsetMs;
    return rttMs;
  } catch {
    return null;
  }
}

export function resetClock() {
  samples = [];
}
