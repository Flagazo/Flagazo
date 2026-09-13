import { and, eq } from 'drizzle-orm';
import {
  OAUTH_PROVIDERS,
  USERNAME_MAX_LENGTH,
  USERNAME_MIN_LENGTH,
  emailKey,
  nicknameKey,
  sanitizeNickname,
  validateEmail,
  validateUsername,
} from '@flagazo/shared';
import type { OAuthError, OAuthProvider } from '@flagazo/shared';
import type { Database } from '../db/client';
import { authIdentities, authSessions, users } from '../db/schema';
import type { UserRow } from '../db/schema';
import type { OAuthProfile } from './oauth';

export interface LinkedProviders {
  providers: OAuthProvider[];
  providerAvatars: OAuthProvider[];
}

export type IdentityResult =
  | { ok: true; user: UserRow; created: boolean; linked: boolean }
  | { ok: false; error: OAuthError };

/**
 * Qué cuenta de Flagazo corresponde a quien vuelve de Google o Discord.
 *
 * Reglas, en orden:
 * 1. Ese Google/Discord ya está vinculado → esa cuenta.
 * 2. El proveedor **garantiza** el email y hay una cuenta con ese email → se vinculan.
 *    Si esa cuenta nunca verificó su email, quien la creó no demostró que el email
 *    fuera suyo; el proveedor sí. Se le borra la contraseña y se cierran sus
 *    sesiones: así nadie puede registrar un email ajeno y esperar adentro a que el
 *    dueño llegue con Google ("pre-hijacking").
 * 3. Hay una cuenta con ese email pero el proveedor **no** lo garantiza → no se
 *    vincula ni se crea un duplicado: tiene que entrar con su contraseña.
 * 4. Si no, cuenta nueva. Con email solo si está verificado.
 */
export class IdentityService {
  constructor(private readonly db: Database) {}

  async signIn(provider: OAuthProvider, profile: OAuthProfile, now = new Date()): Promise<IdentityResult> {
    // Reintentos: si dos pestañas vuelven del proveedor a la vez, la segunda
    // choca con el índice único y en la vuelta siguiente encuentra lo que creó la primera.
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.signInOnce(provider, profile, now);
      } catch (error) {
        if (!isUniqueViolation(error) || attempt === 2) throw error;
      }
    }
    throw new Error('inalcanzable');
  }

  /** Vincula el proveedor a una cuenta con sesión iniciada (desde el perfil). */
  async link(userId: string, provider: OAuthProvider, profile: OAuthProfile, now = new Date()): Promise<IdentityResult> {
    const user = await this.db.query.users.findFirst({ where: eq(users.id, userId) });
    if (!user) return { ok: false, error: 'OAUTH_STATE' };

    const existing = await this.findIdentity(provider, profile.providerUserId);
    if (existing) {
      if (existing.userId !== userId) return { ok: false, error: 'OAUTH_ALREADY_LINKED' };
      await this.touch(existing.id, profile, now);
      return { ok: true, user, created: false, linked: false };
    }
    try {
      await this.insertIdentity(this.db, userId, provider, profile, now);
    } catch (error) {
      // Ya tiene otro Google (u otro Discord) vinculado.
      if (isUniqueViolation(error)) return { ok: false, error: 'OAUTH_ALREADY_LINKED' };
      throw error;
    }
    return { ok: true, user, created: false, linked: true };
  }

  /** Los proveedores vinculados a una cuenta, y cuáles tienen foto para ofrecer. */
  async linkedOf(userId: string): Promise<LinkedProviders> {
    const rows = await this.db
      .select({ provider: authIdentities.provider, avatarUrl: authIdentities.avatarUrl })
      .from(authIdentities)
      .where(eq(authIdentities.userId, userId));
    // Siempre en el mismo orden que los botones.
    return {
      providers: OAUTH_PROVIDERS.filter((id) => rows.some((row) => row.provider === id)),
      providerAvatars: OAUTH_PROVIDERS.filter((id) => rows.some((row) => row.provider === id && row.avatarUrl)),
    };
  }

  private async signInOnce(provider: OAuthProvider, profile: OAuthProfile, now: Date): Promise<IdentityResult> {
    // 1. Ya vinculado.
    const identity = await this.findIdentity(provider, profile.providerUserId);
    if (identity) {
      const user = await this.db.query.users.findFirst({ where: eq(users.id, identity.userId) });
      if (!user) throw new Error('identidad sin usuario');
      await this.touch(identity.id, profile, now);
      await this.db.update(users).set({ lastSeenAt: now }).where(eq(users.id, user.id));
      return { ok: true, user, created: false, linked: false };
    }

    const email = profile.email ? validateEmail(profile.email) : null;
    const mailKey = email?.ok ? emailKey(email.value) : null;
    const owner = mailKey ? await this.db.query.users.findFirst({ where: eq(users.emailKey, mailKey) }) : undefined;

    if (owner) {
      // 3. El email coincide, pero nadie garantiza que sea de quien entra.
      if (!profile.emailVerified) return { ok: false, error: 'OAUTH_EMAIL_IN_USE' };
      // Esa cuenta ya tiene otro Google (u otro Discord): no se reemplaza en silencio.
      const other = await this.db.query.authIdentities.findFirst({
        where: and(eq(authIdentities.userId, owner.id), eq(authIdentities.provider, provider)),
      });
      if (other) return { ok: false, error: 'OAUTH_ALREADY_LINKED' };

      // 2. Email garantizado por el proveedor: se vincula.
      const user = await this.db.transaction(async (tx) => {
        let row = owner;
        if (!owner.emailVerifiedAt) {
          const [updated] = await tx
            .update(users)
            .set({ emailVerifiedAt: now, passwordHash: null, updatedAt: now })
            .where(eq(users.id, owner.id))
            .returning();
          row = updated!;
          // Quien había registrado ese email sin verificarlo queda afuera.
          await tx.delete(authSessions).where(eq(authSessions.userId, owner.id));
        }
        await this.insertIdentity(tx, owner.id, provider, profile, now);
        return row;
      });
      await this.db.update(users).set({ lastSeenAt: now }).where(eq(users.id, user.id));
      return { ok: true, user, created: false, linked: true };
    }

    // 4. Cuenta nueva.
    const keepEmail = Boolean(mailKey && profile.emailVerified && email?.ok);
    const username = await this.availableUsername(profile.displayName, profile.email);
    const user = await this.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(users)
        .values({
          username,
          usernameKey: nicknameKey(username),
          email: keepEmail && email?.ok ? email.value : null,
          emailKey: keepEmail ? mailKey : null,
          emailVerifiedAt: keepEmail ? now : null,
          passwordHash: null,
          lastSeenAt: now,
        })
        .returning();
      await this.insertIdentity(tx, created!.id, provider, profile, now);
      return created!;
    });
    return { ok: true, user, created: true, linked: true };
  }

  /**
   * Un username libre a partir del nombre del proveedor.
   *
   * Se limpia para que cumpla las reglas del nickname (el nombre de Discord puede
   * tener emojis, el de Google puede ser larguísimo) y, si está ocupado, se le
   * agrega un número. El jugador lo puede cambiar después desde el perfil.
   */
  async availableUsername(displayName: string | null, email: string | null): Promise<string> {
    const base = usernameBase(displayName) ?? usernameBase(email?.split('@')[0] ?? null) ?? 'Jugador';
    for (let n = 1; n < 60; n++) {
      const suffix = n === 1 ? '' : String(n);
      const candidate = `${base.slice(0, USERNAME_MAX_LENGTH - suffix.length).trimEnd()}${suffix}`;
      if (!validateUsername(candidate).ok) continue;
      const taken = await this.db.query.users.findFirst({ where: eq(users.usernameKey, nicknameKey(candidate)) });
      if (!taken) return candidate;
    }
    return `Jugador${Math.floor(1000 + Math.random() * 9000)}`;
  }

  private findIdentity(provider: OAuthProvider, providerUserId: string) {
    return this.db.query.authIdentities.findFirst({
      where: and(eq(authIdentities.provider, provider), eq(authIdentities.providerUserId, providerUserId)),
    });
  }

  private async touch(identityId: string, profile: OAuthProfile, now: Date) {
    await this.db
      .update(authIdentities)
      .set({
        email: profile.email,
        emailVerified: profile.emailVerified,
        displayName: profile.displayName,
        avatarUrl: profile.avatarUrl,
        lastUsedAt: now,
      })
      .where(eq(authIdentities.id, identityId));
  }

  private async insertIdentity(
    db: Pick<Database, 'insert'>,
    userId: string,
    provider: OAuthProvider,
    profile: OAuthProfile,
    now: Date,
  ) {
    await db.insert(authIdentities).values({
      userId,
      provider,
      providerUserId: profile.providerUserId,
      email: profile.email,
      emailVerified: profile.emailVerified,
      displayName: profile.displayName,
      avatarUrl: profile.avatarUrl,
      createdAt: now,
      lastUsedAt: now,
    });
  }
}

/** El nombre del proveedor llevado a las reglas del username, o null si no queda nada usable. */
export function usernameBase(raw: string | null): string | null {
  if (!raw) return null;
  const cleaned = sanitizeNickname(raw.replace(/[^\p{L}\p{M}\p{N} _.-]+/gu, ' ')).slice(0, USERNAME_MAX_LENGTH).trim();
  if ([...cleaned].length < USERNAME_MIN_LENGTH) return null;
  return validateUsername(cleaned).ok ? cleaned : null;
}

function isUniqueViolation(error: unknown): boolean {
  let current = error;
  for (let depth = 0; depth < 4 && current && typeof current === 'object'; depth++) {
    if ((current as { code?: unknown }).code === '23505') return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}
