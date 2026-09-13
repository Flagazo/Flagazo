import {
  DEFAULT_GAME_SETTINGS,
  DEFAULT_VISIBILITY,
  MAX_PLAYERS_PER_PARTY,
  nicknameKey,
} from '@flagazo/shared';
import type {
  GameSettings,
  PartyVisibility,
  PublicParty,
  PublicPlayer,
  RoomPhase,
  RoomState,
} from '@flagazo/shared';
import type { ActiveGame } from '../game/Game';
/**
 * La cuenta con la que juega alguien. Es lo único de la cuenta que llega a las
 * salas: nada de email, nada de sesión.
 */
export interface PlayerAccount {
  userId: string;
  username: string;
  avatarUrl: string | null;
}

/** Un jugador dentro de una party (estado interno del servidor). */
export interface RoomPlayer {
  id: string;
  nickname: string;
  /** Nickname normalizado, para detectar duplicados sin importar tildes ni mayúsculas. */
  key: string;
  connected: boolean;
  /** Orden de llegada: define quién hereda la corona. */
  joinedAt: number;
  /** Entró con la partida ya empezada: mira y juega la revancha (Fase 5). */
  waiting: boolean;
  /**
   * La cuenta con la que juega, o null si es invitado. Separada del jugador a
   * propósito: el jugador es "esta conexión en esta sala"; la cuenta es la
   * persona que la usa, y puede no haber ninguna.
   */
  account: PlayerAccount | null;
}

/**
 * Una party. Solo guarda datos y responde preguntas sobre sí misma:
 * los timers, el ciclo de vida y los avisos los maneja el RoomManager.
 */
export class Room {
  readonly players = new Map<string, RoomPlayer>();
  /** Expulsados: no pueden volver a entrar mientras la party exista. */
  readonly bannedIds = new Set<string>();
  readonly createdAt = Date.now();

  hostId: string;
  phase: RoomPhase = 'lobby';
  settings: GameSettings = { ...DEFAULT_GAME_SETTINGS };
  visibility: PartyVisibility = DEFAULT_VISIBILITY;
  /** Motor de la partida en curso, del juego que sea, o null si están en el lobby. */
  game: ActiveGame | null = null;
  /**
   * La partida en curso para las estadísticas: su id (que la hace idempotente al
   * grabarla), cuándo empezó y con qué cuenta arrancó cada jugador. Las cuentas se
   * fijan al empezar: iniciar o cerrar sesión a mitad de partida no cambia a quién
   * se le cargan los resultados.
   */
  match: { id: string; startedAt: Date; accounts: Map<string, PlayerAccount | null> } | null = null;

  constructor(
    readonly code: string,
    host: { id: string; nickname: string; account?: PlayerAccount | null },
    visibility: PartyVisibility = DEFAULT_VISIBILITY,
  ) {
    this.hostId = host.id;
    this.visibility = visibility;
    this.addPlayer(host);
  }

  addPlayer(player: { id: string; nickname: string; account?: PlayerAccount | null }): RoomPlayer {
    const entry: RoomPlayer = {
      id: player.id,
      nickname: player.nickname,
      key: nicknameKey(player.nickname),
      connected: true,
      joinedAt: Date.now(),
      // Si la partida ya arrancó, mira desde afuera hasta la próxima.
      waiting: this.phase !== 'lobby',
      account: player.account ?? null,
    };
    this.players.set(entry.id, entry);
    return entry;
  }

  isFull(): boolean {
    return this.players.size >= MAX_PLAYERS_PER_PARTY;
  }

  /** ¿Esa cuenta ya está jugando en esta sala, con otro jugador? */
  hasAccount(userId: string, exceptId?: string): boolean {
    for (const player of this.players.values()) {
      if (player.id !== exceptId && player.account?.userId === userId) return true;
    }
    return false;
  }

  /** ¿Hay otro jugador con ese nombre? (ignora tildes y mayúsculas) */
  hasNickname(nickname: string, exceptId?: string): boolean {
    const key = nicknameKey(nickname);
    for (const player of this.players.values()) {
      if (player.id !== exceptId && player.key === key) return true;
    }
    return false;
  }

  connectedCount(): number {
    let count = 0;
    for (const player of this.players.values()) if (player.connected) count++;
    return count;
  }

  /**
   * Quién hereda la corona: el jugador conectado más antiguo.
   * Si no queda nadie conectado, el más antiguo de todos, para que la party
   * nunca quede apuntando a un host que ya no existe.
   */
  nextHost(excludeId: string): RoomPlayer | null {
    let best: RoomPlayer | null = null;
    for (const player of this.players.values()) {
      if (player.id === excludeId) continue;
      if (!best) {
        best = player;
        continue;
      }
      // Conectado le gana a desconectado; a igualdad, el que llegó primero.
      if (player.connected !== best.connected) {
        if (player.connected) best = player;
      } else if (player.joinedAt < best.joinedAt) {
        best = player;
      }
    }
    return best;
  }

  /** Snapshot público que se manda a todos los miembros. */
  toState(): RoomState {
    const players: PublicPlayer[] = [...this.players.values()]
      .sort((a, b) => a.joinedAt - b.joinedAt)
      .map((player) => ({
        id: player.id,
        nickname: player.nickname,
        registered: player.account !== null,
        avatarUrl: player.account?.avatarUrl ?? null,
        connected: player.connected,
        waiting: player.waiting,
      }));

    return {
      code: this.code,
      phase: this.phase,
      hostId: this.hostId,
      players,
      settings: { ...this.settings },
      maxPlayers: MAX_PLAYERS_PER_PARTY,
      visibility: this.visibility,
      game: this.game?.toSnapshot() ?? null,
    };
  }

  /**
   * Cómo se ve esta party en el buscador, o null si no corresponde listarla.
   *
   * Se listan solo las que están en el lobby: entrar a una partida en curso te
   * deja mirando hasta la revancha, que con 100 banderas puede ser media hora.
   * Está bien si te pasaron el código y sabés a qué vas, pero es una pésima
   * primera impresión para alguien que entró desde una lista.
   */
  toPublicListing(): PublicParty | null {
    if (this.visibility !== 'public') return null;
    if (this.phase !== 'lobby') return null;
    if (this.isFull()) return null;

    const host = this.players.get(this.hostId);
    if (!host) return null;

    return {
      code: this.code,
      hostNickname: host.nickname,
      players: this.players.size,
      maxPlayers: MAX_PLAYERS_PER_PARTY,
      kind: this.settings.kind,
      mode: this.settings.mode,
      difficulty: this.settings.difficulty,
      totalRounds: this.settings.totalRounds,
      flagsPerRound: this.settings.flagsPerRound,
      secondsPerFlag: this.settings.secondsPerFlag,
      drawRounds: this.settings.drawRounds,
      drawSeconds: this.settings.drawSeconds,
      ageMs: Date.now() - this.createdAt,
    };
  }
}
