/**
 * Google y Discord de punta a punta, contra un proveedor falso que corre en la
 * misma máquina y se comporta como los de verdad: pantalla de autorización,
 * cambio del código por un token (con PKCE en Google) y perfil.
 */
import { createHash } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import sharp from 'sharp';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { MeResponse, OAuthProvider } from '@flagazo/shared';
import { createGameServer } from '../app';
import { openMemoryDatabase } from '../db/client';
import type { DatabaseHandle } from '../db/client';
import { authIdentities, users } from '../db/schema';
import { MemoryMailer } from '../email/mailer';
import { discordProvider, googleProvider, openState, sealState, usernameBaseForTests } from './testExports';

const SECRET = 'secreto-de-tests-con-mas-de-32-caracteres!!';

// ── Proveedor falso ─────────────────────────────────────────

const pendingCodes = new Map<string, { profile: unknown; challenge: string | null; clientSecret: string }>();
const tokens = new Map<string, unknown>();
let failToken = false;
let fakeServer: Server;
let fakeUrl: string;

function startFakeProvider() {
  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.post('/token', (req, res) => {
    const pending = pendingCodes.get(req.body.code);
    pendingCodes.delete(req.body.code); // un código sirve una vez, como en los reales
    if (failToken || !pending || req.body.client_secret !== pending.clientSecret) return res.status(400).json({ error: 'invalid_grant' });
    if (pending.challenge) {
      const expected = createHash('sha256').update(String(req.body.code_verifier ?? '')).digest('base64url');
      if (expected !== pending.challenge) return res.status(400).json({ error: 'invalid_grant', detail: 'pkce' });
    }
    const token = `tok-${Math.random().toString(36).slice(2)}`;
    tokens.set(token, pending.profile);
    res.json({ access_token: token, token_type: 'Bearer' });
  });
  app.get('/userinfo', (req, res) => {
    const profile = tokens.get(String(req.headers.authorization).replace('Bearer ', ''));
    if (!profile) return res.status(401).end();
    res.json(profile);
  });
  return new Promise<void>((resolve) => {
    fakeServer = app.listen(0, () => {
      fakeUrl = `http://localhost:${(fakeServer.address() as AddressInfo).port}`;
      resolve();
    });
  });
}

// ── Flagazo ─────────────────────────────────────────────────

let database: DatabaseHandle;
let server: ReturnType<typeof createGameServer>;
let url: string;
const mailer = new MemoryMailer();

beforeAll(async () => {
  await startFakeProvider();
  database = await openMemoryDatabase();
  const fake = { tokenUrl: `${fakeUrl}/token`, userinfoUrl: `${fakeUrl}/userinfo`, authorizeUrl: `${fakeUrl}/authorize` };
  server = createGameServer({
    accounts: { db: database.db, mailer, secret: SECRET },
    oauth: {
      providers: [
        { ...googleProvider('google-id', 'google-secret'), ...fake },
        { ...discordProvider('discord-id', 'discord-secret'), ...fake },
      ],
      publicUrl: null,
    },
    profile: {
      fetchImage: () => sharp({ create: { width: 300, height: 300, channels: 3, background: '#2ee59d' } }).png().toBuffer(),
    },
  });
  await new Promise<void>((resolve) => server.httpServer.listen(0, resolve));
  url = `http://localhost:${(server.httpServer.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await server.close();
  await database.close();
  await new Promise((resolve) => fakeServer.close(resolve));
});

function cookieValue(setCookie: string[], name: string): string | null {
  const header = setCookie.find((value) => value.startsWith(`${name}=`));
  if (!header) return null;
  const value = header.split(';')[0]!.slice(name.length + 1);
  return value || null;
}

/** El recorrido completo: botón → proveedor → vuelta. Devuelve a dónde volvió y la cookie de sesión. */
async function oauthFlow(
  provider: OAuthProvider,
  profile: unknown,
  options: { session?: string; remember?: boolean; tamper?: (state: string, cookie: string) => { state: string; cookie: string | null } } = {},
) {
  const start = await fetch(`${url}/api/auth/${provider}${options.remember === false ? '?remember=0' : ''}`, {
    redirect: 'manual',
    headers: options.session ? { cookie: `flagazo_sid=${options.session}` } : {},
  });
  expect(start.status).toBe(302);
  const authorize = new URL(start.headers.get('location')!);
  const stateCookie = cookieValue(start.headers.getSetCookie(), 'flagazo_oauth')!;

  const code = `code-${Math.random().toString(36).slice(2)}`;
  pendingCodes.set(code, {
    profile,
    challenge: authorize.searchParams.get('code_challenge'),
    clientSecret: `${provider}-secret`,
  });

  let state = authorize.searchParams.get('state')!;
  let cookie: string | null = stateCookie;
  if (options.tamper) ({ state, cookie } = options.tamper(state, stateCookie));

  const cookies = [cookie ? `flagazo_oauth=${cookie}` : null, options.session ? `flagazo_sid=${options.session}` : null]
    .filter(Boolean)
    .join('; ');
  const callback = await fetch(
    `${url}/api/auth/${provider}/callback?code=${code}&state=${encodeURIComponent(state)}`,
    { redirect: 'manual', headers: cookies ? { cookie: cookies } : {} },
  );
  const back = new URL(callback.headers.get('location') ?? '/', url);
  return {
    authorize,
    startCookies: start.headers.getSetCookie(),
    callbackCookies: callback.headers.getSetCookie(),
    status: callback.status,
    auth: back.searchParams.get('auth'),
    reason: back.searchParams.get('reason'),
    session: cookieValue(callback.headers.getSetCookie(), 'flagazo_sid'),
  };
}

async function me(session: string | null) {
  const response = await fetch(`${url}/api/me`, { headers: session ? { cookie: `flagazo_sid=${session}` } : {} });
  return ((await response.json()) as { data: MeResponse }).data;
}

let counter = 0;
const unique = () => ++counter;

async function passwordAccount(email: string, verify: boolean) {
  const username = `Clave${unique()}`;
  await fetch(`${url}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, email, password: 'caballo-bateria-9' }),
  });
  if (verify) {
    const code = mailer.lastTo(email)!.text.match(/\b(\d{6})\b/)![1];
    await fetch(`${url}/api/auth/verify-email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, code }),
    });
  }
  return { username };
}

describe('Continuar con Google', () => {
  it('manda a Google con state, PKCE (S256), los scopes y la URL de vuelta', async () => {
    const { authorize, startCookies } = await oauthFlow('google', { sub: `g-${unique()}`, email: `a${counter}@gmail.com`, email_verified: true, name: 'Ana' });
    expect(authorize.origin + authorize.pathname).toBe(`${fakeUrl}/authorize`);
    expect(authorize.searchParams.get('client_id')).toBe('google-id');
    expect(authorize.searchParams.get('response_type')).toBe('code');
    expect(authorize.searchParams.get('scope')).toBe('openid email profile');
    expect(authorize.searchParams.get('redirect_uri')).toBe(`${url}/api/auth/google/callback`);
    expect(authorize.searchParams.get('code_challenge_method')).toBe('S256');
    expect(authorize.searchParams.get('state')).toMatch(/^[\w-]{32}$/);
    expect(authorize.searchParams.get('prompt')).toBe('select_account');
    // El state vive en una cookie HttpOnly firmada, corta y solo para /api/auth.
    const header = startCookies.find((value) => value.startsWith('flagazo_oauth='))!;
    expect(header).toMatch(/HttpOnly/i);
    expect(header).toMatch(/Path=\/api\/auth/);
    expect(header).toMatch(/SameSite=Lax/i);
    expect(header).toMatch(/Max-Age=600/);
  });

  it('cuenta nueva: usa el nombre y el email verificado de Google, sin contraseña', async () => {
    const n = unique();
    const result = await oauthFlow('google', {
      sub: `g-new-${n}`,
      email: `nueva${n}@gmail.com`,
      email_verified: true,
      name: `Lucía ${n}`,
      picture: 'https://lh3.googleusercontent.com/a/foto',
    });
    expect(result.auth).toBe('created');
    // La cookie de state se borra en la vuelta, salga como salga.
    expect(result.callbackCookies.find((value) => value.startsWith('flagazo_oauth='))).toMatch(/Expires=Thu, 01 Jan 1970/);

    const data = await me(result.session);
    expect(data.account).toMatchObject({
      username: `Lucía ${n}`,
      email: `nueva${n}@gmail.com`,
      emailVerified: true,
      hasPassword: false,
      providers: ['google'],
    });

    const identity = await database.db.query.authIdentities.findFirst({ where: eq(authIdentities.providerUserId, `g-new-${n}`) });
    expect(identity).toMatchObject({ provider: 'google', avatarUrl: 'https://lh3.googleusercontent.com/a/foto', emailVerified: true });
  });

  it('una cuenta nueva arranca con la foto del proveedor', async () => {
    const n = unique();
    const withPhoto = await oauthFlow('google', {
      sub: `g-photo-${n}`,
      email: `foto${n}@gmail.com`,
      email_verified: true,
      name: `Con Foto ${n}`,
      picture: 'https://lh3.googleusercontent.com/a/foto',
    });
    const account = (await me(withPhoto.session)).account!;
    expect(account.avatarUrl).toMatch(/\.webp\?v=1$/);
    expect((await fetch(`${url}${account.avatarUrl}`)).headers.get('content-type')).toBe('image/webp');

    // Sin foto en el proveedor: avatar de color, como siempre.
    const withoutPhoto = await oauthFlow('google', { sub: `g-nophoto-${n}`, email: `sinfoto${n}@gmail.com`, email_verified: true, name: 'Sin Foto' });
    expect((await me(withoutPhoto.session)).account!.avatarUrl).toBeNull();
  });

  it('la segunda vez entra a la misma cuenta, aunque haya cambiado el email en Google', async () => {
    const n = unique();
    const first = await oauthFlow('google', { sub: `g-same-${n}`, email: `antes${n}@gmail.com`, email_verified: true, name: 'Beto' });
    const second = await oauthFlow('google', { sub: `g-same-${n}`, email: `despues${n}@gmail.com`, email_verified: true, name: 'Beto' });
    expect(second.auth).toBe('ok');
    expect((await me(second.session)).account!.id).toBe((await me(first.session)).account!.id);
  });

  it('con "mantener sesión" apagado, la cookie de sesión es del navegador', async () => {
    const result = await oauthFlow('google', { sub: `g-rem-${unique()}`, email: `rem${counter}@gmail.com`, email_verified: true, name: 'Remi' }, { remember: false });
    const header = result.callbackCookies.find((value) => value.startsWith('flagazo_sid='))!;
    expect(header).not.toMatch(/Max-Age/);
  });

  it('vincula con una cuenta existente de email verificado, sin duplicarla', async () => {
    const email = `existente${unique()}@example.com`;
    const { username } = await passwordAccount(email, true);

    const result = await oauthFlow('google', { sub: `g-link-${counter}`, email: email.toUpperCase(), email_verified: true, name: 'Otro Nombre' });
    expect(result.auth).toBe('ok');
    const data = await me(result.session);
    expect(data.account).toMatchObject({ username, email, hasPassword: true, providers: ['google'] });

    // Y la contraseña de antes sigue funcionando.
    const login = await fetch(`${url}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: 'caballo-bateria-9' }),
    });
    expect(login.status).toBe(200);
  });

  it('una cuenta con ese email que nunca se verificó: Google prueba el email, y quien la creó pierde la contraseña', async () => {
    const email = `usurpado${unique()}@example.com`;
    const { username } = await passwordAccount(email, false);

    const result = await oauthFlow('google', { sub: `g-owner-${counter}`, email, email_verified: true, name: 'Dueña Real' });
    expect(result.auth).toBe('ok');
    expect((await me(result.session)).account).toMatchObject({ username, emailVerified: true, hasPassword: false });

    // Quien registró el email sin ser el dueño ya no puede entrar con su contraseña.
    const login = await fetch(`${url}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: 'caballo-bateria-9' }),
    });
    expect(login.status).toBe(401);
  });

  it('el username se limpia y, si está ocupado, lleva un número', async () => {
    const n = unique();
    const a = await oauthFlow('google', { sub: `g-dup-a-${n}`, email: `dupa${n}@gmail.com`, email_verified: true, name: `Pepe🔥${n}` });
    const b = await oauthFlow('google', { sub: `g-dup-b-${n}`, email: `dupb${n}@gmail.com`, email_verified: true, name: `Pepe${n}` });
    expect((await me(a.session)).account!.username).toBe(`Pepe ${n}`);
    const second = (await me(b.session)).account!.username;
    expect(second).not.toBe(`Pepe ${n}`);
    expect(second.startsWith('Pepe')).toBe(true);
  });
});

describe('Continuar con Discord', () => {
  it('manda a Discord con identify y email, sin PKCE', async () => {
    const { authorize } = await oauthFlow('discord', { id: `${Date.now()}`, username: 'discordero', verified: true, email: `d${unique()}@example.com` });
    expect(authorize.searchParams.get('scope')).toBe('identify email');
    expect(authorize.searchParams.get('code_challenge')).toBeNull();
    expect(authorize.searchParams.get('redirect_uri')).toBe(`${url}/api/auth/discord/callback`);
  });

  it('cuenta nueva con el nombre visible, el email verificado y la URL del avatar', async () => {
    const n = unique();
    const id = `9${n}123456789`;
    const result = await oauthFlow('discord', {
      id,
      username: `usuario${n}`,
      global_name: `Nombre Visible`,
      avatar: 'a1b2c3d4e5',
      email: `discord${n}@example.com`,
      verified: true,
    });
    expect(result.auth).toBe('created');
    expect((await me(result.session)).account).toMatchObject({
      email: `discord${n}@example.com`,
      emailVerified: true,
      providers: ['discord'],
    });
    const identity = await database.db.query.authIdentities.findFirst({ where: eq(authIdentities.providerUserId, id) });
    expect(identity?.avatarUrl).toBe(`https://cdn.discordapp.com/avatars/${id}/a1b2c3d4e5.png?size=256`);
    // Y arranca con esa foto como avatar.
    expect((await me(result.session)).account!.avatarUrl).toMatch(/\.webp\?v=1$/);
  });

  it('la segunda vez entra a la misma cuenta', async () => {
    const id = `4${unique()}000555`;
    const first = await oauthFlow('discord', { id, username: 'vuelve', email: `vuelve${counter}@example.com`, verified: true });
    const second = await oauthFlow('discord', { id, username: 'vuelve', email: `vuelve${counter}@example.com`, verified: true });
    expect(second.auth).toBe('ok');
    expect((await me(second.session)).account!.id).toBe((await me(first.session)).account!.id);
  });

  it('vincula con una cuenta existente de email verificado, sin duplicarla', async () => {
    const email = `condiscord${unique()}@example.com`;
    const { username } = await passwordAccount(email, true);
    const before = (await database.db.select().from(users)).length;

    const result = await oauthFlow('discord', { id: `3${counter}000666`, username: 'otro', email, verified: true });
    expect(result.auth).toBe('ok');
    expect((await me(result.session)).account).toMatchObject({ username, email, hasPassword: true, providers: ['discord'] });
    expect((await database.db.select().from(users)).length).toBe(before);
  });

  it('con un email no verificado en Discord no se apropia de una cuenta existente', async () => {
    const email = `victima${unique()}@example.com`;
    await passwordAccount(email, true);
    const before = (await database.db.select().from(users)).length;

    const result = await oauthFlow('discord', { id: `7${counter}000111`, username: 'atacante', email, verified: false });
    expect(result.auth).toBe('error');
    expect(result.reason).toBe('OAUTH_EMAIL_IN_USE');
    expect(result.session).toBeNull();
    expect((await database.db.select().from(users)).length).toBe(before);
  });

  it('con un email no verificado y sin cuenta previa, crea la cuenta sin email', async () => {
    const result = await oauthFlow('discord', { id: `8${unique()}000222`, username: 'sinmail', email: `noverif${counter}@example.com`, verified: false });
    expect(result.auth).toBe('created');
    expect((await me(result.session)).account).toMatchObject({ email: null, emailVerified: false });
  });
});

describe('vincular desde una sesión iniciada', () => {
  it('agrega el proveedor a la cuenta actual', async () => {
    const created = await oauthFlow('google', { sub: `g-base-${unique()}`, email: `base${counter}@gmail.com`, email_verified: true, name: 'Base' });
    const linked = await oauthFlow('discord', { id: `6${counter}000333`, username: 'mismo', email: `otro${counter}@example.com`, verified: true }, { session: created.session! });
    expect(linked.auth).toBe('linked');
    expect((await me(created.session)).account!.providers).toEqual(['google', 'discord']);
  });

  it('no deja vincular un Discord que ya es de otra cuenta', async () => {
    const discordId = `5${unique()}000444`;
    await oauthFlow('discord', { id: discordId, username: 'primero', email: `primero${counter}@example.com`, verified: true });
    const other = await oauthFlow('google', { sub: `g-other-${counter}`, email: `other${counter}@gmail.com`, email_verified: true, name: 'Otra' });

    const attempt = await oauthFlow('discord', { id: discordId, username: 'primero' }, { session: other.session! });
    expect(attempt.reason).toBe('OAUTH_ALREADY_LINKED');
    expect((await me(other.session)).account!.providers).toEqual(['google']);
  });
});

describe('protecciones', () => {
  const profile = () => ({ sub: `g-sec-${unique()}`, email: `sec${counter}@gmail.com`, email_verified: true, name: 'Seguro' });

  it('state distinto al de la cookie: no entra (evita que te metan en la cuenta de otro)', async () => {
    const result = await oauthFlow('google', profile(), { tamper: (_state, cookie) => ({ state: 'otro-state-cualquiera', cookie }) });
    expect(result.reason).toBe('OAUTH_STATE');
    expect(result.session).toBeNull();
  });

  it('sin la cookie de state (el link se abrió en otro navegador): no entra', async () => {
    const result = await oauthFlow('google', profile(), { tamper: (state) => ({ state, cookie: null }) });
    expect(result.reason).toBe('OAUTH_STATE');
  });

  it('cookie adulterada o vencida: no entra', async () => {
    const tampered = await oauthFlow('google', profile(), {
      tamper: (state, cookie) => {
        const opened = openState(cookie, SECRET)!;
        // Firmada con otro secreto: como si alguien la hubiera fabricado.
        return { state, cookie: sealState({ ...opened }, 'otro-secreto-que-no-es-el-del-servidor') };
      },
    });
    expect(tampered.reason).toBe('OAUTH_STATE');

    const expired = await oauthFlow('google', profile(), {
      tamper: (state, cookie) => {
        const opened = openState(cookie, SECRET)!;
        return { state, cookie: sealState({ ...opened, expiresAt: Date.now() - 1 }, SECRET) };
      },
    });
    expect(expired.reason).toBe('OAUTH_STATE');
  });

  it('la cookie de un proveedor no sirve para la vuelta de otro', async () => {
    const start = await fetch(`${url}/api/auth/google`, { redirect: 'manual' });
    const state = new URL(start.headers.get('location')!).searchParams.get('state')!;
    const cookie = cookieValue(start.headers.getSetCookie(), 'flagazo_oauth');
    const callback = await fetch(`${url}/api/auth/discord/callback?code=x&state=${state}`, {
      redirect: 'manual',
      headers: { cookie: `flagazo_oauth=${cookie}` },
    });
    expect(new URL(callback.headers.get('location')!, url).searchParams.get('reason')).toBe('OAUTH_STATE');
  });

  it('si el jugador cancela en el proveedor', async () => {
    const callback = await fetch(`${url}/api/auth/google/callback?error=access_denied&state=x`, { redirect: 'manual' });
    expect(callback.headers.get('location')).toBe('/?auth=error&reason=OAUTH_CANCELLED');
  });

  it('si el proveedor falla al dar el token, o el PKCE no coincide', async () => {
    failToken = true;
    const failed = await oauthFlow('google', profile());
    failToken = false;
    expect(failed.reason).toBe('OAUTH_FAILED');

    // PKCE: el proveedor falso exige el verificador que corresponde al challenge.
    const n = unique();
    const start = await fetch(`${url}/api/auth/google`, { redirect: 'manual' });
    const authorize = new URL(start.headers.get('location')!);
    const cookie = cookieValue(start.headers.getSetCookie(), 'flagazo_oauth')!;
    pendingCodes.set(`pkce-${n}`, { profile: profile(), challenge: 'challenge-de-otro-pedido', clientSecret: 'google-secret' });
    const callback = await fetch(`${url}/api/auth/google/callback?code=pkce-${n}&state=${authorize.searchParams.get('state')}`, {
      redirect: 'manual',
      headers: { cookie: `flagazo_oauth=${cookie}` },
    });
    expect(new URL(callback.headers.get('location')!, url).searchParams.get('reason')).toBe('OAUTH_FAILED');
  });

  it('un proveedor que no está configurado', async () => {
    const response = await fetch(`${url}/api/auth/twitter`, { redirect: 'manual' });
    expect(response.headers.get('location')).toBe('/?auth=error&reason=OAUTH_NOT_CONFIGURED');
  });

  it('/me dice qué botones mostrar', async () => {
    expect((await me(null)).providers).toEqual(['google', 'discord']);
  });
});

describe('username a partir del nombre del proveedor', () => {
  it('limpia lo que el nickname no admite', () => {
    expect(usernameBaseForTests('José María')).toBe('José María');
    expect(usernameBaseForTests('🔥🔥 xX_Pro_Xx 🔥')).toBe('xX_Pro_Xx');
    expect(usernameBaseForTests('Un nombre larguísimo de verdad')).toBe('Un nombre larguí');
    expect(usernameBaseForTests('🔥')).toBeNull();
    expect(usernameBaseForTests(null)).toBeNull();
  });
});
