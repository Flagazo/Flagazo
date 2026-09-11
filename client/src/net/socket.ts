import { io } from 'socket.io-client';
import type { Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@flagazo/shared';
import { storage } from '../lib/storage';

export type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

/**
 * Socket único de la aplicación. Se conecta al mismo origen que sirve la página:
 * en desarrollo Vite lo reenvía al servidor (proxy), en producción es el mismo servidor.
 *
 * `auth` es una función para que en cada reconexión se envíe el token más reciente.
 */
export const socket: GameSocket = io({
  autoConnect: false,
  auth: (cb) => cb({ token: storage.getSessionToken() }),
  reconnectionDelay: 500,
  reconnectionDelayMax: 4000,
});
