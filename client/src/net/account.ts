import type {
  AccountInfo,
  EmailLocale,
  LoginRequest,
  MeResponse,
  OAuthError,
  OAuthProvider,
  RegisterRequest,
  RegisterResponse,
  ResetPasswordRequest,
  VerifyEmailRequest,
} from '@flagazo/shared';
import { t } from '../i18n';
import { useAppStore } from '../store/useAppStore';
import { apiRequest } from './api';
import type { ClientApiResult } from './api';
import { reconnectWithAccount, signOutOnServer } from './connection';

/** Los emails llegan en el idioma en que se está viendo la página. */
function locale(): EmailLocale {
  return useAppStore.getState().locale;
}

/**
 * Pregunta al servidor si hay una sesión iniciada. Se llama al cargar la página.
 *
 * Si falla (sin red, servidor reiniciando) se asume que no hay cuentas: el juego
 * como invitado no depende de esto y sigue funcionando.
 */
export async function loadAccount() {
  const oauthReturn = takeOAuthReturn();
  const result = await apiRequest<MeResponse>('/me');
  const store = useAppStore.getState();
  if (result.ok) {
    store.setAccount({
      enabled: result.data.accountsEnabled,
      user: result.data.account,
      providers: result.data.providers,
      loaded: true,
    });
  } else {
    store.setAccount({ enabled: false, user: null, providers: [], loaded: true });
  }
  if (oauthReturn) await finishOAuthReturn(oauthReturn);
}

/**
 * Sale a Google o Discord. Es una navegación de verdad, no un fetch: el
 * proveedor muestra su propia pantalla y después vuelve a Flagazo.
 */
export function startOAuth(provider: OAuthProvider, remember: boolean) {
  window.location.assign(`/api/auth/${provider}?remember=${remember ? '1' : '0'}`);
}

type OAuthReturn =
  | { kind: 'signed-in'; created: boolean }
  | { kind: 'linked'; provider: string }
  | { kind: 'error'; reason: OAuthError | string };

/**
 * Lee el resultado que dejó el servidor en la URL al volver del proveedor, y la
 * limpia enseguida: que un F5 o un link compartido no repitan el aviso.
 */
function takeOAuthReturn(): OAuthReturn | null {
  const params = new URLSearchParams(window.location.search);
  const auth = params.get('auth');
  if (!auth) return null;
  window.history.replaceState(null, '', window.location.pathname);
  if (auth === 'ok' || auth === 'created') return { kind: 'signed-in', created: auth === 'created' };
  if (auth === 'linked') return { kind: 'linked', provider: params.get('provider') ?? '' };
  return { kind: 'error', reason: params.get('reason') ?? '' };
}

async function finishOAuthReturn(result: OAuthReturn) {
  const store = useAppStore.getState();
  const user = store.account.user;
  if (result.kind === 'signed-in' && user) {
    await onSignedIn(user, result.created ? t().auth.welcomeNew(user.username) : t().auth.welcomeBack(user.username));
    return;
  }
  if (result.kind === 'linked') {
    store.pushToast(t().auth.linked, 'success');
    return;
  }
  const errors = t().auth.oauthErrors;
  const reason = result.kind === 'error' ? result.reason : 'OAUTH_FAILED';
  store.pushToast(errors[reason as keyof typeof errors] ?? errors.OAUTH_FAILED, 'error');
  // Vuelve a la pantalla de iniciar sesión, salvo que sea un error de vincular estando adentro.
  if (!user) store.openAuth('login');
}

/** Crea la cuenta y pasa a pedir el código. Todavía no entra: se entra al verificar. */
export async function register(request: Omit<RegisterRequest, 'locale'>) {
  const result = await apiRequest<RegisterResponse>('/auth/register', { ...request, locale: locale() });
  if (result.ok) useAppStore.getState().openAuth('verify', { email: result.data.email, remember: request.remember });
  return result;
}

export async function verifyEmail(request: VerifyEmailRequest) {
  const result = await apiRequest<{ account: AccountInfo }>('/auth/verify-email', request);
  if (result.ok) await onSignedIn(result.data.account, t().auth.welcome(result.data.account.username), true);
  return result;
}

export function resendVerification(email: string): Promise<ClientApiResult<null>> {
  return apiRequest<null>('/auth/resend-verification', { email, locale: locale() });
}

export async function login(request: Omit<LoginRequest, 'locale'>) {
  const result = await apiRequest<{ account: AccountInfo }>('/auth/login', { ...request, locale: locale() });
  if (result.ok) {
    await onSignedIn(result.data.account, t().auth.welcomeBack(result.data.account.username), true);
  } else if (result.error === 'EMAIL_NOT_VERIFIED') {
    // La contraseña estaba bien, falta el email: el servidor ya mandó un código.
    useAppStore.getState().openAuth('verify', { email: request.email, remember: request.remember });
  }
  return result;
}

/** Pide el código para cambiar la contraseña y pasa al paso de escribirlo. */
export async function forgotPassword(email: string) {
  const result = await apiRequest<null>('/auth/forgot-password', { email, locale: locale() });
  if (result.ok) useAppStore.getState().openAuth('reset', { email });
  return result;
}

export async function resetPassword(request: ResetPasswordRequest) {
  const result = await apiRequest<{ account: AccountInfo }>('/auth/reset-password', request);
  if (result.ok) await onSignedIn(result.data.account, t().auth.passwordChanged, true);
  return result;
}

export async function logout(): Promise<ClientApiResult<null>> {
  const result = await apiRequest<null>('/auth/logout', {});
  const store = useAppStore.getState();
  if (result.ok) {
    store.setAccount({ user: null });
    await signOutOnServer();
    store.pushToast(t().auth.loggedOut, 'info');
  }
  return result;
}

/**
 * Después de entrar a la cuenta: el servidor asocia la cuenta al jugador y le
 * pone el username como nombre de juego.
 *
 * Con email y contraseña el socket ya estaba conectado como invitado, así que se
 * reconecta para que el servidor lea la cookie nueva. Al volver de Google o Discord
 * la página recién cargó y el socket se conectó ya con la cookie: alcanza con esperar.
 */
async function onSignedIn(account: AccountInfo, message: string, reconnect = false) {
  useAppStore.getState().setAccount({ user: account });
  useAppStore.getState().pushToast(message, 'success');

  if (reconnect) await reconnectWithAccount();
  else await waitForGameSession();

  const store = useAppStore.getState();
  const { room, authReturnTo, session } = store;
  if (room) {
    store.goTo(room.game ? 'game' : 'lobby');
    return;
  }
  // Sin nombre (no se pudo conectar), que lo confirme a mano en la pantalla de nickname.
  store.goTo(session.nickname ? (authReturnTo === 'browse' ? 'browse' : 'menu') : 'nickname');
}

/** Espera a que el socket tenga sesión de juego, con un tope para no colgar la pantalla. */
function waitForGameSession(timeoutMs = 8000): Promise<void> {
  const ready = () => {
    const { session, connection } = useAppStore.getState();
    return Boolean(session.playerId) && connection.status === 'connected';
  };
  if (ready()) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      unsubscribe();
      clearTimeout(timer);
      // Un instante más: la sala en curso llega justo después de la sesión.
      setTimeout(resolve, 300);
    };
    const unsubscribe = useAppStore.subscribe(() => {
      if (ready()) done();
    });
    const timer = setTimeout(done, timeoutMs);
  });
}
