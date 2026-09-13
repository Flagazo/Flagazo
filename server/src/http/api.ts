import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import {
  AVATAR,
  OAUTH_PROVIDERS,
  emailKey,
  isLeaderboardMetric,
  isLeaderboardPeriod,
  isOAuthProvider,
  parseEmailLocale,
} from '@flagazo/shared';
import type {
  AccountInfo,
  ApiResult,
  AuthError,
  LeaderboardResponse,
  MeResponse,
  OAuthError,
  RegisterResponse,
  UserStatsSummary,
} from '@flagazo/shared';
import { AccountService, toAccountInfo } from '../auth/accounts';
import type { AccountDeps, AccountFailure } from '../auth/accounts';
import { parseCookies } from '../auth/cookies';
import { IdentityService } from '../auth/identities';
import {
  OAUTH_STATE_COOKIE,
  OAUTH_STATE_TTL_MS,
  authorizationUrl,
  fetchProfile,
  newOAuthState,
  openState,
  safeEqual,
  sealState,
} from '../auth/oauth';
import type { OAuthProviderConfig } from '../auth/oauth';
import { ProfileService } from '../auth/profile';
import type { ProfileOptions } from '../auth/profile';
import { RateLimiter } from '../auth/rateLimit';
import { SESSION_COOKIE, SESSION_LIFETIME, SessionService } from '../auth/sessions';
import type { UserRow } from '../db/schema';
import { LeaderboardService } from '../stats/leaderboard';
import { monthOf } from '../stats/recorder';
import { createLogger } from '../lib/log';

const log = createLogger('api');

const MINUTE = 60 * 1000;

/** Límites de intentos. Se inyectan para que los tests no tengan que hacer 30 logins. */
export interface ApiLimits {
  registerPerIp: [limit: number, windowMs: number];
  loginPerIp: [limit: number, windowMs: number];
  loginPerEmail: [limit: number, windowMs: number];
  /** Probar códigos. El tope fuerte es por código (5 intentos); este frena a quien rota emails. */
  codePerIp: [limit: number, windowMs: number];
  /** Pedidos que mandan un email (reenviar, recuperar): que la API no sirva para spamear. */
  emailPerIp: [limit: number, windowMs: number];
  /** Empezar un inicio de sesión con Google o Discord. */
  oauthPerIp: [limit: number, windowMs: number];
  /** Cambiar la foto de perfil. Procesar imágenes cuesta CPU. */
  avatarPerUser: [limit: number, windowMs: number];
}

/** Google y Discord. Van aparte de las cuentas: se pueden tener cuentas sin ninguno configurado. */
export interface OAuthOptions {
  providers: OAuthProviderConfig[];
  /**
   * La dirección pública del sitio, para armar la URL de vuelta que se registra
   * en Google y Discord (`https://flagazo.com`). Sin ella se deduce del pedido,
   * que alcanza en desarrollo.
   */
  publicUrl: string | null;
}

export const DEFAULT_API_LIMITS: ApiLimits = {
  registerPerIp: [10, 60 * MINUTE],
  loginPerIp: [30, 15 * MINUTE],
  loginPerEmail: [8, 15 * MINUTE],
  codePerIp: [30, 15 * MINUTE],
  emailPerIp: [10, 15 * MINUTE],
  oauthPerIp: [30, 15 * MINUTE],
  avatarPerUser: [20, 60 * MINUTE],
};

const STATUS: Record<AuthError, number> = {
  BAD_REQUEST: 400,
  USERNAME_INVALID: 400,
  EMAIL_INVALID: 400,
  PASSWORD_INVALID: 400,
  PASSWORD_TOO_COMMON: 400,
  USERNAME_TAKEN: 409,
  INVALID_CREDENTIALS: 401,
  EMAIL_NOT_VERIFIED: 403,
  CODE_INVALID: 400,
  CODE_EXPIRED: 400,
  CODE_LOCKED: 400,
  ALREADY_VERIFIED: 409,
  AVATAR_INVALID: 400,
  AVATAR_TOO_LARGE: 413,
  NO_PROVIDER_AVATAR: 404,
  UNAUTHENTICATED: 401,
  RATE_LIMITED: 429,
  FORBIDDEN_ORIGIN: 403,
  ACCOUNTS_DISABLED: 503,
  NOT_FOUND: 404,
  SERVER_ERROR: 500,
};

function sendOk<T>(res: Response, data: T, status = 200) {
  res.status(status).json({ ok: true, data } satisfies ApiResult<T>);
}

function sendError(res: Response, failure: AccountFailure & { retryAfterMs?: number }) {
  const body: ApiResult<never> = { ok: false, ...failure };
  if (failure.retryAfterMs) res.setHeader('Retry-After', Math.ceil(failure.retryAfterMs / 1000));
  res.status(STATUS[failure.error]).json(body);
}

/**
 * Rechaza escrituras que no vengan de la propia página.
 *
 * Es la defensa contra CSRF, en capas: la cookie ya es `SameSite=Lax` (otro sitio
 * no puede mandarla en un POST), el cuerpo tiene que ser JSON (un formulario de
 * otro sitio no puede mandar ese Content-Type sin permiso) y además se miran los
 * headers que pone el navegador y la página no puede falsificar.
 */
function sameOriginOnly(req: Request, res: Response, next: NextFunction) {
  if (req.method === 'GET' || req.method === 'HEAD') return next();

  // Los navegadores actuales dicen de dónde viene el pedido, y la página no puede
  // cambiarlo. Si está, alcanza: no depende de que el Host llegue intacto por proxies.
  const fetchSite = req.get('sec-fetch-site');
  if (fetchSite) {
    if (fetchSite === 'same-origin' || fetchSite === 'none') return next();
    return sendError(res, { error: 'FORBIDDEN_ORIGIN' });
  }
  // Navegadores viejos: se compara el Origin con el Host.
  const origin = req.get('origin');
  if (origin) {
    let host: string | null = null;
    try {
      host = new URL(origin).host;
    } catch {
      // Un Origin que ni siquiera es una URL: afuera.
    }
    if (host !== req.get('host')) return sendError(res, { error: 'FORBIDDEN_ORIGIN' });
  }
  next();
}

function isJsonObject(body: unknown): body is Record<string, unknown> {
  return typeof body === 'object' && body !== null && !Array.isArray(body);
}

/**
 * La API HTTP de cuentas, montada en `/api`.
 *
 * Todo lo del juego sigue por WebSocket. Esto es solo lo que tiene que funcionar
 * sin estar en una sala y lo que necesita cookies: registrarse, iniciar sesión,
 * el perfil. Con `deps` en null (servidor sin base, sin secreto o sin forma de
 * mandar emails) responde que las cuentas están apagadas y el cliente no muestra
 * nada de esto.
 */
export function createApiRouter(
  deps: AccountDeps | null,
  limits: ApiLimits = DEFAULT_API_LIMITS,
  oauth: OAuthOptions = { providers: [], publicUrl: null },
  profileOptions: ProfileOptions = {},
) {
  const router = express.Router();
  const limiters = {
    registerPerIp: new RateLimiter(...limits.registerPerIp),
    loginPerIp: new RateLimiter(...limits.loginPerIp),
    loginPerEmail: new RateLimiter(...limits.loginPerEmail),
    codePerIp: new RateLimiter(...limits.codePerIp),
    emailPerIp: new RateLimiter(...limits.emailPerIp),
    oauthPerIp: new RateLimiter(...limits.oauthPerIp),
    avatarPerUser: new RateLimiter(...limits.avatarPerUser),
  };

  router.use((_req, res, next) => {
    // Respuestas personales: ni el navegador ni un proxy intermedio las guardan.
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  router.use(sameOriginOnly);
  router.use(express.json({ limit: '8kb' }));

  const accounts = deps ? new AccountService(deps) : null;
  const sessions = deps ? new SessionService(deps.db) : null;
  const identities = deps ? new IdentityService(deps.db) : null;
  const profiles = deps ? new ProfileService(deps.db, profileOptions) : null;
  const leaderboard = deps ? new LeaderboardService(deps.db) : null;
  const providers = new Map(deps ? oauth.providers.map((provider) => [provider.id, provider] as const) : []);

  /** Lo que ve el dueño de la cuenta, con sus proveedores vinculados. */
  async function info(user: UserRow): Promise<AccountInfo> {
    return toAccountInfo(user, await identities!.linkedOf(user.id));
  }

  function sessionToken(req: Request) {
    return parseCookies(req.headers.cookie).get(SESSION_COOKIE);
  }

  function setSessionCookie(req: Request, res: Response, token: string, persistent: boolean) {
    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      // En producción Render termina el HTTPS y avisa por X-Forwarded-Proto
      // (`trust proxy` hace que Express le crea). En localhost no hay HTTPS.
      secure: req.secure,
      sameSite: 'lax',
      path: '/',
      // Sin maxAge es una cookie de sesión del navegador: se va al cerrarlo.
      ...(persistent ? { maxAge: SESSION_LIFETIME.persistentMs } : {}),
    });
  }

  function clearSessionCookie(req: Request, res: Response) {
    res.clearCookie(SESSION_COOKIE, { httpOnly: true, secure: req.secure, sameSite: 'lax', path: '/' });
  }

  /** Entra a la cuenta: crea la sesión y manda la cookie. */
  async function signIn(req: Request, res: Response, userId: string, remember: boolean) {
    const session = await sessions!.create(userId, remember);
    setSessionCookie(req, res, session.token, remember);
  }

  function limited(res: Response, result: { ok: true } | { ok: false; retryAfterMs: number }) {
    if (result.ok) return false;
    sendError(res, { error: 'RATE_LIMITED', retryAfterMs: result.retryAfterMs });
    return true;
  }

  // ── Estado de la cuenta ───────────────────────────────────

  router.get('/me', async (req, res) => {
    if (!sessions) return sendOk<MeResponse>(res, { accountsEnabled: false, providers: [], account: null });
    const enabledProviders = OAUTH_PROVIDERS.filter((id) => providers.has(id));

    const token = sessionToken(req);
    const session = await sessions.resolve(token);
    if (!session) {
      // Cookie vieja o inventada: se borra para no volver a mandarla en cada pedido.
      if (token) clearSessionCookie(req, res);
      return sendOk<MeResponse>(res, { accountsEnabled: true, providers: enabledProviders, account: null });
    }
    if (session.renewed && token) setSessionCookie(req, res, token, session.persistent);
    sendOk<MeResponse>(res, { accountsEnabled: true, providers: enabledProviders, account: await info(session.user) });
  });

  // ── Perfil ────────────────────────────────────────────────

  /** La sesión del pedido, o responde 401 y devuelve null. */
  async function requireSession(req: Request, res: Response) {
    if (!sessions) {
      sendError(res, { error: 'ACCOUNTS_DISABLED' });
      return null;
    }
    const session = await sessions.resolve(sessionToken(req));
    if (!session) sendError(res, { error: 'UNAUTHENTICATED' });
    return session;
  }

  function limitedAvatar(res: Response, userId: string) {
    return limited(res, limiters.avatarPerUser.hit(`user:${userId}`));
  }

  router.patch('/me', async (req, res) => {
    const session = await requireSession(req, res);
    if (!session) return;
    if (!isJsonObject(req.body)) return sendError(res, { error: 'BAD_REQUEST' });

    const result = await profiles!.changeUsername(session.user.id, req.body.username);
    if (!result.ok) return sendError(res, result);
    sendOk<{ account: AccountInfo }>(res, { account: await info(result.value) });
  });

  router.post(
    '/me/avatar',
    // Solo imágenes, y con tope: un formulario de otro sitio no puede mandar estos
    // tipos sin permiso del navegador, y nadie sube un archivo de 100 MB.
    express.raw({ type: AVATAR.types as string[], limit: AVATAR.maxUploadBytes }),
    async (req, res) => {
      const session = await requireSession(req, res);
      if (!session) return;
      if (!Buffer.isBuffer(req.body) || req.body.length === 0) return sendError(res, { error: 'AVATAR_INVALID' });
      if (limitedAvatar(res, session.user.id)) return;

      const result = await profiles!.setAvatar(session.user.id, req.body);
      if (!result.ok) return sendError(res, result);
      sendOk<{ account: AccountInfo }>(res, { account: await info(result.value) });
    },
  );

  router.post('/me/avatar/provider', async (req, res) => {
    const session = await requireSession(req, res);
    if (!session) return;
    if (!isJsonObject(req.body) || !isOAuthProvider(req.body.provider)) return sendError(res, { error: 'BAD_REQUEST' });
    if (limitedAvatar(res, session.user.id)) return;

    const result = await profiles!.useProviderAvatar(session.user.id, req.body.provider);
    if (!result.ok) return sendError(res, result);
    sendOk<{ account: AccountInfo }>(res, { account: await info(result.value) });
  });

  router.delete('/me/avatar', async (req, res) => {
    const session = await requireSession(req, res);
    if (!session) return;
    const updated = await profiles!.removeAvatar(session.user.id);
    sendOk<{ account: AccountInfo }>(res, { account: await info(updated ?? session.user) });
  });

  /**
   * Las fotos, públicas: se ven en las salas y en el ranking.
   *
   * La URL lleva la versión (`?v=3`), así que se pueden cachear un año: cuando el
   * jugador cambia la foto cambia la URL. `nosniff` y el tipo fijo hacen que el
   * navegador la trate siempre como imagen, nunca como otra cosa.
   */
  router.get('/avatars/:file', async (req, res) => {
    // Formato exacto de UUID: cualquier otra cosa ni llega a la base.
    const match = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.webp$/.exec(String(req.params.file));
    if (!match || !profiles) return sendError(res, { error: 'NOT_FOUND' });
    const avatar = await profiles.avatarOf(match[1]!);
    if (!avatar) return sendError(res, { error: 'NOT_FOUND' });

    res.setHeader('Content-Type', 'image/webp');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'");
    res.end(avatar.content);
  });

  // ── Estadísticas y ranking ────────────────────────────────

  router.get('/me/stats', async (req, res) => {
    const session = await requireSession(req, res);
    if (!session) return;
    sendOk<UserStatsSummary>(res, await leaderboard!.statsOf(session.user.id));
  });

  /**
   * El ranking de un mes (por defecto, el actual) o de todos los tiempos. Público:
   * se ve sin cuenta. Con sesión, además trae la fila propia.
   */
  router.get('/leaderboard/monthly', async (req, res) => {
    if (!leaderboard || !sessions) return sendError(res, { error: 'ACCOUNTS_DISABLED' });
    const period = req.query.period === undefined ? monthOf(new Date(), deps!.statsTimeZone ?? 'UTC') : req.query.period;
    const metric = req.query.metric === undefined ? 'points' : req.query.metric;
    if (!isLeaderboardPeriod(period) || !isLeaderboardMetric(metric)) return sendError(res, { error: 'BAD_REQUEST' });

    const viewer = await sessions.resolve(sessionToken(req));
    sendOk<LeaderboardResponse>(res, await leaderboard.table(period, metric, viewer?.user.id ?? null));
  });

  // De acá para abajo todo necesita la base.
  router.use('/auth', (_req, res, next) => {
    if (!accounts || !sessions) return sendError(res, { error: 'ACCOUNTS_DISABLED' });
    next();
  });

  router.post('/auth/register', async (req, res) => {
    if (!isJsonObject(req.body)) return sendError(res, { error: 'BAD_REQUEST' });
    if (limited(res, limiters.registerPerIp.hit(`ip:${req.ip}`))) return;

    const result = await accounts!.register(req.body, parseEmailLocale(req.body.locale));
    if (!result.ok) return sendError(res, result);

    // Todavía no hay sesión: se entra al verificar el email. Si se entrara acá, un
    // email ajeno ya registrado respondería distinto y el formulario lo delataría.
    sendOk<RegisterResponse>(res, { verificationRequired: true, email: result.value.email }, 202);
  });

  router.post('/auth/verify-email', async (req, res) => {
    if (!isJsonObject(req.body)) return sendError(res, { error: 'BAD_REQUEST' });
    if (limited(res, limiters.codePerIp.hit(`ip:${req.ip}`))) return;

    const result = await accounts!.verifyEmail(req.body);
    if (!result.ok) return sendError(res, result);

    await signIn(req, res, result.value.id, req.body.remember === true);
    log.info(`cuenta verificada: "${result.value.username}"`);
    sendOk<{ account: AccountInfo }>(res, { account: await info(result.value) });
  });

  router.post('/auth/resend-verification', async (req, res) => {
    if (!isJsonObject(req.body)) return sendError(res, { error: 'BAD_REQUEST' });
    if (limited(res, limiters.emailPerIp.hit(`ip:${req.ip}`))) return;

    await accounts!.resendVerification(req.body.email, parseEmailLocale(req.body.locale));
    sendOk(res, null);
  });

  router.post('/auth/login', async (req, res) => {
    if (!isJsonObject(req.body)) return sendError(res, { error: 'BAD_REQUEST' });
    const emailKeyForLimit = typeof req.body.email === 'string' ? emailKey(req.body.email).slice(0, 254) : '';

    if (limited(res, limiters.loginPerIp.hit(`ip:${req.ip}`))) return;
    // Por email también: alguien probando contraseñas contra una cuenta desde muchas IPs.
    if (emailKeyForLimit && limited(res, limiters.loginPerEmail.hit(`email:${emailKeyForLimit}`))) return;

    const result = await accounts!.login(req.body, parseEmailLocale(req.body.locale));
    if (!result.ok) {
      // La contraseña estaba bien: no cuenta como intento fallido.
      if (result.error === 'EMAIL_NOT_VERIFIED') limiters.loginPerEmail.reset(`email:${emailKeyForLimit}`);
      return sendError(res, result);
    }

    limiters.loginPerEmail.reset(`email:${emailKeyForLimit}`);
    await signIn(req, res, result.value.id, req.body.remember === true);
    sendOk<{ account: AccountInfo }>(res, { account: await info(result.value) });
  });

  router.post('/auth/forgot-password', async (req, res) => {
    if (!isJsonObject(req.body)) return sendError(res, { error: 'BAD_REQUEST' });
    if (limited(res, limiters.emailPerIp.hit(`ip:${req.ip}`))) return;

    await accounts!.forgotPassword(req.body.email, parseEmailLocale(req.body.locale));
    sendOk(res, null);
  });

  router.post('/auth/reset-password', async (req, res) => {
    if (!isJsonObject(req.body)) return sendError(res, { error: 'BAD_REQUEST' });
    if (limited(res, limiters.codePerIp.hit(`ip:${req.ip}`))) return;

    const result = await accounts!.resetPassword(req.body);
    if (!result.ok) return sendError(res, result);

    // Contraseña nueva: afuera todas las sesiones abiertas con la vieja, y adentro esta.
    await sessions!.revokeAll(result.value.id);
    await signIn(req, res, result.value.id, req.body.remember === true);
    log.info(`contraseña cambiada: "${result.value.username}"`);
    sendOk<{ account: AccountInfo }>(res, { account: await info(result.value) });
  });

  // ── Google y Discord ──────────────────────────────────────

  /** Vuelve a la página con el resultado en la URL: el cliente lo lee al cargar. */
  function backToApp(res: Response, params: Record<string, string>) {
    res.redirect(302, `/?${new URLSearchParams(params).toString()}`);
  }

  function oauthFailed(res: Response, reason: OAuthError) {
    backToApp(res, { auth: 'error', reason });
  }

  function redirectUri(req: Request, provider: OAuthProviderConfig) {
    const base = oauth.publicUrl ?? `${req.protocol}://${req.get('host')}`;
    return `${base.replace(/\/+$/, '')}/api/auth/${provider.id}/callback`;
  }

  function stateCookieOptions(req: Request) {
    // Lax alcanza y hace falta: la vuelta desde Google es una navegación de primer
    // nivel (GET), y con Strict el navegador no mandaría la cookie.
    return { httpOnly: true, secure: req.secure, sameSite: 'lax' as const, path: '/api/auth' };
  }

  router.get('/auth/:provider', async (req, res) => {
    const provider = isOAuthProvider(req.params.provider) ? providers.get(req.params.provider) : undefined;
    if (!provider) return oauthFailed(res, 'OAUTH_NOT_CONFIGURED');
    if (!limiters.oauthPerIp.hit(`ip:${req.ip}`).ok) return oauthFailed(res, 'OAUTH_FAILED');

    // Con una sesión iniciada no se entra a otra cuenta: se vincula a la actual.
    const current = await sessions!.resolve(sessionToken(req));
    const state = newOAuthState(provider, req.query.remember !== '0', current?.user.id ?? null);

    res.cookie(OAUTH_STATE_COOKIE, sealState(state, deps!.secret), {
      ...stateCookieOptions(req),
      maxAge: OAUTH_STATE_TTL_MS,
    });
    res.redirect(302, authorizationUrl(provider, state, redirectUri(req, provider)));
  });

  router.get('/auth/:provider/callback', async (req, res) => {
    const provider = isOAuthProvider(req.params.provider) ? providers.get(req.params.provider) : undefined;
    if (!provider) return oauthFailed(res, 'OAUTH_NOT_CONFIGURED');

    // La cookie sirve para una sola vuelta, salga bien o mal.
    const saved = openState(parseCookies(req.headers.cookie).get(OAUTH_STATE_COOKIE), deps!.secret);
    res.clearCookie(OAUTH_STATE_COOKIE, stateCookieOptions(req));

    if (typeof req.query.error === 'string') {
      return oauthFailed(res, req.query.error === 'access_denied' ? 'OAUTH_CANCELLED' : 'OAUTH_FAILED');
    }
    const code = typeof req.query.code === 'string' ? req.query.code : '';
    const returnedState = typeof req.query.state === 'string' ? req.query.state : '';
    if (!saved || saved.provider !== provider.id || !code || !safeEqual(returnedState, saved.state)) {
      return oauthFailed(res, 'OAUTH_STATE');
    }

    let profile;
    try {
      profile = await fetchProfile(provider, code, saved, redirectUri(req, provider));
    } catch (error) {
      // El mensaje dice qué paso falló; nunca lleva el código ni el token.
      log.warn('Falló el inicio de sesión con proveedor', error instanceof Error ? error.message : error);
      return oauthFailed(res, 'OAUTH_FAILED');
    }

    if (saved.linkUserId) {
      // Vincular: la sesión tiene que seguir siendo la misma que empezó.
      const current = await sessions!.resolve(sessionToken(req));
      if (current?.user.id !== saved.linkUserId) return oauthFailed(res, 'OAUTH_STATE');
      const linked = await identities!.link(saved.linkUserId, provider.id, profile);
      if (!linked.ok) return oauthFailed(res, linked.error);
      return backToApp(res, { auth: 'linked', provider: provider.id });
    }

    const result = await identities!.signIn(provider.id, profile);
    if (!result.ok) return oauthFailed(res, result.error);

    await signIn(req, res, result.user.id, saved.remember);
    if (result.created) {
      log.info(`cuenta nueva con ${provider.id}: "${result.user.username}"`);
      // Arranca con la foto del proveedor. Con tope de espera: si Google tarda, la
      // cuenta entra igual sin foto, y la puede poner después desde el perfil.
      if (profile.avatarUrl) {
        await Promise.race([
          profiles!.useProviderAvatar(result.user.id, provider.id).catch(() => undefined),
          new Promise((resolve) => setTimeout(resolve, 3000)),
        ]);
      }
    }
    backToApp(res, { auth: result.created ? 'created' : 'ok' });
  });


  /** Siempre responde bien: cerrar una sesión que ya no existe no es un error. */
  router.post('/auth/logout', async (req, res) => {
    await sessions!.revoke(sessionToken(req));
    clearSessionCookie(req, res);
    sendOk(res, null);
  });

  router.use((_req, res) => sendError(res, { error: 'NOT_FOUND' }));

  // Express 5 manda acá los errores de los handlers async.
  router.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const status = (error as { status?: number }).status;
    // JSON mal formado o cuerpo demasiado grande: culpa del pedido, no del servidor.
    if (status === 413 && _req.path.startsWith('/me/avatar')) return sendError(res, { error: 'AVATAR_TOO_LARGE' });
    if (status === 400 || status === 413) return sendError(res, { error: 'BAD_REQUEST' });
    // Solo el mensaje: el error completo puede arrastrar el cuerpo del pedido, con la contraseña.
    log.error('Error en la API', error instanceof Error ? error.message : String(error));
    sendError(res, { error: 'SERVER_ERROR' });
  });

  return {
    router,
    async sweep() {
      for (const limiter of Object.values(limiters)) limiter.sweep();
      if (sessions) await sessions.sweep();
      if (accounts) {
        await accounts.codes.sweep();
        const removed = await accounts.sweepUnverified();
        if (removed > 0) log.info(`${removed} cuentas sin verificar borradas`);
      }
    },
  };
}
