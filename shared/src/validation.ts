import {
  DIFFICULTY_OPTIONS,
  GAME_MODES,
  MAX_FLAGS_PER_GAME,
  MAX_FLAGS_PER_ROUND,
  MIN_FLAGS_PER_ROUND,
  NICKNAME_MAX_LENGTH,
  NICKNAME_MIN_LENGTH,
  PARTY_CODE_ALPHABET,
  PARTY_CODE_LENGTH,
  SECONDS_PER_FLAG_OPTIONS,
  SESSION_TOKEN_LENGTH,
  TOTAL_ROUNDS_OPTIONS,
  GAME_KINDS,
} from './constants';
import { DRAW_PROMPT_OPTIONS, DRAW_ROUNDS_OPTIONS, DRAW_SECONDS_OPTIONS } from './draw';
import type {
  Difficulty,
  DrawPrompt,
  GameKind,
  GameModeId,
  GameSettings,
  PartyVisibility,
} from './types';

export type NicknameError =
  | 'EMPTY'
  | 'TOO_SHORT'
  | 'TOO_LONG'
  | 'INVALID_CHARS'
  | 'NEEDS_ALPHANUMERIC'
  | 'TAKEN';

export type ValidationResult<T, E extends string> =
  | { ok: true; value: T }
  | { ok: false; error: E };

/** Letras y números de cualquier alfabeto, marcas (tildes combinadas), espacio, _ . - */
const NICKNAME_ALLOWED = /^[\p{L}\p{M}\p{N} _.\-]+$/u;
const HAS_ALPHANUMERIC = /[\p{L}\p{N}]/u;

/** Unifica la forma Unicode y colapsa espacios. No cambia mayúsculas. */
export function sanitizeNickname(raw: string): string {
  return raw.normalize('NFC').replace(/\s+/g, ' ').trim();
}

/** Largo en caracteres visibles aproximados (code points, no unidades UTF-16). */
function charLength(value: string): number {
  return [...value].length;
}

export function validateNickname(raw: unknown): ValidationResult<string, NicknameError> {
  if (typeof raw !== 'string') return { ok: false, error: 'EMPTY' };
  // Corte temprano: nunca procesar strings gigantes enviados por un cliente malicioso.
  if (raw.length > NICKNAME_MAX_LENGTH * 4) return { ok: false, error: 'TOO_LONG' };

  const value = sanitizeNickname(raw);
  const length = charLength(value);

  if (length === 0) return { ok: false, error: 'EMPTY' };
  if (length < NICKNAME_MIN_LENGTH) return { ok: false, error: 'TOO_SHORT' };
  if (length > NICKNAME_MAX_LENGTH) return { ok: false, error: 'TOO_LONG' };
  if (!NICKNAME_ALLOWED.test(value)) return { ok: false, error: 'INVALID_CHARS' };
  if (!HAS_ALPHANUMERIC.test(value)) return { ok: false, error: 'NEEDS_ALPHANUMERIC' };

  return { ok: true, value };
}

/**
 * Clave para comparar nicknames dentro de una party:
 * "Juán", "juan" y "JUAN" se consideran el mismo nombre.
 */
export function nicknameKey(nickname: string): string {
  return sanitizeNickname(nickname)
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLocaleLowerCase('en-US');
}

// ── Códigos de party ────────────────────────────────────────

/** Acepta " x7k-92 " y devuelve "X7K92". */
export function normalizePartyCode(raw: string): string {
  return raw.toUpperCase().replace(/[\s-]/g, '');
}

export function isValidPartyCode(code: string): boolean {
  if (code.length !== PARTY_CODE_LENGTH) return false;
  for (const char of code) {
    if (!PARTY_CODE_ALPHABET.includes(char)) return false;
  }
  return true;
}

// ── Sesión ──────────────────────────────────────────────────

const SESSION_TOKEN_REGEX = new RegExp(`^[a-f0-9]{${SESSION_TOKEN_LENGTH}}$`);

export function isValidSessionToken(token: unknown): token is string {
  return typeof token === 'string' && SESSION_TOKEN_REGEX.test(token);
}

// ── Configuración de partida ────────────────────────────────

/**
 * Filtra un cambio de settings dejando solo campos conocidos con valores permitidos.
 * Devuelve `null` si el payload no aporta ningún cambio válido, para que el servidor
 * responda BAD_REQUEST en vez de aceptar basura en silencio.
 */
export function parseSettingsPatch(raw: unknown): Partial<GameSettings> | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const input = raw as Record<string, unknown>;
  const patch: Partial<GameSettings> = {};

  if (input.difficulty !== undefined) {
    const value = input.difficulty as Difficulty;
    if (!DIFFICULTY_OPTIONS.includes(value)) return null;
    patch.difficulty = value;
  }
  if (input.mode !== undefined) {
    const value = input.mode as GameModeId;
    if (!GAME_MODES.some((mode) => mode.id === value)) return null;
    patch.mode = value;
  }
  if (input.kind !== undefined) {
    const value = input.kind as GameKind;
    if (!GAME_KINDS.some((kind) => kind.id === value)) return null;
    patch.kind = value;
  }
  if (input.drawPrompt !== undefined) {
    const value = input.drawPrompt as DrawPrompt;
    if (!DRAW_PROMPT_OPTIONS.includes(value)) return null;
    patch.drawPrompt = value;
  }
  // Este no viene de una lista: el host lo escribe, así que se valida como rango.
  if (input.flagsPerRound !== undefined) {
    const value = Number(input.flagsPerRound);
    if (!isValidFlagsPerRound(value)) return null;
    patch.flagsPerRound = value;
  }
  for (const [key, options] of [
    ['totalRounds', TOTAL_ROUNDS_OPTIONS],
    ['secondsPerFlag', SECONDS_PER_FLAG_OPTIONS],
    ['drawRounds', DRAW_ROUNDS_OPTIONS],
    ['drawSeconds', DRAW_SECONDS_OPTIONS],
  ] as const) {
    if (input[key] === undefined) continue;
    const value = Number(input[key]);
    if (!options.includes(value)) return null;
    patch[key] = value;
  }

  return Object.keys(patch).length > 0 ? patch : null;
}

/** Que lo que llegó por el socket sea realmente una visibilidad y no cualquier cosa. */
export function isPartyVisibility(value: unknown): value is PartyVisibility {
  return value === 'public' || value === 'private';
}

/** Un número entero dentro del rango que el host puede escribir. */
export function isValidFlagsPerRound(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= MIN_FLAGS_PER_ROUND &&
    value <= MAX_FLAGS_PER_ROUND
  );
}

/**
 * Máximo de banderas por ronda que entra en el tope de la partida.
 * El cliente lo usa para no dejar escribir combinaciones que el servidor rechazaría.
 */
export function maxFlagsPerRoundFor(totalRounds: number): number {
  if (totalRounds < 1) return MAX_FLAGS_PER_ROUND;
  return Math.min(MAX_FLAGS_PER_ROUND, Math.floor(MAX_FLAGS_PER_GAME / totalRounds));
}

/**
 * Si esa combinación de rondas y banderas entra en el tope de la partida.
 *
 * Está separado de `isValidSettings` porque el lobby necesita preguntarlo sobre
 * una combinación que todavía no existe ("si eligiera 5 rondas, ¿entraría?") para
 * deshabilitar las opciones imposibles. Antes el cliente rehacía la desigualdad a
 * mano, así que la regla vivía en dos lugares y solo uno se iba a actualizar el
 * día que creciera.
 */
export function fitsInGame(totalRounds: number, flagsPerRound: number): boolean {
  return totalRounds * flagsPerRound <= MAX_FLAGS_PER_GAME;
}

/**
 * Si la configuración completa es jugable.
 *
 * Se validan los campos de los dos juegos siempre, no solo los del elegido: los
 * dos conviven en la misma configuración y cambiar de juego no puede destapar
 * valores que nunca se revisaron.
 */
export function isValidSettings(settings: GameSettings): boolean {
  if (!GAME_KINDS.some((kind) => kind.id === settings.kind)) return false;
  if (!isValidFlagsPerRound(settings.flagsPerRound)) return false;
  if (!DRAW_ROUNDS_OPTIONS.includes(settings.drawRounds)) return false;
  if (!DRAW_SECONDS_OPTIONS.includes(settings.drawSeconds)) return false;
  if (!DRAW_PROMPT_OPTIONS.includes(settings.drawPrompt)) return false;
  return fitsInGame(settings.totalRounds, settings.flagsPerRound);
}
