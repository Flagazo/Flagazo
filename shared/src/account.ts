/**
 * Cuentas de usuario: el contrato entre la API HTTP y el cliente.
 *
 * Una cuenta es opcional. Quien juega como invitado nunca pasa por acá; quien
 * tiene cuenta guarda su perfil, sus estadísticas y aparece en los rankings.
 *
 * Las validaciones viven en `shared` para que el formulario marque el error
 * mientras se escribe. El servidor las vuelve a correr siempre: lo que dice el
 * cliente es una sugerencia, nunca la última palabra.
 */
import { NICKNAME_MAX_LENGTH, NICKNAME_MIN_LENGTH } from './constants';
import { validateNickname } from './validation';
import type { NicknameError, ValidationResult } from './validation';

/**
 * El username es también el nombre con el que se juega, así que sigue las
 * mismas reglas que el nickname de invitado. Si fueran distintas, habría
 * usernames válidos que no se podrían usar dentro de una sala.
 */
export const USERNAME_MIN_LENGTH = NICKNAME_MIN_LENGTH;
export const USERNAME_MAX_LENGTH = NICKNAME_MAX_LENGTH;

/** El máximo que admite una dirección de email según el RFC 5321. */
export const EMAIL_MAX_LENGTH = 254;

/**
 * Largo de la contraseña.
 *
 * Mínimo 8, como pide NIST 800-63B, sin reglas de "una mayúscula y un símbolo":
 * empujan a contraseñas previsibles (`Password1!`) sin hacerlas más seguras. El
 * máximo existe para que nadie mande un megabyte a hashear.
 */
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

export type UsernameError = Exclude<NicknameError, 'TAKEN'>;
export type EmailError = 'EMAIL_EMPTY' | 'EMAIL_INVALID';
export type PasswordError =
  | 'PASSWORD_TOO_SHORT'
  | 'PASSWORD_TOO_LONG'
  | 'PASSWORD_LIKE_ACCOUNT';

/** Todo lo que puede responder la API de cuentas cuando algo sale mal. */
export type AuthError =
  | 'BAD_REQUEST'
  | 'USERNAME_INVALID'
  | 'EMAIL_INVALID'
  | 'PASSWORD_INVALID'
  | 'PASSWORD_TOO_COMMON'
  | 'USERNAME_TAKEN'
  | 'INVALID_CREDENTIALS'
  /** Contraseña correcta, pero falta verificar el email. Ya se mandó un código. */
  | 'EMAIL_NOT_VERIFIED'
  | 'CODE_INVALID'
  | 'CODE_EXPIRED'
  /** Demasiados intentos con este código: hay que pedir otro. */
  | 'CODE_LOCKED'
  | 'ALREADY_VERIFIED'
  /** El archivo no es una imagen JPG, PNG o WebP válida, o sus dimensiones no se admiten. */
  | 'AVATAR_INVALID'
  | 'AVATAR_TOO_LARGE'
  /** Se pidió usar la foto de Google o Discord, pero esa cuenta no tiene. */
  | 'NO_PROVIDER_AVATAR'
  | 'UNAUTHENTICATED'
  | 'RATE_LIMITED'
  | 'FORBIDDEN_ORIGIN'
  | 'ACCOUNTS_DISABLED'
  | 'NOT_FOUND'
  | 'SERVER_ERROR';

/** Proveedores con los que se puede entrar además de email y contraseña. */
export const OAUTH_PROVIDERS = ['google', 'discord'] as const;
export type OAuthProvider = (typeof OAUTH_PROVIDERS)[number];

export function isOAuthProvider(value: unknown): value is OAuthProvider {
  return OAUTH_PROVIDERS.includes(value as OAuthProvider);
}

/**
 * Cómo terminó un inicio de sesión con Google o Discord.
 *
 * Esos flujos salen de la página y vuelven con una redirección, así que el
 * resultado no llega como JSON: viaja en la URL (`/?auth=error&reason=…`).
 */
export type OAuthError =
  /** El jugador canceló en la pantalla del proveedor. */
  | 'OAUTH_CANCELLED'
  /** El pedido vencido, repetido o que no empezó en esta página. */
  | 'OAUTH_STATE'
  /** El proveedor no respondió o respondió algo inesperado. */
  | 'OAUTH_FAILED'
  /**
   * Ya hay una cuenta con ese email, y el proveedor no garantiza que el email sea
   * de quien entra. Hay que iniciar sesión con la contraseña y vincular desde el perfil.
   */
  | 'OAUTH_EMAIL_IN_USE'
  /** Esa cuenta de Google o Discord ya está vinculada a otra cuenta de Flagazo. */
  | 'OAUTH_ALREADY_LINKED'
  | 'OAUTH_NOT_CONFIGURED';

/** Lo que el dueño de una cuenta ve de sí mismo. Nunca incluye datos de sesión. */
export interface AccountInfo {
  id: string;
  username: string;
  email: string | null;
  emailVerified: boolean;
  /** URL de la foto, o null para usar el avatar de color con la inicial. */
  avatarUrl: string | null;
  /** Si puede entrar con email y contraseña (una cuenta creada con Google no tiene). */
  hasPassword: boolean;
  /** Google o Discord vinculados. */
  providers: OAuthProvider[];
  /** De esos, los que tienen foto para usar como avatar. */
  providerAvatars: OAuthProvider[];
  /** ISO 8601. */
  createdAt: string;
}

export interface MeResponse {
  /** false si el servidor corre sin base de datos: el cliente esconde todo lo de cuentas. */
  accountsEnabled: boolean;
  /** Proveedores configurados en el servidor: solo esos botones se muestran. */
  providers: OAuthProvider[];
  account: AccountInfo | null;
}

/** Idiomas en los que se escriben los emails. Los mismos que la interfaz. */
export type EmailLocale = 'es' | 'en';

export function parseEmailLocale(raw: unknown): EmailLocale {
  return raw === 'es' ? 'es' : 'en';
}

/**
 * Códigos que llegan por email: verificar la cuenta y recuperar la contraseña.
 *
 * Seis dígitos alcanzan porque no se pueden probar en masa: cada código admite
 * pocos intentos, vence enseguida y no se pueden pedir muchos por hora. Con
 * estos números son 25 intentos por hora contra un millón de combinaciones:
 * 1 chance en 40.000.
 */
export const AUTH_CODE = {
  length: 6,
  ttlMs: 10 * 60 * 1000,
  maxAttempts: 5,
  /** Entre un pedido de código y el siguiente. El botón "Reenviar" espera esto. */
  resendCooldownMs: 60 * 1000,
  maxPerHour: 5,
} as const;

/** Deja solo los dígitos de lo escrito o pegado ("483 921", "483-921"). */
export function cleanAuthCode(raw: string): string {
  return raw.replace(/\D/g, '').slice(0, AUTH_CODE.length);
}

export interface RegisterRequest {
  username: string;
  email: string;
  password: string;
  /** "Mantener sesión iniciada". Se aplica al verificar, que es cuando se entra. */
  remember: boolean;
  locale: EmailLocale;
}

/**
 * Lo que responde el registro, **siempre igual**: con un email nuevo y con uno que
 * ya tiene cuenta. Así el formulario no sirve para averiguar quién está registrado.
 * Al dueño de una cuenta existente le llega un aviso en vez de un código.
 */
export interface RegisterResponse {
  verificationRequired: true;
  email: string;
}

export interface LoginRequest {
  email: string;
  password: string;
  remember: boolean;
  locale: EmailLocale;
}

export interface VerifyEmailRequest {
  email: string;
  code: string;
  remember: boolean;
}

/** Pedir un código nuevo o empezar a recuperar la contraseña. Responde bien siempre. */
export interface EmailOnlyRequest {
  email: string;
  locale: EmailLocale;
}

export interface ResetPasswordRequest {
  email: string;
  code: string;
  password: string;
  remember: boolean;
}

/**
 * Fotos de perfil.
 *
 * El servidor acepta hasta 2 MB y las deja en 256×256 WebP. El cliente achica
 * antes de subir, así una foto de 8 MB del celular entra igual y la subida es rápida.
 */
export const AVATAR = {
  maxUploadBytes: 2 * 1024 * 1024,
  /** Lado máximo de la imagen original. Frena "bombas" de píxeles que pesan poco. */
  maxInputSide: 4096,
  size: 256,
  types: ['image/jpeg', 'image/png', 'image/webp'] as readonly string[],
} as const;

export interface UpdateProfileRequest {
  username: string;
}

/** Respuesta de la API HTTP. Mismo espíritu que el `Result` de los sockets. */
export type ApiResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      error: AuthError;
      /** Qué campo del formulario marcar, si el error es de uno en particular. */
      field?: 'username' | 'email' | 'password' | 'code';
      /** Detalle del error de validación, para elegir el mensaje exacto. */
      reason?: string;
      /** Con RATE_LIMITED: cuánto falta para poder volver a intentar. */
      retryAfterMs?: number;
    };

// ── Validaciones ────────────────────────────────────────────

export function validateUsername(raw: unknown): ValidationResult<string, UsernameError> {
  const result = validateNickname(raw);
  // `validateNickname` nunca devuelve TAKEN (eso lo decide la sala), pero el tipo
  // lo admite: se descarta acá para que el de username quede exacto.
  if (!result.ok && result.error === 'TAKEN') return { ok: false, error: 'INVALID_CHARS' };
  return result as ValidationResult<string, UsernameError>;
}

/**
 * Forma canónica de un email para compararlo: sin espacios y en minúsculas.
 *
 * Técnicamente la parte local distingue mayúsculas, pero ningún proveedor real lo
 * hace, y tratar `Ana@x.com` y `ana@x.com` como cuentas distintas solo sirve para
 * crear duplicados. No se tocan puntos ni `+etiquetas`: eso sí cambia de proveedor
 * en proveedor.
 */
export function emailKey(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Validación de forma, a propósito permisiva: algo@algo.dominio, sin espacios.
 *
 * La prueba de verdad de que un email existe y es de quien lo escribió es el
 * código de verificación. Una regex estricta solo rechaza direcciones válidas.
 */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

export function validateEmail(raw: unknown): ValidationResult<string, EmailError> {
  if (typeof raw !== 'string') return { ok: false, error: 'EMAIL_EMPTY' };
  const value = raw.trim();
  if (value.length === 0) return { ok: false, error: 'EMAIL_EMPTY' };
  if (value.length > EMAIL_MAX_LENGTH || !EMAIL_SHAPE.test(value)) {
    return { ok: false, error: 'EMAIL_INVALID' };
  }
  return { ok: true, value };
}

/**
 * Reglas de contraseña que se pueden chequear sin el servidor.
 *
 * La lista de contraseñas comunes queda solo del lado del servidor: no tiene
 * sentido mandarla en el bundle a cada jugador que entra a jugar como invitado.
 */
export function validatePassword(
  raw: unknown,
  account: { email?: string; username?: string } = {},
): ValidationResult<string, PasswordError> {
  if (typeof raw !== 'string') return { ok: false, error: 'PASSWORD_TOO_SHORT' };
  const length = [...raw].length;
  if (length < PASSWORD_MIN_LENGTH) return { ok: false, error: 'PASSWORD_TOO_SHORT' };
  if (length > PASSWORD_MAX_LENGTH) return { ok: false, error: 'PASSWORD_TOO_LONG' };

  const lower = raw.toLowerCase();
  const localPart = account.email ? emailKey(account.email).split('@')[0] : undefined;
  const likeAccount = [account.username?.toLowerCase(), account.email && emailKey(account.email), localPart]
    .filter((value): value is string => Boolean(value && value.length >= 3))
    .some((value) => lower === value);
  if (likeAccount) return { ok: false, error: 'PASSWORD_LIKE_ACCOUNT' };

  return { ok: true, value: raw };
}
