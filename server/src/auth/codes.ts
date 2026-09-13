import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { and, count, desc, eq, gt, isNull, lt, sql } from 'drizzle-orm';
import { AUTH_CODE } from '@flagazo/shared';
import type { Database } from '../db/client';
import { authCodes } from '../db/schema';

export type CodePurpose = 'verify_email' | 'reset_password';

/** Cómo resultó comparar un código contra el último emitido. */
export type CodeCheck = 'ok' | 'invalid' | 'expired' | 'locked';

/**
 * Emite y comprueba los códigos de seis dígitos que llegan por email.
 *
 * Reglas, todas del lado del servidor:
 * - Solo vale el último código de cada propósito: pedir uno nuevo anula el anterior.
 * - Vence a los 10 minutos y se usa una sola vez.
 * - Admite 5 intentos; después hay que pedir otro.
 * - Entre pedido y pedido pasa al menos un minuto, y no más de 5 por hora.
 */
export class CodeService {
  constructor(
    private readonly db: Database,
    private readonly secret: string,
  ) {}

  /**
   * Un código nuevo, o null si esta cuenta pidió uno hace muy poco o ya pidió
   * demasiados. Quien llama no le dice nada distinto al usuario en ese caso:
   * responder "esperá" revelaría que la cuenta existe.
   */
  async issue(userId: string, purpose: CodePurpose, now = new Date()): Promise<string | null> {
    const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const [recent] = await this.db
      .select({ total: count(), last: sql<Date | null>`max(${authCodes.createdAt})` })
      .from(authCodes)
      .where(and(eq(authCodes.userId, userId), eq(authCodes.purpose, purpose), gt(authCodes.createdAt, hourAgo)));

    const last = recent?.last ? new Date(recent.last) : null;
    if ((recent?.total ?? 0) >= AUTH_CODE.maxPerHour) return null;
    if (last && now.getTime() - last.getTime() < AUTH_CODE.resendCooldownMs) return null;

    const code = String(randomInt(0, 10 ** AUTH_CODE.length)).padStart(AUTH_CODE.length, '0');

    /*
     * Los anteriores no se borran: siguen contando para el tope por hora (borrarlos
     * lo dejaba sin efecto). Dejan de servir igual, porque `check` solo mira el
     * último emitido.
     */
    await this.db.insert(authCodes).values({
      userId,
      purpose,
      codeHash: this.hash(userId, purpose, code),
      createdAt: now,
      expiresAt: new Date(now.getTime() + AUTH_CODE.ttlMs),
    });
    return code;
  }

  /**
   * Compara contra el último código emitido y, si coincide, lo consume.
   *
   * Solo cuenta el último, usado o no. Si se mirara "el último sin usar", al usar
   * uno el anterior volvería a servir. Consumir y sumar intentos son UPDATE
   * condicionales: dos pedidos simultáneos con el código correcto no pueden usarlo
   * los dos, y dos incorrectos no pueden saltearse el tope de intentos.
   */
  async check(userId: string, purpose: CodePurpose, code: string, now = new Date()): Promise<CodeCheck> {
    const row = await this.latest(userId, purpose);

    if (!row || row.consumedAt) return 'invalid';
    if (row.attempts >= AUTH_CODE.maxAttempts) return 'locked';
    if (row.expiresAt.getTime() <= now.getTime()) return 'expired';

    if (!this.matches(row.codeHash, userId, purpose, code)) {
      const [updated] = await this.db
        .update(authCodes)
        .set({ attempts: sql`${authCodes.attempts} + 1` })
        .where(and(eq(authCodes.id, row.id), sql`${authCodes.attempts} < ${AUTH_CODE.maxAttempts}`))
        .returning({ attempts: authCodes.attempts });
      return !updated || updated.attempts >= AUTH_CODE.maxAttempts ? 'locked' : 'invalid';
    }

    const [consumed] = await this.db
      .update(authCodes)
      .set({ consumedAt: now })
      .where(and(eq(authCodes.id, row.id), isNull(authCodes.consumedAt)))
      .returning({ id: authCodes.id });
    return consumed ? 'ok' : 'invalid';
  }

  /** ¿Es el código que ya se usó? Para responder "ya verificado" solo a quien lo tenía. */
  async matchesConsumed(userId: string, purpose: CodePurpose, code: string): Promise<boolean> {
    const row = await this.latest(userId, purpose);
    return Boolean(row?.consumedAt && this.matches(row.codeHash, userId, purpose, code));
  }

  private async latest(userId: string, purpose: CodePurpose) {
    const [row] = await this.db
      .select()
      .from(authCodes)
      .where(and(eq(authCodes.userId, userId), eq(authCodes.purpose, purpose)))
      .orderBy(desc(authCodes.createdAt))
      .limit(1);
    return row;
  }

  /** Borra los códigos de más de un día: ya no sirven ni para el límite por hora. */
  async sweep(now = new Date()): Promise<void> {
    await this.db.delete(authCodes).where(lt(authCodes.createdAt, new Date(now.getTime() - 24 * 60 * 60 * 1000)));
  }

  private hash(userId: string, purpose: CodePurpose, code: string): string {
    // La cuenta y el propósito van dentro del HMAC: un código no sirve para otra
    // cuenta ni para otra cosa aunque alguien copiara la fila.
    return createHmac('sha256', this.secret).update(`${purpose}:${userId}:${code}`).digest('hex');
  }

  private matches(stored: string, userId: string, purpose: CodePurpose, code: string): boolean {
    if (!/^\d+$/.test(code) || code.length !== AUTH_CODE.length) return false;
    const expected = Buffer.from(stored, 'hex');
    const actual = Buffer.from(this.hash(userId, purpose, code), 'hex');
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }
}
