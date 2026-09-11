/**
 * Contrato de comunicación en tiempo real (Socket.IO).
 *
 * Reglas:
 * - Cliente → servidor: "intenciones" (quiero crear party, mi respuesta es X). Siempre con ack.
 * - Servidor → cliente: estado y eventos decididos por el servidor.
 * - El cliente NUNCA envía puntos, correcciones ni tiempos: solo intenciones.
 *
 * Tipar los eventos acá hace que un cambio en el contrato rompa la compilación
 * del cliente y del servidor a la vez, en vez de fallar en runtime.
 */
import type { NicknameError } from './validation';
import type {
  GameSettings,
  LocalizedName,
  PartyVisibility,
  PublicParty,
  RoomState,
} from './types';

/** Respuesta estándar de un ack. */
export type Result<T, E extends string = string> =
  | { ok: true; data: T }
  | { ok: false; error: E };

export type Ack<T> = (response: T) => void;

/** Errores genéricos que cualquier handler puede devolver. */
export type CommonError = 'BAD_REQUEST' | 'NO_NICKNAME' | 'SERVER_ERROR';

/** Errores propios de las parties. Cada uno tiene un mensaje claro en el cliente. */
export type PartyError =
  | 'INVALID_CODE'
  | 'NOT_FOUND'
  | 'FULL'
  | 'NICK_TAKEN'
  | 'KICKED'
  | 'ALREADY_IN_PARTY'
  | 'NOT_IN_PARTY'
  | 'NOT_HOST'
  | 'TARGET_NOT_FOUND'
  | 'CANT_KICK_HOST'
  | 'INVALID_SETTINGS'
  | 'NO_CODE_AVAILABLE';

/** Por qué el servidor sacó a un jugador de una party. */
export type LeaveReason = 'left' | 'kicked' | 'closed' | 'timeout';

export interface SessionInfo {
  /** Token privado para reconectar. Solo lo recibe el dueño de la sesión. */
  token: string;
  /** Id público (es el que verán los demás jugadores). */
  playerId: string;
  nickname: string | null;
  /**
   * Sello del set de banderas actual, para pedirlas como `/flags/ar.svg?v=…`.
   *
   * El cliente lo necesita porque el fondo decorativo arma sus propias URLs. Sin
   * esto las pedía sin versión, y a quien hubiera jugado antes del cambio de
   * Wikimedia el navegador le seguía sirviendo las banderas viejas —deformadas a
   * 4:3— desde su caché, sin volver a preguntar nunca.
   */
  flagsVersion: string;
}

export interface TimeSyncResponse {
  clientSentAt: number;
  serverTime: number;
}

export interface ClientToServerEvents {
  'session:setNickname': (
    payload: { nickname: string },
    ack: Ack<Result<{ nickname: string }, NicknameError | CommonError>>,
  ) => void;

  'time:sync': (payload: { clientSentAt: number }, ack: Ack<TimeSyncResponse>) => void;

  // ── Parties ───────────────────────────────────────────────
  /** Crea una party. Si no se dice nada, nace privada. */
  'party:create': (
    payload: { visibility?: PartyVisibility },
    ack: Ack<Result<{ room: RoomState }, PartyError | CommonError>>,
  ) => void;

  'party:join': (
    payload: { code: string },
    ack: Ack<Result<{ room: RoomState }, PartyError | CommonError>>,
  ) => void;

  'party:leave': (
    payload: Record<string, never>,
    ack: Ack<Result<null, PartyError | CommonError>>,
  ) => void;

  /** Solo el host. Expulsa a un jugador y lo bloquea en esa party. */
  'party:kick': (
    payload: { playerId: string },
    ack: Ack<Result<null, PartyError | CommonError>>,
  ) => void;

  /** Solo el host. Cambio parcial de la configuración. */
  'party:updateSettings': (
    payload: { settings: Partial<GameSettings> },
    ack: Ack<Result<{ settings: GameSettings }, PartyError | CommonError>>,
  ) => void;

  /** Solo el host. Publica la party en la lista, o la saca. */
  'party:setVisibility': (
    payload: { visibility: PartyVisibility },
    ack: Ack<Result<{ visibility: PartyVisibility }, PartyError | CommonError>>,
  ) => void;

  /**
   * Las parties públicas que se pueden ver sin tener el código.
   *
   * Es una consulta puntual y no una suscripción: el cliente la repite mientras
   * mira la lista. Con pocas salas sale más barato que mantener un canal de
   * novedades por cada persona parada en el buscador.
   */
  'party:list': (
    payload: Record<string, never>,
    ack: Ack<Result<{ parties: PublicParty[] }, CommonError>>,
  ) => void;

  // ── Partida ───────────────────────────────────────────────
  /** Solo el host. Arranca la partida con la configuración actual. */
  'game:start': (
    payload: Record<string, never>,
    ack: Ack<Result<null, GameError | PartyError | CommonError>>,
  ) => void;

  /**
   * Una respuesta a la bandera activa. El servidor mide cuánto tardó:
   * el cliente no manda tiempos ni puntos, solo el texto.
   */
  'game:answer': (
    payload: { text: string },
    ack: Ack<Result<AnswerFeedback, GameError | PartyError | CommonError>>,
  ) => void;

  /** Solo el host. Vuelve al lobby conservando la party. */
  'game:rematch': (
    payload: Record<string, never>,
    ack: Ack<Result<null, GameError | PartyError | CommonError>>,
  ) => void;
}

/** Errores propios de la partida. */
export type GameError =
  | 'ALREADY_PLAYING'
  | 'NOT_PLAYING'
  | 'NO_FLAG_ACTIVE'
  | 'ALREADY_ANSWERED'
  | 'NOT_ENOUGH_FLAGS'
  | 'GAME_NOT_FINISHED';

/**
 * Respuesta privada a quien contestó. Los demás solo se enteran de que
 * respondió, nunca de si acertó: eso se revela cuando termina la bandera.
 */
export interface AnswerFeedback {
  /**
   * 'close' es un acierto con errores de tipeo perdonados: cuenta igual, pero
   * da menos puntos. 'ambiguous' no gasta el intento: puede volver a responder.
   */
  verdict: 'correct' | 'close' | 'ambiguous' | 'wrong';
  /** Solo en 'ambiguous': nombres entre los que tiene que elegir, en los dos idiomas. */
  options?: LocalizedName[];
}

export interface ServerToClientEvents {
  /** Se envía al conectar (o reconectar) con la sesión actual. */
  'session:ready': (session: SessionInfo) => void;
  /** Jugadores conectados al servidor (prueba simple de broadcast en tiempo real). */
  'server:presence': (presence: { online: number }) => void;

  /** Snapshot completo de la party. Se manda ante cualquier cambio y al reconectar. */
  'room:state': (room: RoomState) => void;
  /** Ya no estás en la party (te fuiste, te expulsaron o se cerró). */
  'room:left': (payload: { code: string; reason: LeaveReason }) => void;
}

/** Datos que el servidor adjunta a cada socket. */
export interface SocketData {
  sessionToken: string;
}
