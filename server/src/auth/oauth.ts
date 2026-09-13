import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { OAuthProvider } from '@flagazo/shared';

/**
 * Inicio de sesión con Google y Discord: OAuth 2.0 con código de autorización.
 *
 * Sin librerías: son dos pedidos HTTP (cambiar el código por un token, pedir el
 * perfil) y la parte delicada es la verificación del `state`, que conviene tener
 * a la vista y no escondida en una dependencia.
 */

/** Lo que importa del perfil que devuelve el proveedor, igual para todos. */
export interface OAuthProfile {
  providerUserId: string;
  email: string | null;
  /** El proveedor garantiza que el email es de esta persona. Sin esto no se vincula nada por email. */
  emailVerified: boolean;
  displayName: string | null;
  avatarUrl: string | null;
}

export interface OAuthProviderConfig {
  id: OAuthProvider;
  clientId: string;
  clientSecret: string;
  authorizeUrl: string;
  tokenUrl: string;
  userinfoUrl: string;
  scopes: string[];
  /** PKCE (RFC 7636). Google lo soporta; Discord se protege con `state` y el secreto. */
  pkce: boolean;
  /** Parámetros extra para la pantalla del proveedor. */
  authorizeParams: Record<string, string>;
  parseProfile(json: unknown): OAuthProfile | null;
}

/** Google con OpenID Connect. Endpoints de la documentación oficial. */
export function googleProvider(clientId: string, clientSecret: string): OAuthProviderConfig {
  return {
    id: 'google',
    clientId,
    clientSecret,
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    userinfoUrl: 'https://openidconnect.googleapis.com/v1/userinfo',
    scopes: ['openid', 'email', 'profile'],
    pkce: true,
    // Con varias cuentas de Google abiertas, que elija con cuál entrar.
    authorizeParams: { prompt: 'select_account' },
    parseProfile(json) {
      const data = json as { sub?: unknown; email?: unknown; email_verified?: unknown; name?: unknown; picture?: unknown };
      if (typeof data.sub !== 'string' || !data.sub) return null;
      const email = typeof data.email === 'string' ? data.email : null;
      return {
        providerUserId: data.sub,
        email,
        emailVerified: Boolean(email) && (data.email_verified === true || data.email_verified === 'true'),
        displayName: typeof data.name === 'string' ? data.name : null,
        avatarUrl: typeof data.picture === 'string' ? data.picture : null,
      };
    },
  };
}

/** Discord OAuth2. Endpoints de la documentación oficial. */
export function discordProvider(clientId: string, clientSecret: string): OAuthProviderConfig {
  return {
    id: 'discord',
    clientId,
    clientSecret,
    authorizeUrl: 'https://discord.com/oauth2/authorize',
    tokenUrl: 'https://discord.com/api/oauth2/token',
    userinfoUrl: 'https://discord.com/api/users/@me',
    scopes: ['identify', 'email'],
    pkce: false,
    authorizeParams: {},
    parseProfile(json) {
      const data = json as {
        id?: unknown;
        username?: unknown;
        global_name?: unknown;
        avatar?: unknown;
        email?: unknown;
        verified?: unknown;
      };
      if (typeof data.id !== 'string' || !/^\d+$/.test(data.id)) return null;
      const email = typeof data.email === 'string' ? data.email : null;
      const name = typeof data.global_name === 'string' && data.global_name ? data.global_name : data.username;
      return {
        providerUserId: data.id,
        email,
        emailVerified: Boolean(email) && data.verified === true,
        displayName: typeof name === 'string' ? name : null,
        avatarUrl:
          typeof data.avatar === 'string' && /^[a-z0-9_]+$/i.test(data.avatar)
            ? `https://cdn.discordapp.com/avatars/${data.id}/${data.avatar}.png?size=256`
            : null,
      };
    },
  };
}

// ── State ───────────────────────────────────────────────────

/**
 * Lo que se recuerda entre la ida al proveedor y la vuelta.
 *
 * Viaja en una cookie HttpOnly firmada con `AUTH_SECRET`, así no hace falta
 * guardarlo en ningún lado del servidor. La cookie ata la vuelta al navegador
 * que empezó: si alguien le hace abrir a otro un link de callback con su propio
 * código, el `state` no coincide y no pasa nada (sin esto, la víctima quedaría
 * adentro de la cuenta del atacante).
 */
export interface OAuthState {
  provider: OAuthProvider;
  state: string;
  /** Verificador PKCE, si el proveedor lo usa. */
  verifier: string | null;
  remember: boolean;
  /** Si empezó con una sesión iniciada: vincular a esta cuenta en vez de entrar. */
  linkUserId: string | null;
  expiresAt: number;
}

export const OAUTH_STATE_COOKIE = 'flagazo_oauth';
export const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

export function newOAuthState(provider: OAuthProviderConfig, remember: boolean, linkUserId: string | null): OAuthState {
  return {
    provider: provider.id,
    state: randomBytes(24).toString('base64url'),
    verifier: provider.pkce ? randomBytes(32).toString('base64url') : null,
    remember,
    linkUserId,
    expiresAt: Date.now() + OAUTH_STATE_TTL_MS,
  };
}

export function sealState(state: OAuthState, secret: string): string {
  const payload = Buffer.from(JSON.stringify(state)).toString('base64url');
  return `${payload}.${sign(payload, secret)}`;
}

/** La cookie abierta, o null si está adulterada o vencida. */
export function openState(sealed: string | undefined, secret: string, now = Date.now()): OAuthState | null {
  if (!sealed) return null;
  const [payload, signature, extra] = sealed.split('.');
  if (!payload || !signature || extra !== undefined) return null;
  if (!safeEqual(signature, sign(payload, secret))) return null;
  try {
    const state = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as OAuthState;
    if (typeof state.expiresAt !== 'number' || state.expiresAt <= now) return null;
    return state;
  } catch {
    return null;
  }
}

export function authorizationUrl(provider: OAuthProviderConfig, state: OAuthState, redirectUri: string): string {
  const url = new URL(provider.authorizeUrl);
  url.searchParams.set('client_id', provider.clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', provider.scopes.join(' '));
  url.searchParams.set('state', state.state);
  if (state.verifier) {
    url.searchParams.set('code_challenge', createHash('sha256').update(state.verifier).digest('base64url'));
    url.searchParams.set('code_challenge_method', 'S256');
  }
  for (const [key, value] of Object.entries(provider.authorizeParams)) url.searchParams.set(key, value);
  return url.toString();
}

/** Cambia el código por un token y trae el perfil. Lanza si algo sale mal. */
export async function fetchProfile(
  provider: OAuthProviderConfig,
  code: string,
  state: OAuthState,
  redirectUri: string,
): Promise<OAuthProfile> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: provider.clientId,
    client_secret: provider.clientSecret,
  });
  if (state.verifier) body.set('code_verifier', state.verifier);

  const tokenResponse = await fetch(provider.tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body,
    signal: AbortSignal.timeout(10_000),
  });
  if (!tokenResponse.ok) throw new Error(`${provider.id}: el token respondió ${tokenResponse.status}`);
  const token = (await tokenResponse.json()) as { access_token?: unknown };
  if (typeof token.access_token !== 'string') throw new Error(`${provider.id}: sin access_token`);

  const profileResponse = await fetch(provider.userinfoUrl, {
    headers: { authorization: `Bearer ${token.access_token}`, accept: 'application/json' },
    signal: AbortSignal.timeout(10_000),
  });
  if (!profileResponse.ok) throw new Error(`${provider.id}: el perfil respondió ${profileResponse.status}`);
  const profile = provider.parseProfile(await profileResponse.json());
  if (!profile) throw new Error(`${provider.id}: perfil sin id`);
  return profile;
}

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(`oauth-state:${payload}`).digest('base64url');
}

export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
