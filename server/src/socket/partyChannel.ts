import { RoomManager } from '../rooms/RoomManager';
import type { Room } from '../rooms/Room';
import type { GameServer, GameSocket } from '../types';
import type { SessionStore } from './SessionStore';

/**
 * Puente entre las parties (que no saben nada de red) y Socket.IO.
 *
 * Cada party tiene una "room" de Socket.IO propia, así un cambio de estado
 * se difunde a sus miembros con un solo emit y sin recorrer sockets a mano.
 */
export const roomChannel = (code: string) => `room:${code}`;

/**
 * Sockets vivos de un jugador. Normalmente es uno solo, pero durante una
 * reconexión pueden convivir dos por unos milisegundos.
 */
export function socketsOf(io: GameServer, sessions: SessionStore, playerId: string): GameSocket[] {
  const session = sessions.getByPlayerId(playerId);
  if (!session) return [];
  const sockets: GameSocket[] = [];
  for (const socketId of session.socketIds) {
    const socket = io.sockets.sockets.get(socketId);
    if (socket) sockets.push(socket);
  }
  return sockets;
}

/**
 * Suscribe todos los sockets del jugador al canal de la party y le manda el
 * estado actual.
 *
 * El envío directo no es opcional: cuando alguien crea o entra a una party, el
 * broadcast de `room:state` ya salió mientras sus sockets todavía no estaban en
 * el canal, así que sin este emit el recién llegado se quedaría sin snapshot.
 */
export function joinChannel(io: GameServer, sessions: SessionStore, playerId: string, room: Room) {
  const state = room.toState();
  for (const socket of socketsOf(io, sessions, playerId)) {
    socket.join(roomChannel(room.code));
    socket.emit('room:state', state);
  }
}

export function createRoomManager(io: GameServer, sessions: SessionStore): RoomManager {
  return new RoomManager({
    onState(room) {
      io.to(roomChannel(room.code)).emit('room:state', room.toState());
    },
    onPlayerRemoved(playerId, code, reason) {
      for (const socket of socketsOf(io, sessions, playerId)) {
        socket.leave(roomChannel(code));
        socket.emit('room:left', { code, reason });
      }
    },
  });
}
