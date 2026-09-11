import { nicknameKey, validateNickname } from '@flagazo/shared';
import type { Result, TimeSyncResponse } from '@flagazo/shared';
import type { RoomManager } from '../rooms/RoomManager';
import type { GameServer, GameSocket } from '../types';
import { createLogger } from '../lib/log';
import { SessionStore } from './SessionStore';
import type { Session } from './SessionStore';
import { registerPartyHandlers } from './registerPartyHandlers';
import { roomChannel } from './partyChannel';
import { safeHandler } from './safeHandler';

const log = createLogger('socket');

/**
 * Punto de entrada de toda la comunicación en tiempo real.
 * Cada fase agrega sus handlers acá (partida en Fase 3, respuestas en Fase 4…),
 * siempre delegando la lógica en módulos propios para mantener este archivo corto.
 */
export function registerSocketHandlers(io: GameServer, sessions: SessionStore, rooms: RoomManager) {
  let presenceTimer: NodeJS.Timeout | null = null;

  /** Agrupa cambios de presencia muy seguidos en un solo broadcast. */
  function broadcastPresence() {
    if (presenceTimer) return;
    presenceTimer = setTimeout(() => {
      presenceTimer = null;
      io.emit('server:presence', { online: sessions.countOnline() });
    }, 150);
  }

  // Middleware de handshake: resuelve (o crea) la sesión antes de aceptar el socket.
  io.use((socket, next) => {
    const { session } = sessions.resolve(socket.handshake.auth?.token);
    socket.data.sessionToken = session.token;
    next();
  });

  io.on('connection', (socket: GameSocket) => {
    const session = sessions.get(socket.data.sessionToken);
    if (!session) {
      socket.disconnect(true);
      return;
    }

    sessions.attachSocket(session, socket.id);
    log.info(`+ ${session.playerId} (${session.nickname ?? 'sin nick'}) · online ${sessions.countOnline()}`);

    socket.emit('session:ready', SessionStore.toInfo(session));
    broadcastPresence();

    registerSessionHandlers(socket, session, rooms);
    registerPartyHandlers(io, socket, session, sessions, rooms);
    restoreParty(socket, session, rooms);

    socket.on('disconnect', (reason) => {
      sessions.detachSocket(session, socket.id);
      // Solo cuenta como ausencia si la sesión se quedó sin ningún socket:
      // durante una reconexión conviven el viejo y el nuevo por unos ms.
      if (session.socketIds.size === 0) rooms.setConnected(session.playerId, false);
      log.info(`- ${session.playerId} (${reason}) · online ${sessions.countOnline()}`);
      broadcastPresence();
    });
  });
}

/**
 * Reconexión con party en curso: vuelve a suscribirse al canal, se marca
 * como conectado y recibe el snapshot actual. El jugador no nota nada.
 */
function restoreParty(socket: GameSocket, session: Session, rooms: RoomManager) {
  const room = rooms.roomOf(session.playerId);
  if (!room) return;

  socket.join(roomChannel(room.code));
  rooms.setConnected(session.playerId, true);
  // setConnected solo difunde si hubo cambio; este emit garantiza que la
  // pestaña que acaba de volver reciba el estado aunque ya figurara conectada.
  socket.emit('room:state', room.toState());
}

function registerSessionHandlers(socket: GameSocket, session: Session, rooms: RoomManager) {
  socket.on(
    'session:setNickname',
    safeHandler<{ nickname?: unknown }, Result<{ nickname: string }, string>>(
      'session:setNickname',
      (payload, ack) => {
        const result = validateNickname(payload.nickname);
        if (!result.ok) {
          ack({ ok: false, error: result.error });
          return;
        }
        // Si está dentro de una party, el nombre nuevo tiene que seguir siendo único ahí.
        const renamed = rooms.rename(session.playerId, result.value, nicknameKey(result.value));
        if (!renamed.ok) {
          ack({ ok: false, error: 'TAKEN' });
          return;
        }
        session.nickname = result.value;
        log.info(`✎ ${session.playerId} ahora es "${result.value}"`);
        ack({ ok: true, data: { nickname: result.value } });
      },
      (error) => ({ ok: false, error }),
    ),
  );

  socket.on(
    'time:sync',
    safeHandler<{ clientSentAt?: unknown }, TimeSyncResponse>(
      'time:sync',
      (payload, ack) => {
        const clientSentAt = Number(payload.clientSentAt);
        ack({
          clientSentAt: Number.isFinite(clientSentAt) ? clientSentAt : 0,
          serverTime: Date.now(),
        });
      },
      () => ({ clientSentAt: 0, serverTime: Date.now() }),
    ),
  );
}
