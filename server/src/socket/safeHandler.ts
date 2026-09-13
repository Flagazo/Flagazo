import { createLogger } from '../lib/log';

const log = createLogger('socket');

/**
 * Envuelve un handler de Socket.IO para que un cliente malicioso o con bugs
 * no pueda tirar abajo el servidor:
 * - si no manda callback de ack, se usa uno vacío;
 * - si el payload no es un objeto, responde BAD_REQUEST;
 * - cualquier excepción se loguea y responde SERVER_ERROR, también si el handler
 *   es async y falla después de esperar algo (la base, por ejemplo).
 */
export function safeHandler<P extends object, R>(
  eventName: string,
  handler: (payload: P, ack: (response: R) => void) => void | Promise<void>,
  errorResponse: (code: 'BAD_REQUEST' | 'SERVER_ERROR') => R,
) {
  return (payload: unknown, maybeAck: unknown) => {
    const ack = typeof maybeAck === 'function' ? (maybeAck as (response: R) => void) : () => {};
    if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
      ack(errorResponse('BAD_REQUEST'));
      return;
    }
    const fail = (error: unknown) => {
      log.error(`Error en "${eventName}"`, error);
      ack(errorResponse('SERVER_ERROR'));
    };
    try {
      const pending = handler(payload as P, ack);
      if (pending) pending.catch(fail);
    } catch (error) {
      fail(error);
    }
  };
}
