import { and, eq, isNotNull, isNull, lt } from 'drizzle-orm';
import {
  emailKey,
  nicknameKey,
  validateEmail,
  validatePassword,
  validateUsername,
} from '@flagazo/shared';
import type { AccountInfo, AuthError, EmailLocale } from '@flagazo/shared';
import type { Database } from '../db/client';
import { users } from '../db/schema';
import type { UserRow } from '../db/schema';
import type { Mailer } from '../email/mailer';
import { sendInBackground } from '../email/mailer';
import { accountExistsEmail, passwordResetEmail, verificationEmail } from '../email/templates';
import { CodeService } from './codes';
import type { LinkedProviders } from './identities';
import { burnPasswordCheck, hashPassword, isCommonPassword, verifyPassword } from './passwords';
import { RateLimiter } from './rateLimit';

export interface AccountFailure {
  error: AuthError;
  field?: 'username' | 'email' | 'password' | 'code';
  reason?: string;
}

export type AccountResult<T> = { ok: true; value: T } | ({ ok: false } & AccountFailure);

const fail = (failure: AccountFailure): { ok: false } & AccountFailure => ({ ok: false, ...failure });

/** Una cuenta que nunca verificó su email se borra pasado este tiempo, y libera el nombre. */
export const UNVERIFIED_ACCOUNT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface AccountDeps {
  db: Database;
  mailer: Mailer;
  /** Secreto para los HMAC de los códigos. */
  secret: string;
  /** Huso horario que define en qué mes cae cada partida del ranking. Por defecto, UTC. */
  statsTimeZone?: string;
}

/**
 * Reglas de negocio de las cuentas, sin nada de HTTP.
 *
 * Las rutas traducen pedidos a llamadas de esta clase, igual que los handlers de
 * socket hacen con el RoomManager. Así se prueba sin levantar un servidor.
 *
 * Criterio contra la enumeración de cuentas: lo que cualquiera puede pedir con
 * solo un email (registrarse, reenviar un código, recuperar la contraseña)
 * responde siempre lo mismo. Lo distinto se dice por email, al dueño del email.
 */
export class AccountService {
  private readonly db: Database;
  private readonly mailer: Mailer;
  readonly codes: CodeService;
  /** Un aviso de "ya tienes cuenta" por hora como mucho: que el registro no sirva para spamear a alguien. */
  private readonly existsNotices = new RateLimiter(1, 60 * 60 * 1000);

  constructor(deps: AccountDeps) {
    this.db = deps.db;
    this.mailer = deps.mailer;
    this.codes = new CodeService(deps.db, deps.secret);
  }

  // ── Registro y verificación ───────────────────────────────

  async register(
    input: { username?: unknown; email?: unknown; password?: unknown },
    locale: EmailLocale,
  ): Promise<AccountResult<{ email: string }>> {
    const username = validateUsername(input.username);
    if (!username.ok) return fail({ error: 'USERNAME_INVALID', field: 'username', reason: username.error });

    const email = validateEmail(input.email);
    if (!email.ok) return fail({ error: 'EMAIL_INVALID', field: 'email', reason: email.error });

    const password = validatePassword(input.password, { email: email.value, username: username.value });
    if (!password.ok) return fail({ error: 'PASSWORD_INVALID', field: 'password', reason: password.error });
    if (isCommonPassword(password.value)) return fail({ error: 'PASSWORD_TOO_COMMON', field: 'password' });

    const usernameKey = nicknameKey(username.value);
    const mailKey = emailKey(email.value);

    // El username es público (se ve en las salas y en el ranking): decir que está
    // ocupado no revela nada que no se pueda ver jugando.
    if (await this.findByUsernameKey(usernameKey)) return fail({ error: 'USERNAME_TAKEN', field: 'username' });

    const existing = await this.findByEmail(mailKey);
    if (existing) {
      // Mismo trabajo que una cuenta nueva, para tardar parecido.
      await burnPasswordCheck(password.value);
      if (this.existsNotices.hit(mailKey).ok) {
        sendInBackground(this.mailer, accountExistsEmail(existing.email ?? email.value, locale));
      }
      return { ok: true, value: { email: email.value } };
    }

    const passwordHash = await hashPassword(password.value);
    let user: UserRow;
    try {
      const [inserted] = await this.db
        .insert(users)
        .values({ username: username.value, usernameKey, email: email.value, emailKey: mailKey, passwordHash })
        .returning();
      user = inserted!;
    } catch (error) {
      const constraint = uniqueViolation(error);
      // Dos registros simultáneos con el mismo nombre: el índice único deja entrar a uno solo.
      if (constraint === 'users_username_key_unique') return fail({ error: 'USERNAME_TAKEN', field: 'username' });
      // Con el mismo email: el que pierde la carrera recibe la respuesta de siempre.
      if (constraint === 'users_email_key_unique') return { ok: true, value: { email: email.value } };
      throw error;
    }

    await this.sendCode(user, 'verify_email', locale);
    return { ok: true, value: { email: email.value } };
  }

  /**
   * Comprueba el código de verificación y, si está bien, deja la cuenta verificada.
   *
   * Los errores distintos (vencido, bloqueado) solo aparecen si hay un código
   * pendiente para ese email, es decir, si alguien se registró con él y todavía
   * no lo verificó. Es una filtración chica y aceptada: sin eso no se le puede
   * decir a nadie "tu código venció, pedí otro".
   */
  async verifyEmail(input: { email?: unknown; code?: unknown }): Promise<AccountResult<UserRow>> {
    const target = await this.userFromInput(input.email);
    const code = typeof input.code === 'string' ? input.code.trim() : '';
    if (!target) return fail({ error: 'CODE_INVALID', field: 'code' });

    if (target.emailVerifiedAt) {
      // Doble clic, o volvió a la pantalla: si trae el código que ya se usó, se le
      // dice que ya está. Con cualquier otro código, lo mismo que a un desconocido.
      return (await this.codes.matchesConsumed(target.id, 'verify_email', code))
        ? fail({ error: 'ALREADY_VERIFIED' })
        : fail({ error: 'CODE_INVALID', field: 'code' });
    }

    const check = await this.codes.check(target.id, 'verify_email', code);
    if (check !== 'ok') return codeFailure(check);

    const [verified] = await this.db
      .update(users)
      .set({ emailVerifiedAt: new Date(), updatedAt: new Date() })
      .where(eq(users.id, target.id))
      .returning();
    return { ok: true, value: verified! };
  }

  /** Pide un código de verificación nuevo. No dice nada de si la cuenta existe. */
  async resendVerification(rawEmail: unknown, locale: EmailLocale): Promise<void> {
    const target = await this.userFromInput(rawEmail);
    if (!target || target.emailVerifiedAt) return;
    await this.sendCode(target, 'verify_email', locale);
  }

  // ── Login ─────────────────────────────────────────────────

  /**
   * Email y contraseña. Cualquier falla responde lo mismo, exista o no la cuenta,
   * y tarda lo mismo: el login no tiene que servir para descubrir emails.
   *
   * Con la contraseña correcta y el email sin verificar sí se dice, porque quien
   * sabe la contraseña ya es el dueño: se le manda un código y se le pide.
   */
  async login(input: { email?: unknown; password?: unknown }, locale: EmailLocale): Promise<AccountResult<UserRow>> {
    const password = typeof input.password === 'string' ? input.password : '';
    const email = validateEmail(input.email);
    const tooLong = password.length > 1024;

    const user = email.ok && !tooLong ? await this.findByEmail(emailKey(email.value)) : undefined;
    if (!user?.passwordHash) {
      if (!tooLong) await burnPasswordCheck(password);
      return fail({ error: 'INVALID_CREDENTIALS' });
    }
    if (!(await verifyPassword(user.passwordHash, password))) return fail({ error: 'INVALID_CREDENTIALS' });

    if (!user.emailVerifiedAt) {
      await this.sendCode(user, 'verify_email', locale);
      return fail({ error: 'EMAIL_NOT_VERIFIED' });
    }
    return { ok: true, value: user };
  }

  // ── Recuperar la contraseña ───────────────────────────────

  /** Manda un código para elegir contraseña nueva, si la cuenta existe. Responde igual siempre. */
  async forgotPassword(rawEmail: unknown, locale: EmailLocale): Promise<void> {
    const target = await this.userFromInput(rawEmail);
    if (!target) return;
    await this.sendCode(target, 'reset_password', locale);
  }

  /**
   * Cambia la contraseña con el código del email.
   *
   * Tener el código prueba que el email es suyo, así que además la cuenta queda
   * verificada. Quien llama tiene que cerrar todas las sesiones anteriores: si
   * alguien había entrado con la contraseña vieja, se queda afuera.
   */
  async resetPassword(input: { email?: unknown; code?: unknown; password?: unknown }): Promise<AccountResult<UserRow>> {
    const target = await this.userFromInput(input.email);
    const code = typeof input.code === 'string' ? input.code.trim() : '';

    const password = validatePassword(input.password, {
      email: target?.email ?? undefined,
      username: target?.username,
    });
    if (!password.ok) return fail({ error: 'PASSWORD_INVALID', field: 'password', reason: password.error });
    if (isCommonPassword(password.value)) return fail({ error: 'PASSWORD_TOO_COMMON', field: 'password' });
    if (!target) return fail({ error: 'CODE_INVALID', field: 'code' });

    const check = await this.codes.check(target.id, 'reset_password', code);
    if (check !== 'ok') return codeFailure(check);

    const now = new Date();
    const [updated] = await this.db
      .update(users)
      .set({
        passwordHash: await hashPassword(password.value),
        emailVerifiedAt: target.emailVerifiedAt ?? now,
        updatedAt: now,
      })
      .where(eq(users.id, target.id))
      .returning();
    return { ok: true, value: updated! };
  }

  // ── Mantenimiento ─────────────────────────────────────────

  /**
   * Borra las cuentas con contraseña que nunca verificaron el email.
   *
   * Sin esto, cualquiera podría registrarse con usernames ajenos y un email
   * inventado y dejarlos ocupados para siempre. Una semana alcanza para verificar.
   */
  async sweepUnverified(now = new Date()): Promise<number> {
    const removed = await this.db
      .delete(users)
      .where(
        and(
          isNull(users.emailVerifiedAt),
          isNotNull(users.passwordHash),
          lt(users.createdAt, new Date(now.getTime() - UNVERIFIED_ACCOUNT_TTL_MS)),
        ),
      )
      .returning({ id: users.id });
    return removed.length;
  }

  findByEmail(key: string): Promise<UserRow | undefined> {
    return this.db.query.users.findFirst({ where: eq(users.emailKey, key) });
  }

  findByUsernameKey(key: string): Promise<UserRow | undefined> {
    return this.db.query.users.findFirst({ where: eq(users.usernameKey, key) });
  }

  private async userFromInput(rawEmail: unknown): Promise<UserRow | undefined> {
    const email = validateEmail(rawEmail);
    return email.ok ? this.findByEmail(emailKey(email.value)) : undefined;
  }

  /**
   * Emite un código y lo manda. Si la cuenta pidió uno hace muy poco o demasiados
   * en la última hora, no hace nada: el código anterior sigue sirviendo.
   */
  private async sendCode(user: UserRow, purpose: 'verify_email' | 'reset_password', locale: EmailLocale) {
    if (!user.email) return;
    const code = await this.codes.issue(user.id, purpose);
    if (!code) return;
    const message =
      purpose === 'verify_email'
        ? verificationEmail(user.email, code, locale)
        : passwordResetEmail(user.email, code, locale);
    sendInBackground(this.mailer, message);
  }
}

function codeFailure(check: 'invalid' | 'expired' | 'locked'): { ok: false } & AccountFailure {
  if (check === 'expired') return fail({ error: 'CODE_EXPIRED', field: 'code' });
  if (check === 'locked') return fail({ error: 'CODE_LOCKED', field: 'code' });
  return fail({ error: 'CODE_INVALID', field: 'code' });
}

export function toAccountInfo(user: UserRow, linked: LinkedProviders): AccountInfo {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    emailVerified: user.emailVerifiedAt !== null,
    avatarUrl: avatarUrl(user),
    hasPassword: user.passwordHash !== null,
    providers: linked.providers,
    providerAvatars: linked.providerAvatars,
    createdAt: user.createdAt.toISOString(),
  };
}

/**
 * URL pública de la foto, o null si no tiene. La versión va en la URL para que la
 * foto se pueda cachear un año y aun así cambiar al momento cuando sube otra.
 */
export function avatarUrl(user: Pick<UserRow, 'id' | 'avatarVersion'>): string | null {
  return user.avatarVersion > 0 ? `/api/avatars/${user.id}.webp?v=${user.avatarVersion}` : null;
}

/** Si el error es de un índice único de Postgres (23505), cuál. */
function uniqueViolation(error: unknown): string | null {
  // Drizzle envuelve el error del driver: el código de Postgres está en `cause`.
  let current = error;
  for (let depth = 0; depth < 4 && current && typeof current === 'object'; depth++) {
    const { code, constraint, cause } = current as { code?: unknown; constraint?: unknown; cause?: unknown };
    current = cause;
    if (code === '23505') return typeof constraint === 'string' ? constraint : '';
  }
  return null;
}
