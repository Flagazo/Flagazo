import { eq } from 'drizzle-orm';
import { avatarUrl } from '../auth/accounts';
import { parseCookies } from '../auth/cookies';
import { SESSION_COOKIE, SessionService } from '../auth/sessions';
import type { Database } from '../db/client';
import { users } from '../db/schema';
import type { PlayerAccount } from '../rooms/Room';

export type { PlayerAccount };

/**
 * Cómo averigua la capa de sockets de quién es cada conexión.
 *
 * Por cookie, al conectar: es la única prueba de que la cuenta es de quien se
 * conecta. Por id, para refrescar una cuenta que la sesión ya tenía (cambió el
 * nombre o la foto): no da acceso a nada nuevo, así que no hace falta la cookie.
 */
export interface AccountResolver {
  byCookie(cookieHeader: string | undefined): Promise<PlayerAccount | null>;
  byId(userId: string): Promise<PlayerAccount | null>;
}

export function createAccountResolver(db: Database): AccountResolver {
  const sessions = new SessionService(db);
  return {
    async byCookie(cookieHeader) {
      const session = await sessions.resolve(parseCookies(cookieHeader).get(SESSION_COOKIE));
      return session ? toPlayerAccount(session.user) : null;
    },
    async byId(userId) {
      const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
      return user ? toPlayerAccount(user) : null;
    },
  };
}

function toPlayerAccount(user: { id: string; username: string; avatarVersion: number }): PlayerAccount {
  return { userId: user.id, username: user.username, avatarUrl: avatarUrl(user) };
}
