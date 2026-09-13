import { nicknameKey, validateNickname } from '@flagazo/shared';
import type { CommonError, Result, TimeSyncResponse } from '@flagazo/shared';
import type { PlayerAccount } from '../rooms/Room';
import type { RoomManager } from '../rooms/RoomManager';
import type { GameServer, GameSocket } from '../types';
import { createLogger } from '../lib/log';
import type { AccountResolver } from './accounts';
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
export function registerSocketHandlers(
  io: GameServer,
  sessions: SessionStore,
  rooms: RoomManager,
  accounts: AccountResolver | null = null,
) {
  let presenceTimer: NodeJS.Timeout | null = null;
  /** La cuenta que trajo cada conexión en su handshake, hasta que se conecta del todo. */
  const handshakeAccounts = new Map<string, PlayerAccount | null>();

  /** Agrupa cambios de presencia muy seguidos en un solo broadcast. */
  function broadcastPresence() {
    if (presenceTimer) return;
    presenceTimer = setTimeout(() => {
      presenceTimer = null;
      io.emit('server:presence', { online: sessions.countOnline() });
    }, 150);
  }

  // Middleware de handshake: resuelve (o crea) la sesión antes de aceptar el socket.
  io.use(async (socket, next) => {
    const { session } = sessions.resolve(socket.handshake.auth?.token);
    socket.data.sessionToken = session.token;
    /*
     * La cuenta sale de la cookie de sesión, que el navegador manda sola en el
     * handshake (misma página, mismo origen). Es la única prueba válida: el token de
     * juego viaja en sessionStorage y no dice nada de quién es la persona. Si la base
     * falla, se entra igual como invitado: nunca se deja a nadie sin jugar.
     */
    let account: PlayerAccount | null = null;
    if (accounts) {
      try {
        account = await accounts.byCookie(socket.handshake.headers.cookie);
      } catch (error) {
        log.warn('No se pudo leer la cuenta al conectar', error instanceof Error ? error.message : error);
      }
    }
    handshakeAccounts.set(socket.id, account);
    next();
  });

  io.on('connection', (socket: GameSocket) => {
    const session = sessions.get(socket.data.sessionToken);
    if (!session) {
      socket.disconnect(true);
      return;
    }

    sessions.attachSocket(session, socket.id);
    bindAccount(session, handshakeAccounts.get(socket.id) ?? null, rooms);
    handshakeAccounts.delete(socket.id);
    log.info(`+ ${session.playerId} (${session.nickname ?? 'sin nick'}) · online ${sessions.countOnline()}`);

    socket.emit('session:ready', SessionStore.toInfo(session));
    broadcastPresence();

    registerSessionHandlers(socket, session, rooms, accounts);
    registerPartyHandlers(io, socket, session, sessions, rooms);
    restoreParty(socket, session, rooms);

    socket.on('disconnect', (reason) => {
      handshakeAccounts.delete(socket.id);
      sessions.detachSocket(session, socket.id);
      // Solo cuenta como ausencia si la sesión se quedó sin ningún socket:
      // durante una reconexión conviven el viejo y el nuevo por unos ms.
      if (session.socketIds.size === 0) rooms.setConnected(session.playerId, false);
      log.info(`- ${session.playerId} (${reason}) · online ${sessions.countOnline()}`);
      broadcastPresence();
    });
  });

  return {
    /**
     * Se borró una cuenta: cada pestaña que jugaba con ella sigue con el mismo
     * nombre, como invitada, y se entera para dejar de mostrar la cuenta.
     */
    forgetAccount(userId: string) {
      for (const session of sessions.all()) {
        if (session.account?.userId !== userId) continue;
        bindAccount(session, null, rooms);
        for (const socketId of session.socketIds) io.to(socketId).emit('session:accountRemoved');
      }
    },
  };
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

/**
 * Asocia (o desasocia) la cuenta a la sesión de juego.
 *
 * Con cuenta, se juega con el username: se renombra al jugador, también dentro
 * de la sala si está en una. Si ese nombre ya lo usa otro jugador de la sala, se
 * queda con el nombre que tenía hasta la próxima sala. La foto y el "registrado"
 * se actualizan en la sala al momento.
 */
function bindAccount(session: Session, account: PlayerAccount | null, rooms: RoomManager) {
  session.account = account;
  rooms.setAccount(session.playerId, account);
  if (account && session.nickname !== account.username) {
    const renamed = rooms.rename(session.playerId, account.username, nicknameKey(account.username));
    if (renamed.ok) session.nickname = account.username;
  }
}

function registerSessionHandlers(
  socket: GameSocket,
  session: Session,
  rooms: RoomManager,
  accounts: AccountResolver | null,
) {
  socket.on(
    'session:refreshAccount',
    safeHandler<Record<string, never>, Result<{ nickname: string | null }, CommonError>>(
      'session:refreshAccount',
      async (_payload, ack) => {
        // Solo refresca la cuenta que ya tenía: no sirve para tomar otra.
        if (session.account && accounts) {
          bindAccount(session, await accounts.byId(session.account.userId), rooms);
        }
        ack({ ok: true, data: { nickname: session.nickname } });
      },
      (error) => ({ ok: false, error }),
    ),
  );

  socket.on(
    'session:signOut',
    safeHandler<Record<string, never>, Result<null, CommonError>>(
      'session:signOut',
      (_payload, ack) => {
        // Sigue jugando con el mismo nombre, pero ya como invitado.
        bindAccount(session, null, rooms);
        ack({ ok: true, data: null });
      },
      (error) => ({ ok: false, error }),
    ),
  );

  socket.on(
    'session:setNickname',
    safeHandler<{ nickname?: unknown }, Result<{ nickname: string }, string>>(
      'session:setNickname',
      (payload, ack) => {
        // Con cuenta, el nombre de juego es el username: se cambia desde el perfil.
        const result = session.account ? validateNickname(session.account.username) : validateNickname(payload.nickname);
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
