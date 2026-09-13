/**
 * Cuentas de punta a punta: servidor HTTP real, base Postgres real (PGlite en
 * memoria), cookies reales y un buzón en memoria en lugar de Resend. Prueba el
 * contrato tal como lo ve el navegador.
 */
import type { AddressInfo } from 'node:net';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AUTH_CODE } from '@flagazo/shared';
import type { AccountInfo, ApiResult, MeResponse, RegisterResponse } from '@flagazo/shared';
import { createGameServer } from '../app';
import { openMemoryDatabase } from '../db/client';
import type { DatabaseHandle } from '../db/client';
import { authCodes, authIdentities, authSessions, leaderboardEntries, userStats, users } from '../db/schema';
import { MemoryMailer } from '../email/mailer';
import { AccountService, UNVERIFIED_ACCOUNT_TTL_MS } from './accounts';
import { SESSION_LIFETIME, SessionService } from './sessions';

const SECRET = 'secreto-de-tests-con-mas-de-32-caracteres!!';

let database: DatabaseHandle;
let server: ReturnType<typeof createGameServer>;
let url: string;
const mailer = new MemoryMailer();

beforeAll(async () => {
  database = await openMemoryDatabase();
  server = createGameServer({
    accounts: { db: database.db, mailer, secret: SECRET },
    apiLimits: {
      registerPerIp: [1000, 60_000],
      loginPerIp: [1000, 60_000],
      loginPerEmail: [5, 60_000],
      codePerIp: [1000, 60_000],
      emailPerIp: [1000, 60_000],
      oauthPerIp: [1000, 60_000],
      avatarPerUser: [1000, 60_000],
      deletePerUser: [4, 60_000],
    },
  });
  await new Promise<void>((resolve) => server.httpServer.listen(0, resolve));
  url = `http://localhost:${(server.httpServer.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await server.close();
  await database.close();
});

let counter = 0;
/** Datos de una cuenta que no choca con ninguna otra del archivo. */
function fresh() {
  counter++;
  return { username: `Jugador${counter}`, email: `jugador${counter}@example.com`, password: 'caballo-bateria-9' };
}

async function api<T>(
  path: string,
  options: { method?: string; body?: unknown; cookie?: string; headers?: Record<string, string> } = {},
) {
  const response = await fetch(`${url}/api${path}`, {
    method: options.method ?? (options.body === undefined ? 'GET' : 'POST'),
    headers: {
      ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(options.cookie ? { cookie: options.cookie } : {}),
      ...options.headers,
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const setCookie = response.headers.getSetCookie();
  const body = (await response.json()) as ApiResult<T>;
  return { status: response.status, body, setCookie };
}

/** "flagazo_sid=abc; Path=/; HttpOnly" → "flagazo_sid=abc", listo para mandar. */
function cookieFrom(setCookie: string[]): string {
  const header = setCookie.find((value) => value.startsWith('flagazo_sid='));
  if (!header) throw new Error('No vino la cookie de sesión');
  return header.split(';')[0]!;
}

function mailsTo(email: string) {
  return mailer.sent.filter((message) => message.to === email);
}

/** El código del último email que recibió esa dirección. */
function lastCode(email: string): string {
  const message = mailer.lastTo(email);
  const code = message?.text.match(/\b(\d{6})\b/)?.[1];
  if (!code) throw new Error(`No llegó ningún código a ${email}`);
  return code;
}

/** Hace como si el último código se hubiera pedido hace rato: saltea la espera entre pedidos. */
async function ageCodes(email: string, ms = AUTH_CODE.resendCooldownMs + 1000) {
  const user = await database.db.query.users.findFirst({ where: eq(users.email, email) });
  await database.db
    .update(authCodes)
    .set({ createdAt: sql`${authCodes.createdAt} - ${`${ms} milliseconds`}::interval` })
    .where(eq(authCodes.userId, user!.id));
}

async function register(data = fresh(), extra: Record<string, unknown> = {}) {
  const result = await api<RegisterResponse>('/auth/register', { body: { ...data, remember: false, ...extra } });
  return { ...result, data };
}

async function verify(email: string, code: string, remember = false) {
  return api<{ account: AccountInfo }>('/auth/verify-email', { body: { email, code, remember } });
}

/** Cuenta registrada y verificada, con su cookie de sesión. */
async function registered(remember = false) {
  const { data } = await register();
  const result = await verify(data.email, lastCode(data.email), remember);
  if (!result.body.ok) throw new Error(`No se pudo verificar: ${JSON.stringify(result.body)}`);
  return { data, account: result.body.data.account, cookie: cookieFrom(result.setCookie), setCookie: result.setCookie };
}

describe('registro', () => {
  it('crea la cuenta sin sesión, pendiente de verificar, y manda el código por email', async () => {
    const { status, body, setCookie, data } = await register();
    expect(status).toBe(202);
    expect(body).toEqual({ ok: true, data: { verificationRequired: true, email: data.email } });
    // Todavía no se entra: se entra al verificar.
    expect(setCookie).toEqual([]);

    const row = await database.db.query.users.findFirst({ where: eq(users.email, data.email) });
    expect(row?.emailVerifiedAt).toBeNull();

    const message = mailer.lastTo(data.email)!;
    expect(message.subject).toMatch(/^\d{6} is your Flagazo code$/);
    expect(message.text).toContain('FLAGAZO');
    expect(message.text).toContain('expires in 10 minutes');
    expect(message.html).toContain(lastCode(data.email));
  });

  it('el email llega en el idioma del jugador', async () => {
    const { data } = await register(fresh(), { locale: 'es' });
    const message = mailer.lastTo(data.email)!;
    expect(message.subject).toMatch(/es tu código de Flagazo$/);
    expect(message.text).toContain('Tu código de verificación es:');
    expect(message.text).toContain('Este código vence en 10 minutos.');
    expect(message.text).toContain('Si no creaste una cuenta en Flagazo, puedes ignorar este mensaje.');
  });

  it('con un email que ya tiene cuenta responde exactamente igual, y al dueño le llega un aviso sin código', async () => {
    const owner = await registered();
    const before = mailsTo(owner.data.email).length;

    const attempt = await register({ ...fresh(), email: owner.data.email.toUpperCase() });
    const brandNew = await register();
    expect(attempt.status).toBe(brandNew.status);
    expect(Object.keys(attempt.body)).toEqual(Object.keys(brandNew.body));
    expect(attempt.body).toEqual({ ok: true, data: { verificationRequired: true, email: owner.data.email.toUpperCase() } });
    expect(attempt.setCookie).toEqual([]);

    const notices = mailsTo(owner.data.email).slice(before);
    expect(notices).toHaveLength(1);
    expect(notices[0]!.subject).toBe('You already have a Flagazo account');
    expect(notices[0]!.text).not.toMatch(/\b\d{6}\b/);

    // Insistir no llena el buzón del dueño: un aviso por hora.
    await register({ ...fresh(), email: owner.data.email });
    expect(mailsTo(owner.data.email).slice(before)).toHaveLength(1);

    // Y la cuenta del dueño sigue intacta: su contraseña es la de siempre.
    const login = await api('/auth/login', { body: { email: owner.data.email, password: owner.data.password } });
    expect(login.status).toBe(200);
  });

  it('rechaza un username que ya existe, aunque cambien mayúsculas o tildes', async () => {
    await register({ username: 'Martín', email: 'martin1@example.com', password: 'caballo-bateria-9' });
    const { status, body } = await register({ username: 'MARTIN', email: 'martin2@example.com', password: 'caballo-bateria-9' });
    expect(status).toBe(409);
    expect(body).toMatchObject({ ok: false, error: 'USERNAME_TAKEN', field: 'username' });
  });

  it('valida cada campo y dice cuál está mal', async () => {
    const cases: [Record<string, unknown>, string, string][] = [
      [{ username: 'a' }, 'USERNAME_INVALID', 'username'],
      [{ username: 'con<html>' }, 'USERNAME_INVALID', 'username'],
      [{ email: 'no-es-un-email' }, 'EMAIL_INVALID', 'email'],
      [{ password: 'corta' }, 'PASSWORD_INVALID', 'password'],
      [{ password: 'x'.repeat(129) }, 'PASSWORD_INVALID', 'password'],
      [{ password: 'Password123' }, 'PASSWORD_TOO_COMMON', 'password'],
    ];
    for (const [patch, error, field] of cases) {
      const { status, body } = await register({ ...fresh(), ...patch } as ReturnType<typeof fresh>);
      expect(status, JSON.stringify(patch)).toBe(400);
      expect(body).toMatchObject({ ok: false, error, field });
    }
  });

  it('no deja usar el propio email o username como contraseña', async () => {
    const data = fresh();
    const { body } = await register({ ...data, password: data.email });
    expect(body).toMatchObject({ ok: false, error: 'PASSWORD_INVALID', reason: 'PASSWORD_LIKE_ACCOUNT' });
  });

  it('nunca guarda la contraseña ni el código: guarda un hash Argon2id y un HMAC', async () => {
    const { data } = await register();
    const row = await database.db.query.users.findFirst({ where: eq(users.email, data.email) });
    expect(row?.passwordHash).toMatch(/^\$argon2id\$/);
    expect(row?.passwordHash).not.toContain(data.password);

    const codes = await database.db.select().from(authCodes).where(eq(authCodes.userId, row!.id));
    expect(codes).toHaveLength(1);
    expect(codes[0]!.codeHash).toMatch(/^[a-f0-9]{64}$/);
    expect(codes[0]!.codeHash).not.toContain(lastCode(data.email));
  });

  it('dos registros simultáneos con el mismo nombre: entra uno solo', async () => {
    const base = fresh();
    const results = await Promise.all([
      register({ ...base, email: 'carrera1@example.com' }),
      register({ ...base, email: 'carrera2@example.com' }),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([202, 409]);
  });

  it('rechaza cuerpos que no son JSON o están rotos', async () => {
    const notJson = await fetch(`${url}/api/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: 'username=x',
    });
    expect(notJson.status).toBe(400);

    const broken = await fetch(`${url}/api/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"username":',
    });
    expect(broken.status).toBe(400);
    expect(await broken.json()).toMatchObject({ ok: false, error: 'BAD_REQUEST' });
  });
});

describe('verificación de email', () => {
  it('con el código correcto verifica la cuenta y entra', async () => {
    const { data } = await register();
    const { status, body, setCookie } = await verify(data.email.toUpperCase(), lastCode(data.email), true);
    expect(status).toBe(200);
    expect(body.ok && body.data.account).toMatchObject({ username: data.username, emailVerified: true });
    // Respeta el "mantener sesión" del formulario.
    expect(setCookie.find((value) => value.startsWith('flagazo_sid='))).toMatch(/Max-Age=2592000/);

    const me = await api<MeResponse>('/me', { cookie: cookieFrom(setCookie) });
    expect(me.body.ok && me.body.data.account?.emailVerified).toBe(true);
  });

  it('código incorrecto: avisa, y al quinto intento el código queda inutilizable', async () => {
    const { data } = await register();
    const good = lastCode(data.email);
    const bad = good === '000000' ? '111111' : '000000';

    for (let i = 0; i < AUTH_CODE.maxAttempts - 1; i++) {
      expect((await verify(data.email, bad)).body).toMatchObject({ ok: false, error: 'CODE_INVALID', field: 'code' });
    }
    expect((await verify(data.email, bad)).body).toMatchObject({ ok: false, error: 'CODE_LOCKED' });
    // Bloqueado aunque ahora acierte: si no, el tope de intentos no protegería nada.
    expect((await verify(data.email, good)).body).toMatchObject({ ok: false, error: 'CODE_LOCKED' });

    // Un código nuevo sí sirve.
    await ageCodes(data.email);
    await api('/auth/resend-verification', { body: { email: data.email } });
    expect((await verify(data.email, lastCode(data.email))).status).toBe(200);
  });

  it('código vencido', async () => {
    const { data } = await register();
    const user = await database.db.query.users.findFirst({ where: eq(users.email, data.email) });
    await database.db
      .update(authCodes)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(authCodes.userId, user!.id));

    const { status, body } = await verify(data.email, lastCode(data.email));
    expect(status).toBe(400);
    expect(body).toMatchObject({ ok: false, error: 'CODE_EXPIRED', field: 'code' });
  });

  it('un código se usa una sola vez; repetirlo dice "ya verificado" solo a quien lo tiene', async () => {
    const { data } = await register();
    const code = lastCode(data.email);
    expect((await verify(data.email, code)).status).toBe(200);

    const again = await verify(data.email, code);
    expect(again.body).toEqual({ ok: false, error: 'ALREADY_VERIFIED' });
    expect(again.setCookie).toEqual([]);

    // Con otro código, lo mismo que para una cuenta que no existe.
    const other = code === '123456' ? '654321' : '123456';
    expect((await verify(data.email, other)).body).toEqual((await verify('nadie@example.com', other)).body);
  });

  it('dos verificaciones simultáneas con el mismo código: entra una sola', async () => {
    const { data } = await register();
    const code = lastCode(data.email);
    const results = await Promise.all([verify(data.email, code), verify(data.email, code)]);
    expect(results.filter((result) => result.status === 200)).toHaveLength(1);
  });

  it('el código de una cuenta no sirve para otra, ni para otra cosa', async () => {
    const a = await register();
    const b = await register();
    expect((await verify(b.data.email, lastCode(a.data.email))).body).toMatchObject({ error: 'CODE_INVALID' });

    // Un código de recuperar contraseña no verifica la cuenta.
    await ageCodes(b.data.email);
    await api('/auth/forgot-password', { body: { email: b.data.email } });
    expect((await verify(b.data.email, lastCode(b.data.email))).body).toMatchObject({ error: 'CODE_INVALID' });
  });
});

describe('reenviar el código', () => {
  it('manda uno nuevo e invalida el anterior', async () => {
    const { data } = await register();
    const first = lastCode(data.email);
    await ageCodes(data.email);

    expect((await api('/auth/resend-verification', { body: { email: data.email } })).body).toEqual({ ok: true, data: null });
    const second = lastCode(data.email);
    expect(mailsTo(data.email)).toHaveLength(2);

    if (first !== second) {
      expect((await verify(data.email, first)).body).toMatchObject({ error: 'CODE_INVALID' });
    }
    expect((await verify(data.email, second)).status).toBe(200);
  });

  it('pedirlo enseguida no manda otro, pero responde igual (no delata la cuenta)', async () => {
    const { data } = await register();
    const response = await api('/auth/resend-verification', { body: { email: data.email } });
    expect(response.body).toEqual({ ok: true, data: null });
    expect(mailsTo(data.email)).toHaveLength(1);
  });

  it('no más de cinco códigos por hora', async () => {
    const { data } = await register();
    for (let i = 0; i < 8; i++) {
      await ageCodes(data.email);
      await api('/auth/resend-verification', { body: { email: data.email } });
    }
    // El de registro más los reenvíos, con tope en la hora.
    // `ageCodes` corre todo 61 s hacia atrás por vuelta: los 5 primeros siguen dentro de la hora.
    expect(mailsTo(data.email)).toHaveLength(AUTH_CODE.maxPerHour);
  });

  it('para un email sin cuenta, o ya verificado, responde igual y no manda nada', async () => {
    const verified = await registered();
    const before = mailer.sent.length;
    const unknown = await api('/auth/resend-verification', { body: { email: 'fantasma@example.com' } });
    const done = await api('/auth/resend-verification', { body: { email: verified.data.email } });
    expect(unknown.body).toEqual({ ok: true, data: null });
    expect(done.body).toEqual(unknown.body);
    expect(mailer.sent.length).toBe(before);
  });
});

describe('login', () => {
  it('entra con email y contraseña, sin importar mayúsculas del email', async () => {
    const { data } = await registered();
    const { status, body, setCookie } = await api<{ account: AccountInfo }>('/auth/login', {
      body: { email: data.email.toUpperCase(), password: data.password, remember: false },
    });
    expect(status).toBe(200);
    expect(body.ok && body.data.account.username).toBe(data.username);
    expect(cookieFrom(setCookie)).toMatch(/^flagazo_sid=/);
  });

  it('contraseña incorrecta y cuenta inexistente responden exactamente lo mismo', async () => {
    const { data } = await registered();
    const wrong = await api('/auth/login', { body: { email: data.email, password: 'otra-cosa-123' } });
    const missing = await api('/auth/login', { body: { email: 'nadie@example.com', password: 'otra-cosa-123' } });

    expect(wrong.status).toBe(401);
    expect(missing.status).toBe(401);
    expect(wrong.body).toEqual(missing.body);
    expect(wrong.body).toEqual({ ok: false, error: 'INVALID_CREDENTIALS' });
    expect(wrong.setCookie).toEqual([]);
  });

  it('cuenta sin verificar: con la contraseña correcta lo dice y manda un código; sin ella, no dice nada', async () => {
    const { data } = await register();
    const wrong = await api('/auth/login', { body: { email: data.email, password: 'otra-cosa-123' } });
    expect(wrong.body).toEqual({ ok: false, error: 'INVALID_CREDENTIALS' });

    await ageCodes(data.email);
    const right = await api('/auth/login', { body: { email: data.email, password: data.password } });
    expect(right.status).toBe(403);
    expect(right.body).toEqual({ ok: false, error: 'EMAIL_NOT_VERIFIED' });
    expect(right.setCookie).toEqual([]);
    expect(mailsTo(data.email)).toHaveLength(2);

    // Con ese código verifica y entra.
    expect((await verify(data.email, lastCode(data.email))).status).toBe(200);
  });

  it('corta los intentos repetidos contra una misma cuenta', async () => {
    const { data } = await registered();
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      statuses.push((await api('/auth/login', { body: { email: data.email, password: `mala-${i}-xyz` } })).status);
    }
    expect(statuses).toEqual([401, 401, 401, 401, 401, 429]);

    // Bloqueada también con la contraseña correcta: si no, el límite no protege nada.
    const blocked = await api('/auth/login', { body: { email: data.email, password: data.password } });
    expect(blocked.status).toBe(429);
    expect(blocked.body).toMatchObject({ ok: false, error: 'RATE_LIMITED', retryAfterMs: expect.any(Number) });
  });
});

describe('recuperar la contraseña', () => {
  it('para un email sin cuenta responde igual y no manda nada', async () => {
    const before = mailer.sent.length;
    const response = await api('/auth/forgot-password', { body: { email: 'fantasma@example.com', locale: 'es' } });
    expect(response.body).toEqual({ ok: true, data: null });
    expect(mailer.sent.length).toBe(before);
  });

  it('manda un código, cambia la contraseña, cierra las otras sesiones y entra', async () => {
    const { data, cookie: oldSession } = await registered();
    const forgot = await api('/auth/forgot-password', { body: { email: data.email, locale: 'es' } });
    expect(forgot.body).toEqual({ ok: true, data: null });
    const message = mailer.lastTo(data.email)!;
    expect(message.subject).toMatch(/es tu código para cambiar la contraseña$/);

    const reset = await api<{ account: AccountInfo }>('/auth/reset-password', {
      body: { email: data.email, code: lastCode(data.email), password: 'nueva-clave-segura-42', remember: false },
    });
    expect(reset.status).toBe(200);
    const newSession = cookieFrom(reset.setCookie);

    // La sesión de antes queda afuera; la nueva funciona.
    expect((await api<MeResponse>('/me', { cookie: oldSession })).body).toEqual({
      ok: true,
      data: { accountsEnabled: true, providers: [], account: null },
    });
    expect((await api<MeResponse>('/me', { cookie: newSession })).body).toMatchObject({
      data: { account: { username: data.username } },
    });

    // La contraseña vieja ya no entra; la nueva sí.
    expect((await api('/auth/login', { body: { email: data.email, password: data.password } })).status).toBe(401);
    expect((await api('/auth/login', { body: { email: data.email, password: 'nueva-clave-segura-42' } })).status).toBe(200);
  });

  it('código incorrecto, contraseña débil y código reusado', async () => {
    const { data } = await registered();
    await api('/auth/forgot-password', { body: { email: data.email } });
    const code = lastCode(data.email);
    const other = code === '000000' ? '111111' : '000000';

    const weak = await api('/auth/reset-password', { body: { email: data.email, code, password: 'corta' } });
    expect(weak.body).toMatchObject({ ok: false, error: 'PASSWORD_INVALID', field: 'password' });

    const wrong = await api('/auth/reset-password', { body: { email: data.email, code: other, password: 'nueva-clave-segura-42' } });
    expect(wrong.body).toMatchObject({ ok: false, error: 'CODE_INVALID', field: 'code' });

    expect((await api('/auth/reset-password', { body: { email: data.email, code, password: 'nueva-clave-segura-42' } })).status).toBe(200);
    const reused = await api('/auth/reset-password', { body: { email: data.email, code, password: 'otra-clave-segura-43' } });
    expect(reused.body).toMatchObject({ ok: false, error: 'CODE_INVALID' });
  });

  it('un código anterior no revive después de usar el último', async () => {
    const { data } = await registered();
    await api('/auth/forgot-password', { body: { email: data.email } });
    const old = lastCode(data.email);
    await ageCodes(data.email);
    await api('/auth/forgot-password', { body: { email: data.email } });
    const latest = lastCode(data.email);

    expect((await api('/auth/reset-password', { body: { email: data.email, code: latest, password: 'nueva-clave-segura-42' } })).status).toBe(200);
    if (old !== latest) {
      const revived = await api('/auth/reset-password', { body: { email: data.email, code: old, password: 'otra-clave-segura-43' } });
      expect(revived.body).toMatchObject({ ok: false, error: 'CODE_INVALID' });
    }
  });

  it('recuperar la contraseña también verifica una cuenta pendiente (el código prueba el email)', async () => {
    const { data } = await register();
    await ageCodes(data.email);
    await api('/auth/forgot-password', { body: { email: data.email } });
    const reset = await api<{ account: AccountInfo }>('/auth/reset-password', {
      body: { email: data.email, code: lastCode(data.email), password: 'nueva-clave-segura-42' },
    });
    expect(reset.body.ok && reset.body.data.account.emailVerified).toBe(true);
  });
});

describe('sesión', () => {
  it('cerrar sesión borra la cookie y la invalida en el servidor', async () => {
    const { cookie } = await registered();

    const logout = await api('/auth/logout', { body: {}, cookie });
    expect(logout.status).toBe(200);
    expect(logout.setCookie.find((value) => value.startsWith('flagazo_sid='))).toMatch(/Expires=Thu, 01 Jan 1970/);

    // Aunque alguien se hubiera guardado la cookie, ya no sirve.
    const me = await api<MeResponse>('/me', { cookie });
    expect(me.body).toEqual({ ok: true, data: { accountsEnabled: true, providers: [], account: null } });
  });

  it('sin "mantener sesión", la cookie es del navegador y no tiene vencimiento', async () => {
    const { setCookie } = await registered(false);
    const header = setCookie.find((value) => value.startsWith('flagazo_sid='))!;
    expect(header).toMatch(/HttpOnly/i);
    expect(header).toMatch(/SameSite=Lax/i);
    expect(header).not.toMatch(/Max-Age|Expires/i);
  });

  it('la sesión sigue viva en pedidos nuevos, como tras recargar la página', async () => {
    const { data, cookie } = await registered();
    for (let i = 0; i < 3; i++) {
      const me = await api<MeResponse>('/me', { cookie });
      expect(me.body.ok && me.body.data.account?.username).toBe(data.username);
    }
  });

  it('una cookie inventada no entra, y el servidor la manda a borrar', async () => {
    const me = await api<MeResponse>('/me', { cookie: `flagazo_sid=${'a'.repeat(43)}` });
    expect(me.body).toEqual({ ok: true, data: { accountsEnabled: true, providers: [], account: null } });
    expect(me.setCookie.find((value) => value.startsWith('flagazo_sid='))).toMatch(/Expires=Thu, 01 Jan 1970/);
  });

  it('en la base guarda el hash del token, no el token', async () => {
    const { cookie } = await registered();
    const token = cookie.split('=')[1]!;
    const rows = await database.db.select().from(authSessions);
    expect(rows.some((row) => row.tokenHash === token)).toBe(false);
    expect(rows.every((row) => /^[a-f0-9]{64}$/.test(row.tokenHash))).toBe(true);
  });

  it('vence: una sesión sin "mantener" no pasa de 24 horas', async () => {
    const { account } = await registered();
    const sessions = new SessionService(database.db);
    const start = new Date('2026-09-01T10:00:00Z');
    const { token } = await sessions.create(account.id, false, start);

    expect(await sessions.resolve(token, new Date(start.getTime() + 23 * 3_600_000))).not.toBeNull();
    expect(await sessions.resolve(token, new Date(start.getTime() + SESSION_LIFETIME.browserMs + 1))).toBeNull();
  });

  it('una sesión persistente se estira mientras se usa', async () => {
    const { account } = await registered();
    const sessions = new SessionService(database.db);
    const start = new Date('2026-09-01T10:00:00Z');
    const { token } = await sessions.create(account.id, true, start);

    // Usada a los 20 días: se renueva por 30 más desde ahí.
    const day20 = new Date(start.getTime() + 20 * 86_400_000);
    expect((await sessions.resolve(token, day20))?.renewed).toBe(true);

    // Pasados los 30 días originales sigue viva (y este uso la vuelve a estirar).
    const day45 = new Date(start.getTime() + 45 * 86_400_000);
    expect(await sessions.resolve(token, day45)).not.toBeNull();

    // Abandonada 31 días desde el último uso: vence.
    expect(await sessions.resolve(token, new Date(day45.getTime() + 31 * 86_400_000))).toBeNull();
  });

  it('borrar las vencidas no toca las vigentes', async () => {
    const { account } = await registered();
    const sessions = new SessionService(database.db);
    const old = await sessions.create(account.id, false, new Date('2020-01-01T00:00:00Z'));
    const current = await sessions.create(account.id, true);

    expect(await sessions.sweep()).toBeGreaterThanOrEqual(1);
    expect(await sessions.resolve(old.token)).toBeNull();
    expect(await sessions.resolve(current.token)).not.toBeNull();
  });
});

describe('borrar la cuenta', () => {
  it('con el username y la contraseña borra la cuenta y todo lo suyo, y cierra todas las sesiones', async () => {
    const { data, account, cookie } = await registered(true);
    // Otra sesión abierta de la misma cuenta, en otro dispositivo.
    const other = cookieFrom((await api('/auth/login', { body: { email: data.email, password: data.password, remember: true } })).setCookie);
    await database.db.insert(authIdentities).values({ userId: account.id, provider: 'google', providerUserId: `g-borrar-${counter}` });
    await database.db.insert(userStats).values({ userId: account.id, gamesPlayed: 3 });
    await database.db.insert(leaderboardEntries).values({ period: '2026-09', metric: 'points', userId: account.id, value: 900 });

    const removed = await api('/me/delete', { body: { confirm: data.username, password: data.password }, cookie });
    expect(removed.status).toBe(200);
    expect(removed.body).toEqual({ ok: true, data: null });
    expect(removed.setCookie.find((value) => value.startsWith('flagazo_sid='))).toMatch(/Expires=Thu, 01 Jan 1970/);

    for (const session of [cookie, other]) {
      expect((await api<MeResponse>('/me', { cookie: session })).body).toMatchObject({ ok: true, data: { account: null } });
    }
    const where = eq(users.id, account.id);
    expect(await database.db.select().from(users).where(where)).toEqual([]);
    expect(await database.db.select().from(authSessions).where(eq(authSessions.userId, account.id))).toEqual([]);
    expect(await database.db.select().from(authIdentities).where(eq(authIdentities.userId, account.id))).toEqual([]);
    expect(await database.db.select().from(userStats).where(eq(userStats.userId, account.id))).toEqual([]);
    expect(await database.db.select().from(leaderboardEntries).where(eq(leaderboardEntries.userId, account.id))).toEqual([]);

    // La contraseña ya no entra, y el nombre y el email quedan libres.
    expect((await api('/auth/login', { body: { email: data.email, password: data.password } })).status).toBe(401);
    const again = await register(data);
    expect(again.status).toBe(202);
    expect((await verify(data.email, lastCode(data.email))).body).toMatchObject({ ok: true, data: { account: { username: data.username } } });
  });

  it('pide el username exacto (sin importar mayúsculas ni tildes) y la contraseña correcta', async () => {
    const { data, cookie } = await registered();

    const wrongName = await api('/me/delete', { body: { confirm: 'otro nombre', password: data.password }, cookie });
    expect(wrongName.status).toBe(400);
    expect(wrongName.body).toEqual({ ok: false, error: 'CONFIRMATION_INVALID', field: 'username' });

    const wrongPassword = await api('/me/delete', { body: { confirm: data.username, password: 'no-es-esta-99' }, cookie });
    expect(wrongPassword.status).toBe(401);
    expect(wrongPassword.body).toEqual({ ok: false, error: 'INVALID_CREDENTIALS', field: 'password' });

    const noPassword = await api('/me/delete', { body: { confirm: data.username }, cookie });
    expect(noPassword.body).toMatchObject({ ok: false, error: 'INVALID_CREDENTIALS' });

    // Nada de eso tocó la cuenta.
    expect((await api<MeResponse>('/me', { cookie })).body).toMatchObject({ ok: true, data: { account: { username: data.username } } });

    const upperCase = await api('/me/delete', { body: { confirm: data.username.toUpperCase(), password: data.password }, cookie });
    expect(upperCase.status).toBe(200);
  });

  it('corta los intentos repetidos: no sirve para adivinar la contraseña', async () => {
    const { data, cookie } = await registered();
    for (let i = 0; i < 4; i++) {
      await api('/me/delete', { body: { confirm: data.username, password: `intento-${i}-xyz` }, cookie });
    }
    const blocked = await api('/me/delete', { body: { confirm: data.username, password: data.password }, cookie });
    expect(blocked.status).toBe(429);
    expect((await api<MeResponse>('/me', { cookie })).body).toMatchObject({ ok: true, data: { account: { username: data.username } } });
  });

  it('una cuenta solo de Google o Discord no tiene contraseña: alcanza con el username', async () => {
    counter++;
    const username = `SinClave${counter}`;
    const [user] = await database.db
      .insert(users)
      .values({ username, usernameKey: username.toLowerCase(), email: `sinclave${counter}@gmail.com`, emailKey: `sinclave${counter}@gmail.com`, emailVerifiedAt: new Date() })
      .returning();
    const { token } = await new SessionService(database.db).create(user!.id, true);

    const removed = await api('/me/delete', { body: { confirm: username }, cookie: `flagazo_sid=${token}` });
    expect(removed.status).toBe(200);
    expect(await database.db.select().from(users).where(eq(users.id, user!.id))).toEqual([]);
  });

  it('sin sesión, o desde otro sitio, no borra nada', async () => {
    const { data, cookie } = await registered();
    const body = { confirm: data.username, password: data.password };
    expect((await api('/me/delete', { body })).status).toBe(401);
    expect((await api('/me/delete', { body, cookie, headers: { 'sec-fetch-site': 'cross-site' } })).status).toBe(403);
    expect((await api<MeResponse>('/me', { cookie })).body).toMatchObject({ ok: true, data: { account: { username: data.username } } });
  });
});

describe('mantenimiento', () => {
  it('borra las cuentas que nunca se verificaron después de una semana, y libera el nombre', async () => {
    const pending = await register();
    const verified = await registered();
    const longAgo = new Date(Date.now() - UNVERIFIED_ACCOUNT_TTL_MS - 60_000);
    for (const email of [pending.data.email, verified.data.email]) {
      await database.db.update(users).set({ createdAt: longAgo }).where(eq(users.email, email));
    }

    const service = new AccountService({ db: database.db, mailer, secret: SECRET });
    expect(await service.sweepUnverified()).toBeGreaterThanOrEqual(1);

    expect(await database.db.query.users.findFirst({ where: eq(users.email, pending.data.email) })).toBeUndefined();
    expect(await database.db.query.users.findFirst({ where: eq(users.email, verified.data.email) })).toBeDefined();
    // El nombre quedó libre.
    expect((await register({ ...fresh(), username: pending.data.username })).status).toBe(202);
  });
});

describe('protecciones de la API', () => {
  it('rechaza escrituras desde otro sitio (CSRF)', async () => {
    const fromOtherOrigin = await api('/auth/register', {
      body: { ...fresh(), remember: false },
      headers: { origin: 'https://sitio-malo.example' },
    });
    expect(fromOtherOrigin.status).toBe(403);
    expect(fromOtherOrigin.body).toEqual({ ok: false, error: 'FORBIDDEN_ORIGIN' });

    const crossSite = await api('/auth/logout', { body: {}, headers: { 'sec-fetch-site': 'cross-site' } });
    expect(crossSite.status).toBe(403);
  });

  it('acepta escrituras desde la propia página', async () => {
    const { status } = await api('/auth/register', {
      body: { ...fresh(), remember: false },
      headers: { origin: url, 'sec-fetch-site': 'same-origin' },
    });
    expect(status).toBe(202);
  });

  it('con Sec-Fetch-Site confía en el navegador aunque un proxy haya cambiado el Host', async () => {
    const { status } = await api('/auth/register', {
      body: { ...fresh(), remember: false },
      headers: { origin: 'http://localhost:5173', 'sec-fetch-site': 'same-origin' },
    });
    expect(status).toBe(202);
  });

  it('las respuestas no se guardan en caché', async () => {
    const response = await fetch(`${url}/api/me`);
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('una ruta de la API que no existe responde JSON, no la página', async () => {
    const response = await fetch(`${url}/api/no-existe`, { headers: { accept: 'text/html' } });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ ok: false, error: 'NOT_FOUND' });
  });

  it('si el envío del email falla, el registro responde igual y se puede pedir otro código', async () => {
    mailer.fail = true;
    const { status, data } = await register();
    mailer.fail = false;
    expect(status).toBe(202);
    expect(mailsTo(data.email)).toHaveLength(0);

    await ageCodes(data.email);
    await api('/auth/resend-verification', { body: { email: data.email } });
    expect((await verify(data.email, lastCode(data.email))).status).toBe(200);
  });
});

describe('servidor sin cuentas', () => {
  it('avisa que las cuentas están apagadas y el resto sigue funcionando', async () => {
    const bare = createGameServer();
    await new Promise<void>((resolve) => bare.httpServer.listen(0, resolve));
    const bareUrl = `http://localhost:${(bare.httpServer.address() as AddressInfo).port}`;
    try {
      const me = await fetch(`${bareUrl}/api/me`);
      expect(await me.json()).toEqual({ ok: true, data: { accountsEnabled: false, providers: [], account: null } });

      for (const path of ['register', 'login', 'verify-email', 'forgot-password']) {
        const response = await fetch(`${bareUrl}/api/auth/${path}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(fresh()),
        });
        expect(response.status, path).toBe(503);
      }

      const health = await fetch(`${bareUrl}/health`);
      expect(health.status).toBe(200);
    } finally {
      await bare.close();
    }
  });
});
