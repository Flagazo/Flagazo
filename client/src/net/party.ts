import { ACK_TIMEOUT_MS } from '@flagazo/shared';
import type {
  AnswerFeedback,
  GameSettings,
  PartyVisibility,
  PublicParty,
} from '@flagazo/shared';
import { t } from '../i18n';
import { useAppStore } from '../store/useAppStore';
import { socket } from './socket';

/**
 * Intenciones de party que el cliente le manda al servidor.
 *
 * Ninguna cambia el estado local: el store se actualiza cuando llega
 * `room:state`. Así lo que se ve en pantalla siempre es lo que el servidor
 * considera verdadero, incluso si dos personas tocan algo a la vez.
 */
export type ActionResult = { ok: true } | { ok: false; error: string };

const OK: ActionResult = { ok: true };

/** Traduce cualquier ack a un resultado simple; un timeout también es un error. */
async function run(send: () => Promise<{ ok: boolean; error?: string }>): Promise<ActionResult> {
  try {
    const response = await send();
    return response.ok ? OK : { ok: false, error: response.error ?? 'SERVER_ERROR' };
  } catch {
    return { ok: false, error: 'TIMEOUT' };
  }
}

const withTimeout = () => socket.timeout(ACK_TIMEOUT_MS);

export function createParty(visibility: PartyVisibility): Promise<ActionResult> {
  return run(() => withTimeout().emitWithAck('party:create', { visibility }));
}

export function setVisibility(visibility: PartyVisibility): Promise<ActionResult> {
  return run(() => withTimeout().emitWithAck('party:setVisibility', { visibility }));
}

export type ListResult =
  | { ok: true; parties: PublicParty[] }
  | { ok: false; error: string };

/**
 * Las parties públicas del momento.
 *
 * Se pide de nuevo cada vez que hace falta en vez de suscribirse: la lista se
 * mira unos segundos y se abandona, y un canal de novedades por cada persona
 * parada en el buscador costaría más de lo que ahorra.
 */
export async function listPublicParties(): Promise<ListResult> {
  try {
    const response = await withTimeout().emitWithAck('party:list', {});
    if (!response.ok) return { ok: false, error: response.error };
    return { ok: true, parties: response.data.parties };
  } catch {
    return { ok: false, error: 'TIMEOUT' };
  }
}

export function joinParty(code: string): Promise<ActionResult> {
  return run(() => withTimeout().emitWithAck('party:join', { code }));
}

export function leaveParty(): Promise<ActionResult> {
  return run(() => withTimeout().emitWithAck('party:leave', {}));
}

export function kickPlayer(playerId: string): Promise<ActionResult> {
  return run(() => withTimeout().emitWithAck('party:kick', { playerId }));
}

export function updateSettings(patch: Partial<GameSettings>): Promise<ActionResult> {
  return run(() => withTimeout().emitWithAck('party:updateSettings', { settings: patch }));
}

/** Copia el código al portapapeles. Devuelve false si el navegador no lo permite. */
export async function copyPartyCode(code: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(code);
    useAppStore.getState().pushToast(t().lobby.codeCopied, 'success');
    return true;
  } catch {
    useAppStore.getState().pushToast(t().lobby.copyFailed, 'error');
    return false;
  }
}

// ── Partida ─────────────────────────────────────────────────

export function startGame(): Promise<ActionResult> {
  return run(() => withTimeout().emitWithAck('game:start', {}));
}

export function rematch(): Promise<ActionResult> {
  return run(() => withTimeout().emitWithAck('game:rematch', {}));
}

export type AnswerResult =
  | { ok: true; feedback: AnswerFeedback }
  | { ok: false; error: string };

/**
 * Manda una respuesta. El veredicto es privado: solo lo ve quien respondió,
 * y el resto se entera recién en la revelación.
 */
export async function sendAnswer(text: string): Promise<AnswerResult> {
  try {
    const response = await withTimeout().emitWithAck('game:answer', { text });
    if (!response.ok) return { ok: false, error: response.error };
    return { ok: true, feedback: response.data };
  } catch {
    return { ok: false, error: 'TIMEOUT' };
  }
}
