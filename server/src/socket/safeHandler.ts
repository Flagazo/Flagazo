import { createLogger } from '../lib/log';

const log = createLogger('socket');

/**
 * Envuelve un handler de Socket.IO para que un cliente malicioso o con bugs
 * no pueda tirar abajo el servidor:
 * - si no manda callback de ack, se usa uno vacío;
 * - si el payload no es un objeto, responde BAD_REQUEST;
 * - cualquier excepción se loguea y responde SERVER_ERROR.
 */
export function safeHandler<P extends object, R>(
  eventName: string,
  handler: (payload: P, ack: (response: R) => void) => void,
  errorResponse: (code: 'BAD_REQUEST' | 'SERVER_ERROR') => R,
) {
  return (payload: unknown, maybeAck: unknown) => {
    const ack = typeof maybeAck === 'function' ? (maybeAck as (response: R) => void) : () => {};
    if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
      ack(errorResponse('BAD_REQUEST'));
      return;
    }
    try {
      handler(payload as P, ack);
    } catch (error) {
      log.error(`Error en "${eventName}"`, error);
      ack(errorResponse('SERVER_ERROR'));
    }
  };
}
