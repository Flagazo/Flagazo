/**
 * Perfil y foto: servidor real, base real, imágenes reales generadas en el momento.
 */
import type { AddressInfo } from 'node:net';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AVATAR, nicknameKey } from '@flagazo/shared';
import type { AccountInfo, ApiResult } from '@flagazo/shared';
import { createGameServer } from '../app';
import { openMemoryDatabase } from '../db/client';
import type { DatabaseHandle } from '../db/client';
import { authIdentities, users } from '../db/schema';
import { MemoryMailer } from '../email/mailer';
import { SessionService } from './sessions';

const SECRET = 'secreto-de-tests-con-mas-de-32-caracteres!!';

let database: DatabaseHandle;
let server: ReturnType<typeof createGameServer>;
let url: string;
const downloads: string[] = [];

beforeAll(async () => {
  database = await openMemoryDatabase();
  server = createGameServer({
    accounts: { db: database.db, mailer: new MemoryMailer(), secret: SECRET },
    profile: {
      // Las fotos "de Google" se generan acá: los tests no salen a internet.
      fetchImage: async (imageUrl) => {
        downloads.push(imageUrl);
        return image('png', 400, 400);
      },
    },
  });
  await new Promise<void>((resolve) => server.httpServer.listen(0, resolve));
  url = `http://localhost:${(server.httpServer.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await server.close();
  await database.close();
});

function image(format: 'jpeg' | 'png' | 'webp', width: number, height: number) {
  const base = sharp({ create: { width, height, channels: 3, background: '#35d6ff' } });
  return base[format]().toBuffer();
}

let counter = 0;
/** Una cuenta con sesión iniciada, creada directo en la base. */
async function account() {
  counter++;
  const username = `Perfil${counter}`;
  const [user] = await database.db
    .insert(users)
    .values({ username, usernameKey: nicknameKey(username), email: `perfil${counter}@example.com`, emailKey: `perfil${counter}@example.com`, emailVerifiedAt: new Date() })
    .returning();
  const { token } = await new SessionService(database.db).create(user!.id, true);
  return { user: user!, cookie: `flagazo_sid=${token}` };
}

async function upload(cookie: string, body: Buffer, contentType: string, headers: Record<string, string> = {}) {
  const response = await fetch(`${url}/api/me/avatar`, {
    method: 'POST',
    headers: { cookie, 'content-type': contentType, ...headers },
    body: new Uint8Array(body),
  });
  return { status: response.status, body: (await response.json()) as ApiResult<{ account: AccountInfo }> };
}

async function json<T>(method: string, path: string, cookie: string | null, body?: unknown) {
  const response = await fetch(`${url}/api${path}`, {
    method,
    headers: { ...(cookie ? { cookie } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json()) as ApiResult<T> };
}

describe('foto de perfil', () => {
  it.each([
    ['jpeg', 'image/jpeg'],
    ['png', 'image/png'],
    ['webp', 'image/webp'],
  ] as const)('acepta %s y la deja en 256×256 WebP', async (format, type) => {
    const { cookie } = await account();
    const { status, body } = await upload(cookie, await image(format, 1200, 800), type);
    expect(status).toBe(200);
    const avatarUrl = body.ok ? body.data.account.avatarUrl : null;
    expect(avatarUrl).toMatch(/^\/api\/avatars\/[0-9a-f-]{36}\.webp\?v=1$/);

    const served = await fetch(`${url}${avatarUrl}`);
    expect(served.status).toBe(200);
    expect(served.headers.get('content-type')).toBe('image/webp');
    expect(served.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(served.headers.get('x-content-type-options')).toBe('nosniff');
    const meta = await sharp(Buffer.from(await served.arrayBuffer())).metadata();
    expect(meta).toMatchObject({ format: 'webp', width: AVATAR.size, height: AVATAR.size });
  });

  it('no guarda los metadatos de la foto original (EXIF, GPS)', async () => {
    const { cookie } = await account();
    const withExif = await sharp({ create: { width: 600, height: 600, channels: 3, background: '#ff4f8b' } })
      .jpeg()
      .withExif({ IFD0: { Copyright: 'dato-privado', Artist: 'Nombre Real' } })
      .toBuffer();
    expect((await sharp(withExif).metadata()).exif).toBeDefined();

    const { body } = await upload(cookie, withExif, 'image/jpeg');
    const served = Buffer.from(await (await fetch(`${url}${body.ok ? body.data.account.avatarUrl : ''}`)).arrayBuffer());
    expect((await sharp(served).metadata()).exif).toBeUndefined();
    expect(served.includes('dato-privado')).toBe(false);
  });

  it('rechaza lo que no es una imagen, aunque diga que lo es', async () => {
    const { cookie } = await account();
    const fake = await upload(cookie, Buffer.from('<?php echo "hola"; ?>'), 'image/png');
    expect(fake.status).toBe(400);
    expect(fake.body).toEqual({ ok: false, error: 'AVATAR_INVALID' });
  });

  it('rechaza formatos que no son JPG, PNG o WebP (GIF, SVG)', async () => {
    const { cookie } = await account();
    const gif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
    expect((await upload(cookie, gif, 'image/png')).body).toEqual({ ok: false, error: 'AVATAR_INVALID' });

    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script></svg>');
    expect((await upload(cookie, svg, 'image/png')).body).toEqual({ ok: false, error: 'AVATAR_INVALID' });

    // Y un tipo que ni siquiera se acepta en la subida.
    const asText = await fetch(`${url}/api/me/avatar`, { method: 'POST', headers: { cookie, 'content-type': 'image/svg+xml' }, body: svg });
    expect(await asText.json()).toEqual({ ok: false, error: 'AVATAR_INVALID' });
  });

  it('rechaza un archivo demasiado grande', async () => {
    const { cookie } = await account();
    const { status, body } = await upload(cookie, Buffer.alloc(AVATAR.maxUploadBytes + 1, 1), 'image/jpeg');
    expect(status).toBe(413);
    expect(body).toEqual({ ok: false, error: 'AVATAR_TOO_LARGE' });
  });

  it('rechaza dimensiones enormes aunque el archivo pese poco', async () => {
    const { cookie } = await account();
    const huge = await image('png', AVATAR.maxInputSide + 1, 10);
    expect(huge.length).toBeLessThan(AVATAR.maxUploadBytes);
    expect((await upload(cookie, huge, 'image/png')).body).toEqual({ ok: false, error: 'AVATAR_INVALID' });
  });

  it('cada foto nueva cambia la URL; quitarla vuelve al avatar de color', async () => {
    const { cookie } = await account();
    const first = await upload(cookie, await image('png', 300, 300), 'image/png');
    const second = await upload(cookie, await image('jpeg', 300, 300), 'image/jpeg');
    const firstUrl = first.body.ok ? first.body.data.account.avatarUrl : '';
    const secondUrl = second.body.ok ? second.body.data.account.avatarUrl : '';
    expect(secondUrl).not.toBe(firstUrl);
    expect(secondUrl).toMatch(/\?v=2$/);

    const removed = await json<{ account: AccountInfo }>('DELETE', '/me/avatar', cookie);
    expect(removed.body.ok && removed.body.data.account.avatarUrl).toBeNull();
    expect((await fetch(`${url}${secondUrl}`)).status).toBe(404);
  });

  it('sin sesión no se puede subir nada', async () => {
    const response = await fetch(`${url}/api/me/avatar`, {
      method: 'POST',
      headers: { 'content-type': 'image/png' },
      body: new Uint8Array(await image('png', 100, 100)),
    });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ ok: false, error: 'UNAUTHENTICATED' });
  });

  it('una subida desde otro sitio se rechaza (CSRF)', async () => {
    const { cookie } = await account();
    const { status } = await upload(cookie, await image('png', 100, 100), 'image/png', { 'sec-fetch-site': 'cross-site' });
    expect(status).toBe(403);
  });

  it('una URL de avatar inventada no rompe nada', async () => {
    expect((await fetch(`${url}/api/avatars/..%2F..%2Fetc%2Fpasswd`)).status).toBe(404);
    // Tiene el largo de un UUID pero no lo es: no debe llegar a la base (sería un 500).
    expect((await fetch(`${url}/api/avatars/${'-'.repeat(36)}.webp`)).status).toBe(404);
    expect((await fetch(`${url}/api/avatars/no-es-un-uuid.webp`)).status).toBe(404);
    expect((await fetch(`${url}/api/avatars/00000000-0000-0000-0000-000000000000.webp`)).status).toBe(404);
  });
});

describe('foto del proveedor', () => {
  it('usa la foto de Google vinculada', async () => {
    const { user, cookie } = await account();
    await database.db.insert(authIdentities).values({
      userId: user.id,
      provider: 'google',
      providerUserId: `g-foto-${counter}`,
      avatarUrl: 'https://lh3.googleusercontent.com/a/foto-de-google',
    });

    const me = await json<{ accountsEnabled: boolean; account: AccountInfo }>('GET', '/me', cookie);
    expect(me.body.ok && me.body.data.account.providerAvatars).toEqual(['google']);

    const result = await json<{ account: AccountInfo }>('POST', '/me/avatar/provider', cookie, { provider: 'google' });
    expect(result.status).toBe(200);
    expect(result.body.ok && result.body.data.account.avatarUrl).toMatch(/\.webp\?v=1$/);
    expect(downloads).toContain('https://lh3.googleusercontent.com/a/foto-de-google');
  });

  it('nunca baja fotos de hosts que no son Google ni Discord (SSRF)', async () => {
    const { user, cookie } = await account();
    await database.db.insert(authIdentities).values({
      userId: user.id,
      provider: 'discord',
      providerUserId: `d-ssrf-${counter}`,
      avatarUrl: 'http://169.254.169.254/latest/meta-data/',
    });
    const before = downloads.length;
    const result = await json('POST', '/me/avatar/provider', cookie, { provider: 'discord' });
    expect(result.body).toEqual({ ok: false, error: 'NO_PROVIDER_AVATAR' });
    expect(downloads.length).toBe(before);
  });

  it('sin cuenta del proveedor vinculada', async () => {
    const { cookie } = await account();
    const result = await json('POST', '/me/avatar/provider', cookie, { provider: 'discord' });
    expect(result.body).toEqual({ ok: false, error: 'NO_PROVIDER_AVATAR' });
  });
});

describe('cambiar el username', () => {
  it('lo cambia, y valida como al registrarse', async () => {
    const { cookie } = await account();
    const renamed = await json<{ account: AccountInfo }>('PATCH', '/me', cookie, { username: `Nuevo Nombre ${counter}` });
    expect(renamed.body.ok && renamed.body.data.account.username).toBe(`Nuevo Nombre ${counter}`);

    const invalid = await json('PATCH', '/me', cookie, { username: 'x' });
    expect(invalid.body).toMatchObject({ ok: false, error: 'USERNAME_INVALID', field: 'username' });
  });

  it('no deja usar el de otro, pero sí cambiar mayúsculas o tildes del propio', async () => {
    const other = await account();
    const { cookie, user } = await account();
    const taken = await json('PATCH', '/me', cookie, { username: other.user.username.toUpperCase() });
    expect(taken.status).toBe(409);
    expect(taken.body).toMatchObject({ ok: false, error: 'USERNAME_TAKEN' });

    const sameName = await json<{ account: AccountInfo }>('PATCH', '/me', cookie, { username: user.username.toLowerCase() });
    expect(sameName.body.ok && sameName.body.data.account.username).toBe(user.username.toLowerCase());
  });

  it('sin sesión, 401', async () => {
    expect((await json('PATCH', '/me', null, { username: 'Alguien' })).status).toBe(401);
  });
});
