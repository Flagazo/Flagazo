import { ACK_TIMEOUT_MS, TIME_SYNC_INTERVAL_MS } from '@flagazo/shared';
import type { LeaveReason, RoomState } from '@flagazo/shared';
import { t } from '../i18n';
import { storage } from '../lib/storage';
import { useAppStore } from '../store/useAppStore';
import type { ToastTone } from '../store/useAppStore';
import { measureClock, resetClock } from './clock';
import { socket } from './socket';

let syncTimer: ReturnType<typeof setInterval> | null = null;
let initialized = false;
let receivedFirstSession = false;

async function runClockSync() {
  const pingMs = await measureClock(socket);
  if (pingMs !== null) useAppStore.getState().setConnection({ pingMs });
}

function startClockSync() {
  stopClockSync();
  void runClockSync();
  syncTimer = setInterval(runClockSync, TIME_SYNC_INTERVAL_MS);
}

function stopClockSync() {
  if (syncTimer) clearInterval(syncTimer);
  syncTimer = null;
}

/** Conecta el socket y traduce los eventos del servidor al store. Se llama una sola vez. */
export function initConnection() {
  if (initialized) return;
  initialized = true;
  const store = useAppStore.getState;

  socket.on('connect', () => {
    store().setConnection({ status: 'connected' });
    startClockSync();
  });

  socket.on('disconnect', (reason) => {
    stopClockSync();
    resetClock();
    // "io server disconnect" = el servidor nos cerró a propósito: no reintenta solo.
    if (reason === 'io server disconnect') {
      store().setConnection({ status: 'offline', pingMs: null });
    } else {
      store().setConnection({ status: 'reconnecting', pingMs: null });
    }
  });

  socket.on('connect_error', () => {
    const { status } = store().connection;
    store().setConnection({ status: status === 'connecting' ? 'connecting' : 'reconnecting' });
  });

  socket.on('session:ready', async (session) => {
    storage.setSessionToken(session.token);
    store().setFlagsVersion(session.flagsVersion);
    const localNickname = store().session.nickname;
    store().setSession({ playerId: session.playerId });

    const isFirstSession = !receivedFirstSession;
    receivedFirstSession = true;

    if (session.nickname) {
      store().setSession({ nickname: session.nickname });
      // Recarga de página con sesión viva (F5): directo al menú.
      if (isFirstSession && store().screen === 'nickname') store().goTo('menu');
      return;
    }

    if (localNickname) {
      // El servidor se reinició y perdió la sesión: reenviamos el nickname en silencio.
      const result = await submitNickname(localNickname);
      if (!result.ok) store().goTo('nickname');
    }
  });

  socket.on('server:presence', ({ online }) => {
    store().setConnection({ online });
  });

  socket.on('room:state', (room) => {
    announceRoomChanges(room);
    store().setRoom(room);
    // La pantalla la decide el servidor: si hay partida en curso, se juega.
    const target = room.game ? 'game' : 'lobby';
    if (store().screen !== target) store().goTo(target);
  });

  socket.on('room:left', ({ reason }) => {
    resetRoomTracking();
    store().setRoom(null);
    store().goTo('menu');
    const message = leaveMessage(reason);
    if (message) store().pushToast(message.text, message.tone);
  });

  socket.connect();
}

/**
 * Por qué se salió de la party, en palabras.
 *
 * Es una función y no una constante porque el texto se arma en el momento de
 * mostrarlo: si fuera constante quedaría fijado en el idioma que había cuando
 * se cargó el módulo.
 */
function leaveMessage(reason: LeaveReason): { text: string; tone: ToastTone } | null {
  const toasts = t().toasts;
  switch (reason) {
    // Irse fue decisión propia: no hace falta avisar nada.
    case 'left':
      return null;
    case 'kicked':
      return { text: toasts.kickedYou, tone: 'error' };
    case 'closed':
      return { text: toasts.partyClosed, tone: 'info' };
    case 'timeout':
      return { text: toasts.inactive, tone: 'info' };
  }
}

// ── Avisos de entradas y salidas ────────────────────────────
// El servidor manda snapshots completos, así que las novedades se deducen
// comparando con el snapshot anterior en vez de agregar eventos al protocolo.

let trackedCode: string | null = null;
let trackedPlayers = new Map<string, string>();
let trackedHostId: string | null = null;

function resetRoomTracking() {
  trackedCode = null;
  trackedPlayers = new Map();
  trackedHostId = null;
}

function announceRoomChanges(room: RoomState) {
  const store = useAppStore.getState;
  const players = new Map(room.players.map((p) => [p.id, p.nickname]));
  const myId = store().session.playerId;

  // Party nueva (o recién restaurada tras reconectar): no hay nada que comparar.
  if (trackedCode !== room.code) {
    trackedCode = room.code;
    trackedPlayers = players;
    trackedHostId = room.hostId;
    return;
  }

  for (const [id, nickname] of players) {
    if (id !== myId && !trackedPlayers.has(id)) store().pushToast(t().toasts.joined(nickname), 'success');
  }
  for (const [id, nickname] of trackedPlayers) {
    if (id !== myId && !players.has(id)) store().pushToast(t().toasts.left(nickname), 'info');
  }
  if (room.hostId !== trackedHostId && players.has(room.hostId)) {
    const toasts = t().toasts;
    store().pushToast(
      room.hostId === myId ? toasts.youAreHost : toasts.isHost(players.get(room.hostId)!),
      'info',
    );
  }

  trackedPlayers = players;
  trackedHostId = room.hostId;
}

export type SubmitResult = { ok: true; nickname: string } | { ok: false; error: string };

export async function submitNickname(nickname: string): Promise<SubmitResult> {
  try {
    const response = await socket
      .timeout(ACK_TIMEOUT_MS)
      .emitWithAck('session:setNickname', { nickname });
    if (!response.ok) return { ok: false, error: response.error };

    storage.setNickname(response.data.nickname);
    useAppStore.getState().setSession({ nickname: response.data.nickname });
    return { ok: true, nickname: response.data.nickname };
  } catch {
    return { ok: false, error: 'TIMEOUT' };
  }
}
