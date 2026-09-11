/**
 * Tipos del dominio del juego. No importan nada: son la base sobre la que se
 * construyen las constantes, las validaciones y el contrato de eventos.
 */

/** En qué está la party ahora mismo. */
export type RoomPhase = 'lobby' | 'playing' | 'results';

/**
 * Si la party aparece en la lista pública o solo se entra con el código.
 *
 * No está en `GameSettings` a propósito: no cambia en nada cómo se juega, y el
 * GameEngine no tiene por qué enterarse de si la sala está listada.
 */
export type PartyVisibility = 'public' | 'private';

export type Difficulty = 'easy' | 'medium' | 'hard' | 'all';

/** Configuración de la partida. Solo el host la edita; el servidor la hace cumplir. */
export interface GameSettings {
/** Cómo se juega: normal o alguno de los modos con vuelta de rosca. */
  mode: GameModeId;
  difficulty: Difficulty;
  /** Cantidad de rondas de la partida. */
  totalRounds: number;
  /** Banderas seguidas dentro de cada ronda (después va un resumen con ranking). */
  flagsPerRound: number;
  /** Segundos para responder cada bandera. */
  secondsPerFlag: number;
}

/** Lo que todos los jugadores pueden ver de otro jugador. Nunca incluye el token. */
export interface PublicPlayer {
  id: string;
  nickname: string;
  connected: boolean;
  /** Entró con la partida ya empezada: mira y juega la revancha. */
  waiting: boolean;
}

/**
 * Snapshot completo y público de una party.
 * Se manda entero (no diffs): con ≤12 jugadores pesa poco y una reconexión
 * se resincroniza sola sin lógica de merge.
 */
export interface RoomState {
  code: string;
  phase: RoomPhase;
  hostId: string;
  players: PublicPlayer[];
  settings: GameSettings;
  maxPlayers: number;
  visibility: PartyVisibility;
  /**
   * Partida en curso, o null si están en el lobby.
   *
   * Viaja dentro del snapshot de la party a propósito: así reconectarse en
   * medio de una ronda usa exactamente el mismo camino que todo lo demás.
   */
  game: GameSnapshot | null;
}

/**
 * Una party pública tal como se ve desde afuera, en la lista.
 *
 * Es deliberadamente más pobre que `RoomState`: quien todavía no entró no tiene
 * por qué ver los ids de los jugadores ni el estado de la partida. Lo justo para
 * decidir si querés entrar.
 */
export interface PublicParty {
  code: string;
  hostNickname: string;
  players: number;
  maxPlayers: number;
  mode: GameModeId;
  difficulty: Difficulty;
  totalRounds: number;
  flagsPerRound: number;
  secondsPerFlag: number;
  /** Hace cuánto se creó, en ms. El cliente lo muestra como "hace 2 min". */
  ageMs: number;
}

// ── Países y banderas ───────────────────────────────────────

export type Continent = 'africa' | 'americas' | 'asia' | 'europe' | 'oceania';

/**
 * Un país del juego. `names` guarda los nombres por idioma tal como vienen del
 * dataset; el servidor los normaliza a un índice al arrancar. No hay selección
 * de idioma: se acepta el nombre en cualquiera de los 78.
 */
export interface Country {
  /** ISO 3166-1 alpha-2 en mayúsculas: "AR" → la imagen es flags/ar.svg */
  id: string;
  /** Decorativo. Windows no dibuja emojis de banderas, así que nunca es la imagen. */
  emoji: string;
  displayName: { es: string; en: string };
  names: Record<string, string[]>;
  /** Nombres agregados a mano que el dataset no trae ("EEUU", "Holanda"). */
  aliases: string[];
  difficulty: Difficulty;
  continent: Continent;
  /** Banderas parecidas, para el modo del mismo nombre (Fase 7). */
  similarTo?: string[];
}

/** Un texto que el servidor manda en los dos idiomas y el cliente elige cuál usar. */
export interface LocalizedName {
  es: string;
  en: string;
}

/** Lo que se revela de una bandera cuando termina el tiempo. */
export interface FlagReveal {
  countryId: string;
  name: LocalizedName;
  emoji: string;
  /** Ahora sí la URL real y cacheable: ya no hace falta ocultar cuál era. */
  flagUrl: string;
}

// ── Partida ─────────────────────────────────────────────────

/**
 * Fases dentro de una partida. La party además tiene su propia `phase`
 * ('lobby' | 'playing' | 'results'), que dice si hay partida en curso.
 */
export type GamePhase = 'countdown' | 'flag' | 'reveal' | 'roundSummary' | 'results';

/** Cómo le fue a un jugador con una bandera. Se revela recién al terminar el tiempo. */
export interface FlagOutcome {
  playerId: string;
  correct: boolean;
  /** Lo que escribió, o null si se quedó sin responder. */
  answer: string | null;
  /** Cuánto tardó desde que apareció la bandera. Lo mide el servidor. */
  ms: number | null;
  /** Lo que sumó (o restó) esta bandera, ya con velocidad y racha aplicadas. */
  points: number;
  /** Errores de tipeo que se le perdonaron. 0 si la escribió tal cual. */
  typos: number;
  /** Racha que quedó después de esta bandera. 0 si erró o no respondió. */
  streak: number;
}

/**
 * Cómo le fue a un jugador en toda la partida.
 * Se acumula bandera a bandera para poder mostrarla al final sin recalcular nada.
 */
export interface PlayerStats {
  correct: number;
  wrong: number;
  /** Banderas que se le pasaron sin responder. */
  missed: number;
  /** Aciertos a los que se les perdonó algún error de tipeo. */
  withTypos: number;
  /** La racha más larga de toda la partida. */
  bestStreak: number;
  /** Puntos sumados en todas las rondas. */
  totalPoints: number;
  /** La respuesta correcta más rápida, en ms. null si no acertó ninguna. */
  fastestMs: number | null;
  /** Promedio de sus respuestas correctas, en ms. */
  averageMs: number | null;
}

export interface GamePlayer {
  playerId: string;
  nickname: string;
  connected: boolean;
  /** Ya respondió esta bandera. Los demás ven esto, pero no si acertó. */
  answered: boolean;
  /** Puntos de la ronda actual. Arranca en 0 en cada ronda y nunca baja de 0. */
  roundPoints: number;
  /** Aciertos seguidos. Alimenta el multiplicador. */
  streak: number;
  /** Puntos con los que cerró la ronda anterior. Sirve para el resumen. */
  lastRoundPoints: number;
  /** Rondas ganadas: el marcador general de la partida. */
  roundsWon: number;
  stats: PlayerStats;
}

/**
 * Estado completo de la partida en curso.
 *
 * Va dentro de `RoomState`, así una reconexión se resincroniza con el mismo
 * mecanismo que todo lo demás y no hace falta reconstruir nada en el cliente.
 */
export interface GameSnapshot {
  phase: GamePhase;
  /** Instantes absolutos del reloj del servidor; el cliente los traduce al suyo. */
  startsAt: number;
  endsAt: number;
  /** Ronda actual y bandera dentro de la ronda, ambas desde 1. */
  round: number;
  totalRounds: number;
  flagInRound: number;
  flagsPerRound: number;
  /**
   * Mientras la bandera está activa es una URL con token aleatorio, para que el
   * código del país no se vea en las herramientas del navegador. En 'reveal'
   * pasa a ser la URL real.
   */
  flagUrl: string | null;
  /** Solo en 'reveal' y en adelante: qué país era y cómo le fue a cada uno. */
  reveal: FlagReveal | null;
  outcomes: FlagOutcome[];
  players: GamePlayer[];
  mode: GameModeId;
  /** Efecto a aplicar sobre la bandera activa, o null si se ve tal cual. */
  presentation: FlagPresentation | null;
}

// ── Modos de juego ──────────────────────────────────────────

export type GameModeId =
  | 'normal'
  | 'pixelated'
  | 'cropped'
  | 'grayscale'
  | 'similar'
  | 'bomb'
  | 'flash';

/** Cómo se dibuja la bandera. El servidor lo decide, el cliente lo aplica. */
export type FlagEffect = 'pixelated' | 'cropped' | 'grayscale' | 'flash';

export interface FlagPresentation {
  effect: FlagEffect;
  /**
   * Si el efecto se va aflojando mientras corre el tiempo.
   *
   * Los modos que se aclaran premian arriesgar temprano: cuanto antes la
   * reconocés, más puntos por velocidad. Los grises no se aflojan nunca,
   * porque revelar el color sería revelar la respuesta.
   */
  fades: boolean;
  /**
   * Solo para 'flash': cuántos ms se ve la bandera antes de taparse.
   *
   * Va en el snapshot y no como una constante del cliente porque es una regla
   * del modo, y las reglas las decide el servidor. El cliente lo compara contra
   * el tiempo transcurrido —que ya calcula para la barra— y tapa la bandera.
   */
  visibleMs?: number;
}

/**
 * Lo que la UI necesita saber de un modo.
 * El nombre y la descripción no están acá: son texto traducible y viven en el
 * diccionario del cliente. Acá solo lo que no depende del idioma.
 */
export interface GameModeInfo {
  id: GameModeId;
  emoji: string;
}
