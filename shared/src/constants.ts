/**
 * Constantes globales del juego. Cliente y servidor leen exactamente los mismos valores.
 * El servidor es quien las hace cumplir; el cliente solo las usa para dar feedback inmediato.
 */
import type {
  Difficulty,
  GameModeId,
  GameModeInfo,
  GameSettings,
  PartyVisibility,
} from './types';

/** Nombre provisional del juego (cambiarlo acá lo cambia en toda la UI). */
export const GAME_NAME = 'Flagazo';

// ── Nickname ────────────────────────────────────────────────
export const NICKNAME_MIN_LENGTH = 2;
export const NICKNAME_MAX_LENGTH = 16;

// ── Parties ─────────────────────────────────────────────────
export const PARTY_CODE_LENGTH = 5;
/** Sin 0/O, 1/I/L para que el código sea fácil de dictar y copiar. */
export const PARTY_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const MAX_PLAYERS_PER_PARTY = 12;
/**
 * Privada por defecto: publicar la party es un acto deliberado del host, no algo
 * que le pase por no haber mirado una casilla.
 */
export const DEFAULT_VISIBILITY: PartyVisibility = 'private';
/** Cuántas parties públicas devuelve el listado como máximo. */
export const MAX_PUBLIC_PARTIES_LISTED = 30;

/** Al desconectarse el host, cuánto se espera antes de pasarle la corona a otro. */
export const HOST_GRACE_MS = 15_000;
/** Un jugador desconectado en el lobby se elimina pasado este tiempo. */
export const LOBBY_DISCONNECT_GRACE_MS = 30_000;
/** Una party sin nadie conectado se borra pasado este tiempo. */
export const EMPTY_ROOM_TTL_MS = 60_000;

// ── Configuración de partida ────────────────────────────────
export const DIFFICULTY_OPTIONS: readonly Difficulty[] = ['easy', 'medium', 'hard', 'all'];
export const SECONDS_PER_FLAG_OPTIONS: readonly number[] = [10, 15, 20, 30];

/**
 * Cada ronda terminada suma un punto al marcador general (como los sets del tenis),
 * así que una partida de una sola ronda es válida: es la partida rápida.
 */
export const TOTAL_ROUNDS_OPTIONS: readonly number[] = [1, 2, 3, 5];

/**
 * Las banderas por ronda no son opciones fijas: el host escribe el número.
 * Una ronda tiene que ser un bloque con sustancia para que ganarla valga un punto.
 */
export const MIN_FLAGS_PER_ROUND = 5;
export const MAX_FLAGS_PER_ROUND = 100;

/** Tope duro de banderas por partida (≈32 min). Se valida al combinar rondas × banderas. */
export const MAX_FLAGS_PER_GAME = 100;

export const DEFAULT_GAME_SETTINGS: GameSettings = {
  mode: 'normal',
  difficulty: 'all',
  totalRounds: 3,
  flagsPerRound: 10,
  secondsPerFlag: 15,
};

// ── Red ─────────────────────────────────────────────────────
/** Cada cuánto el cliente mide ping y desfase de reloj con el servidor. */
export const TIME_SYNC_INTERVAL_MS = 5_000;
/** Tiempo máximo que el cliente espera la respuesta (ack) de un evento. */
export const ACK_TIMEOUT_MS = 5_000;
/** Largo del token de sesión que emite el servidor (hex). */
export const SESSION_TOKEN_LENGTH = 48;

// ── Ritmo de la partida ─────────────────────────────────────
/** Cuenta regresiva antes de cada ronda. */
/**
 * Cuánto se ve la bandera en el modo `flash` antes de taparse.
 *
 * Medio segundo alcanza para reconocer una bandera que ya conocés y no para
 * estudiarla, que es exactamente el punto del modo. Si se siente injusto, este
 * es el único número que hay que tocar.
 */
export const FLASH_VISIBLE_MS = 450;

export const COUNTDOWN_MS = 3_000;
/** Cuánto se muestra qué país era, después de cada bandera. */
export const REVEAL_MS = 4_000;
/** Cuánto dura el ranking entre rondas. */
export const ROUND_SUMMARY_MS = 5_000;

// ── Modos de juego ──────────────────────────────────────────

/**
 * Catálogo de modos. Vive en `shared` porque es la lista que el lobby ofrece y
 * la que el servidor valida. Los nombres y las descripciones no están acá: son
 * texto traducible y viven en `client/src/i18n/`. Cómo se comporta cada modo lo
 * decide el servidor, en `server/src/game/modes/`.
 */
export const GAME_MODES: readonly GameModeInfo[] = [
  { id: 'normal', emoji: '🏳️' },
  { id: 'pixelated', emoji: '🟦' },
  { id: 'cropped', emoji: '🔍' },
  { id: 'grayscale', emoji: '⬜' },
  { id: 'similar', emoji: '👯' },
  { id: 'bomb', emoji: '💣' },
  { id: 'flash', emoji: '⚡' },
];

export const DEFAULT_GAME_MODE: GameModeId = 'normal';
