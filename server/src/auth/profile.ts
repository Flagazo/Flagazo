import { and, eq, sql } from 'drizzle-orm';
import sharp from 'sharp';
import { AVATAR, nicknameKey, validateUsername } from '@flagazo/shared';
import type { OAuthProvider } from '@flagazo/shared';
import type { Database } from '../db/client';
import { authIdentities, avatars, users } from '../db/schema';
import type { UserRow } from '../db/schema';
import type { AccountFailure, AccountResult } from './accounts';

const fail = (failure: AccountFailure): { ok: false } & AccountFailure => ({ ok: false, ...failure });

/**
 * De dónde se aceptan fotos de proveedores. Nada más: sin esta lista, pedirle al
 * servidor "bajá esta URL" serviría para que haga pedidos a donde un atacante
 * quiera (SSRF), incluida la red interna de Render.
 */
export const PROVIDER_AVATAR_HOSTS = ['lh3.googleusercontent.com', 'cdn.discordapp.com'];

export interface ProfileOptions {
  /** Para los tests: bajar fotos sin salir a internet. */
  fetchImage?: (url: string) => Promise<Buffer>;
  allowedHosts?: readonly string[];
}

/** Username y foto de perfil. */
export class ProfileService {
  private readonly fetchImage: (url: string) => Promise<Buffer>;
  private readonly allowedHosts: readonly string[];

  constructor(
    private readonly db: Database,
    options: ProfileOptions = {},
  ) {
    this.fetchImage = options.fetchImage ?? downloadImage;
    this.allowedHosts = options.allowedHosts ?? PROVIDER_AVATAR_HOSTS;
  }

  async changeUsername(userId: string, raw: unknown): Promise<AccountResult<UserRow>> {
    const username = validateUsername(raw);
    if (!username.ok) return fail({ error: 'USERNAME_INVALID', field: 'username', reason: username.error });
    const key = nicknameKey(username.value);

    const taken = await this.db.query.users.findFirst({ where: eq(users.usernameKey, key) });
    // Cambiar solo mayúsculas o tildes del propio nombre ("juana" → "Juana") vale.
    if (taken && taken.id !== userId) return fail({ error: 'USERNAME_TAKEN', field: 'username' });

    try {
      const [updated] = await this.db
        .update(users)
        .set({ username: username.value, usernameKey: key, updatedAt: new Date() })
        .where(eq(users.id, userId))
        .returning();
      if (!updated) return fail({ error: 'UNAUTHENTICATED' });
      return { ok: true, value: updated };
    } catch (error) {
      if (isUniqueViolation(error)) return fail({ error: 'USERNAME_TAKEN', field: 'username' });
      throw error;
    }
  }

  /**
   * Guarda una foto subida por el jugador.
   *
   * La validación de verdad la hace el decodificador: lo que no se pueda abrir
   * como JPG, PNG o WebP se rechaza, diga lo que diga la extensión o el tipo que
   * mandó el navegador. Lo que se guarda es una imagen nueva generada acá, no el
   * archivo original: no pasan metadatos (GPS de la foto), ni datos escondidos.
   */
  async setAvatar(userId: string, input: Buffer): Promise<AccountResult<UserRow>> {
    if (input.length > AVATAR.maxUploadBytes) return fail({ error: 'AVATAR_TOO_LARGE' });
    const processed = await processAvatar(input);
    if (!processed) return fail({ error: 'AVATAR_INVALID' });
    return { ok: true, value: await this.store(userId, processed) };
  }

  /** Usa la foto de Google o Discord como avatar. */
  async useProviderAvatar(userId: string, provider: OAuthProvider): Promise<AccountResult<UserRow>> {
    const identity = await this.db.query.authIdentities.findFirst({
      where: and(eq(authIdentities.userId, userId), eq(authIdentities.provider, provider)),
    });
    if (!identity?.avatarUrl || !this.isAllowed(identity.avatarUrl)) return fail({ error: 'NO_PROVIDER_AVATAR' });

    let image: Buffer;
    try {
      image = await this.fetchImage(identity.avatarUrl);
    } catch {
      return fail({ error: 'NO_PROVIDER_AVATAR' });
    }
    return this.setAvatar(userId, image);
  }

  async removeAvatar(userId: string): Promise<UserRow | undefined> {
    return this.db.transaction(async (tx) => {
      await tx.delete(avatars).where(eq(avatars.userId, userId));
      const [updated] = await tx
        .update(users)
        .set({ avatarVersion: 0, updatedAt: new Date() })
        .where(eq(users.id, userId))
        .returning();
      return updated;
    });
  }

  async avatarOf(userId: string) {
    return this.db.query.avatars.findFirst({ where: eq(avatars.userId, userId) });
  }

  private isAllowed(url: string): boolean {
    try {
      const parsed = new URL(url);
      return parsed.protocol === 'https:' && this.allowedHosts.includes(parsed.hostname);
    } catch {
      return false;
    }
  }

  private async store(userId: string, content: Buffer): Promise<UserRow> {
    return this.db.transaction(async (tx) => {
      const now = new Date();
      await tx
        .insert(avatars)
        .values({ userId, content, bytes: content.length, updatedAt: now })
        .onConflictDoUpdate({ target: avatars.userId, set: { content, bytes: content.length, updatedAt: now } });
      // Versión nueva = URL nueva: los navegadores no se quedan con la foto vieja en caché.
      const [updated] = await tx
        .update(users)
        .set({ avatarVersion: sql`${users.avatarVersion} + 1`, updatedAt: now })
        .where(eq(users.id, userId))
        .returning();
      return updated!;
    });
  }
}

/**
 * Abre la imagen, la valida y la deja lista: cuadrada, 256×256, WebP, sin
 * metadatos. null si no es una imagen aceptable.
 */
export async function processAvatar(input: Buffer): Promise<Buffer | null> {
  try {
    const image = sharp(input, {
      // Tope de píxeles antes de decodificar: una imagen de 20.000×20.000 pesa
      // poco comprimida pero ocupa gigas en memoria al abrirla.
      limitInputPixels: AVATAR.maxInputSide * AVATAR.maxInputSide,
      failOn: 'error',
    });
    const meta = await image.metadata();
    if (meta.format !== 'jpeg' && meta.format !== 'png' && meta.format !== 'webp') return null;
    if (!meta.width || !meta.height || meta.width > AVATAR.maxInputSide || meta.height > AVATAR.maxInputSide) {
      return null;
    }
    return await image
      .rotate() // respeta la orientación de las fotos del celular antes de descartar el EXIF
      .resize(AVATAR.size, AVATAR.size, { fit: 'cover', position: 'attention' })
      .webp({ quality: 82 })
      .toBuffer();
  } catch {
    return null;
  }
}

/** Baja una imagen con tope de tiempo y de tamaño. */
async function downloadImage(url: string): Promise<Buffer> {
  const response = await fetch(url, { signal: AbortSignal.timeout(8000), redirect: 'error' });
  if (!response.ok) throw new Error(`respondió ${response.status}`);
  const declared = Number(response.headers.get('content-length') ?? 0);
  if (declared > AVATAR.maxUploadBytes) throw new Error('demasiado grande');
  const body = Buffer.from(await response.arrayBuffer());
  if (body.length > AVATAR.maxUploadBytes) throw new Error('demasiado grande');
  return body;
}

function isUniqueViolation(error: unknown): boolean {
  let current = error;
  for (let depth = 0; depth < 4 && current && typeof current === 'object'; depth++) {
    if ((current as { code?: unknown }).code === '23505') return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}
