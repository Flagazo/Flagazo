import { createHash, randomBytes } from 'node:crypto';
import { and, eq, gt, lt } from 'drizzle-orm';
import type { Database } from '../db/client';
import { authSessions, users } from '../db/schema';
import type { UserRow } from '../db/schema';

/** Nombre de la cookie. Distinto del token de juego, que sigue en sessionStorage. */
export const SESSION_COOKIE = 'flagazo_sid';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

export const SESSION_LIFETIME = {
  /** "Mantener sesión iniciada": se renueva sola mientras se use. */
  persistentMs: 30 * DAY,
  /**
   * Sin marcarlo, la cookie muere al cerrar el navegador. Pero hay navegadores que
   * restauran esas cookies al reabrir, así que el servidor le pone un tope propio.
   */
  browserMs: DAY,
  /** Cada cuánto, como mucho, se escribe el "último acceso". Evita un UPDATE por pedido. */
  touchEveryMs: HOUR,
} as const;

/** 32 bytes aleatorios: imposible de adivinar, y cabe cómodo en una cookie. */
const TOKEN_REGEX = /^[A-Za-z0-9_-]{43}$/;

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export interface ResolvedSession {
  user: UserRow;
  persistent: boolean;
  expiresAt: Date;
  /** Se extendió la vigencia: hay que volver a mandar la cookie con el vencimiento nuevo. */
  renewed: boolean;
}

export class SessionService {
  constructor(private readonly db: Database) {}

  async create(userId: string, persistent: boolean, now = new Date()) {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(
      now.getTime() + (persistent ? SESSION_LIFETIME.persistentMs : SESSION_LIFETIME.browserMs),
    );
    await this.db.insert(authSessions).values({
      tokenHash: hashToken(token),
      userId,
      persistent,
      createdAt: now,
      lastSeenAt: now,
      expiresAt,
    });
    await this.db.update(users).set({ lastSeenAt: now }).where(eq(users.id, userId));
    return { token, expiresAt, persistent };
  }

  /** La cuenta dueña del token, o null si el token no existe o venció. */
  async resolve(token: string | undefined, now = new Date()): Promise<ResolvedSession | null> {
    if (!token || !TOKEN_REGEX.test(token)) return null;
    const tokenHash = hashToken(token);

    const [row] = await this.db
      .select({ session: authSessions, user: users })
      .from(authSessions)
      .innerJoin(users, eq(users.id, authSessions.userId))
      .where(and(eq(authSessions.tokenHash, tokenHash), gt(authSessions.expiresAt, now)))
      .limit(1);
    if (!row) return null;

    const { session, user } = row;
    let expiresAt = session.expiresAt;
    let renewed = false;

    if (now.getTime() - session.lastSeenAt.getTime() >= SESSION_LIFETIME.touchEveryMs) {
      // Las persistentes se estiran 30 días desde el último uso: quien juega
      // seguido no tiene que volver a iniciar sesión nunca. Las otras mantienen su tope.
      if (session.persistent) {
        expiresAt = new Date(now.getTime() + SESSION_LIFETIME.persistentMs);
        renewed = true;
      }
      await this.db
        .update(authSessions)
        .set({ lastSeenAt: now, expiresAt })
        .where(eq(authSessions.tokenHash, tokenHash));
      await this.db.update(users).set({ lastSeenAt: now }).where(eq(users.id, user.id));
    }

    return { user, persistent: session.persistent, expiresAt, renewed };
  }

  async revoke(token: string | undefined) {
    if (!token || !TOKEN_REGEX.test(token)) return;
    await this.db.delete(authSessions).where(eq(authSessions.tokenHash, hashToken(token)));
  }

  /** Cierra todas las sesiones de una cuenta: al cambiar la contraseña, por ejemplo. */
  async revokeAll(userId: string) {
    await this.db.delete(authSessions).where(eq(authSessions.userId, userId));
  }

  /** Borra las vencidas. Devuelve cuántas. */
  async sweep(now = new Date()): Promise<number> {
    const removed = await this.db
      .delete(authSessions)
      .where(lt(authSessions.expiresAt, now))
      .returning({ tokenHash: authSessions.tokenHash });
    return removed.length;
  }
}
