import { randomBytes } from 'node:crypto';
import { SESSION_TOKEN_LENGTH, isValidSessionToken } from '@flagazo/shared';
import type { SessionInfo } from '@flagazo/shared';
import { config } from '../config';
import type { PlayerAccount } from './accounts';

/**
 * Una sesión representa a una persona en una pestaña del navegador.
 * Sobrevive a recargas (F5), cortes de wifi y reconexiones: el cliente
 * guarda el token y lo reenvía al reconectar.
 *
 * Todo vive en memoria: si el servidor se reinicia, los clientes obtienen
 * una sesión nueva y reenvían su nickname automáticamente.
 */
export interface Session {
  token: string;
  playerId: string;
  nickname: string | null;
  /** La cuenta con la que juega, si inició sesión. Se decide al conectar, por la cookie. */
  account: PlayerAccount | null;
  /** Sockets activos de esta sesión (normalmente 0 o 1). */
  socketIds: Set<string>;
  lastSeenAt: number;
}

export class SessionStore {
  private readonly sessions = new Map<string, Session>();
  /** Índice por id público: lo usan las parties para avisarle a un jugador puntual. */
  private readonly byPlayerId = new Map<string, Session>();

  constructor(private readonly ttlMs: number) {}

  /** Recupera la sesión del token o crea una nueva si el token no existe / es inválido. */
  resolve(token: unknown): { session: Session; isNew: boolean } {
    if (isValidSessionToken(token)) {
      const existing = this.sessions.get(token);
      if (existing) return { session: existing, isNew: false };
    }
    const session: Session = {
      token: randomBytes(SESSION_TOKEN_LENGTH / 2).toString('hex'),
      playerId: randomBytes(6).toString('hex'),
      nickname: null,
      account: null,
      socketIds: new Set(),
      lastSeenAt: Date.now(),
    };
    this.sessions.set(session.token, session);
    this.byPlayerId.set(session.playerId, session);
    return { session, isNew: true };
  }

  get(token: string): Session | undefined {
    return this.sessions.get(token);
  }

  getByPlayerId(playerId: string): Session | undefined {
    return this.byPlayerId.get(playerId);
  }

  attachSocket(session: Session, socketId: string) {
    session.socketIds.add(socketId);
    session.lastSeenAt = Date.now();
  }

  detachSocket(session: Session, socketId: string) {
    session.socketIds.delete(socketId);
    session.lastSeenAt = Date.now();
  }

  /** Personas conectadas ahora mismo (sesiones con al menos un socket). */
  countOnline(): number {
    let online = 0;
    for (const session of this.sessions.values()) {
      if (session.socketIds.size > 0) online++;
    }
    return online;
  }

  /** Borra sesiones abandonadas. Devuelve cuántas se borraron. */
  sweep(now = Date.now()): number {
    let removed = 0;
    for (const [token, session] of this.sessions) {
      if (session.socketIds.size === 0 && now - session.lastSeenAt > this.ttlMs) {
        this.sessions.delete(token);
        this.byPlayerId.delete(session.playerId);
        removed++;
      }
    }
    return removed;
  }

  static toInfo(session: Session): SessionInfo {
    return {
      token: session.token,
      playerId: session.playerId,
      nickname: session.nickname,
      flagsVersion: config.flagsVersion,
    };
  }
}
