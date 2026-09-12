import {
  DEFAULT_VISIBILITY,
  EMPTY_ROOM_TTL_MS,
  HOST_GRACE_MS,
  LOBBY_DISCONNECT_GRACE_MS,
  MAX_PUBLIC_PARTIES_LISTED,
  isValidPartyCode,
  isValidSettings,
  normalizePartyCode,
} from '@flagazo/shared';
import type {
  GameError,
  GameSettings,
  LeaveReason,
  PartyError,
  PartyVisibility,
  PublicParty,
  Result,
} from '@flagazo/shared';
import type { AnswerOutcome } from '../game/FlagGuessGame';
import { createGame } from '../game/Game';
import { createLogger } from '../lib/log';
import { Room } from './Room';
import { generatePartyCode } from './codes';

const log = createLogger('rooms');

/** Datos mínimos de quien realiza la acción. */
export interface ActingPlayer {
  id: string;
  nickname: string;
}

/**
 * Avisos hacia la capa de sockets. Mantenerlos como callbacks deja a `rooms/`
 * sin ninguna dependencia de Socket.IO, así se puede testear sin red.
 */
export interface RoomHooks {
  /** La party cambió: hay que reenviar el snapshot a sus miembros. */
  onState(room: Room): void;
  /** Este jugador dejó de pertenecer a la party. */
  onPlayerRemoved(playerId: string, code: string, reason: LeaveReason): void;
}

/** Tiempos de gracia. Se inyectan para que los tests no tengan que esperar 30 segundos. */
export interface RoomTiming {
  hostGraceMs: number;
  lobbyDisconnectMs: number;
  emptyRoomMs: number;
}

const DEFAULT_TIMING: RoomTiming = {
  hostGraceMs: HOST_GRACE_MS,
  lobbyDisconnectMs: LOBBY_DISCONNECT_GRACE_MS,
  emptyRoomMs: EMPTY_ROOM_TTL_MS,
};

type PartyResult<T> = Result<T, PartyError>;

const fail = <T,>(error: PartyError): PartyResult<T> => ({ ok: false, error });
const done = <T,>(data: T): PartyResult<T> => ({ ok: true, data });

const hostKey = (code: string) => `host:${code}`;
const emptyKey = (code: string) => `empty:${code}`;
const playerKey = (playerId: string) => `player:${playerId}`;

/**
 * Dueño de todas las parties en memoria.
 *
 * Es la única fuente de verdad sobre quién está en qué sala, quién es el host
 * y cuál es la configuración. Los handlers de socket solo traducen intenciones
 * a llamadas de esta clase y devuelven lo que responde.
 */
export class RoomManager {
  private readonly rooms = new Map<string, Room>();
  /** Índice inverso para responder "¿en qué party está este jugador?" en O(1). */
  private readonly playerRoom = new Map<string, string>();
  private readonly timers = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly hooks: RoomHooks,
    private readonly timing: RoomTiming = DEFAULT_TIMING,
  ) {}

  // ── Consultas ─────────────────────────────────────────────

  getRoom(code: string): Room | undefined {
    return this.rooms.get(code);
  }

  roomOf(playerId: string): Room | undefined {
    const code = this.playerRoom.get(playerId);
    return code ? this.rooms.get(code) : undefined;
  }

  countRooms(): number {
    return this.rooms.size;
  }

  // ── Acciones del jugador ──────────────────────────────────

  create(player: ActingPlayer, visibility: PartyVisibility = DEFAULT_VISIBILITY): PartyResult<Room> {
    if (this.playerRoom.has(player.id)) return fail('ALREADY_IN_PARTY');

    const code = generatePartyCode((candidate) => this.rooms.has(candidate));
    if (!code) return fail('NO_CODE_AVAILABLE');

    const room = new Room(code, player, visibility);
    this.rooms.set(code, room);
    this.playerRoom.set(player.id, code);
    log.info(
      `party ${code} (${visibility}) creada por "${player.nickname}" · ${this.rooms.size} activas`,
    );

    this.hooks.onState(room);
    return done(room);
  }

  join(rawCode: unknown, player: ActingPlayer): PartyResult<Room> {
    if (typeof rawCode !== 'string') return fail('INVALID_CODE');
    const code = normalizePartyCode(rawCode);
    if (!isValidPartyCode(code)) return fail('INVALID_CODE');

    const current = this.roomOf(player.id);
    // Reentrar a la misma party (doble click, F5 lento) no es un error.
    if (current) return current.code === code ? done(current) : fail('ALREADY_IN_PARTY');

    const room = this.rooms.get(code);
    if (!room) return fail('NOT_FOUND');
    if (room.bannedIds.has(player.id)) return fail('KICKED');
    if (room.isFull()) return fail('FULL');
    if (room.hasNickname(player.nickname)) return fail('NICK_TAKEN');

    room.addPlayer(player);
    this.playerRoom.set(player.id, code);
    // Alguien volvió: la party ya no está vacía ni en camino a borrarse.
    this.cancel(emptyKey(code));
    log.info(`"${player.nickname}" entró a ${code} · ${room.players.size} jugadores`);

    this.hooks.onState(room);
    return done(room);
  }

  leave(playerId: string): PartyResult<null> {
    if (!this.roomOf(playerId)) return fail('NOT_IN_PARTY');
    this.removePlayer(playerId, 'left');
    return done(null);
  }

  kick(hostId: string, targetId: unknown): PartyResult<null> {
    const room = this.roomOf(hostId);
    if (!room) return fail('NOT_IN_PARTY');
    if (room.hostId !== hostId) return fail('NOT_HOST');
    if (typeof targetId !== 'string') return fail('TARGET_NOT_FOUND');
    if (targetId === hostId) return fail('CANT_KICK_HOST');
    if (!room.players.has(targetId)) return fail('TARGET_NOT_FOUND');

    this.removePlayer(targetId, 'kicked');
    return done(null);
  }

  updateSettings(hostId: string, patch: Partial<GameSettings>): PartyResult<GameSettings> {
    const room = this.roomOf(hostId);
    if (!room) return fail('NOT_IN_PARTY');
    if (room.hostId !== hostId) return fail('NOT_HOST');

    const next: GameSettings = { ...room.settings, ...patch };
    if (!isValidSettings(next)) return fail('INVALID_SETTINGS');

    room.settings = next;
    this.hooks.onState(room);
    return done({ ...next });
  }

  setVisibility(hostId: string, visibility: PartyVisibility): PartyResult<PartyVisibility> {
    const room = this.roomOf(hostId);
    if (!room) return fail('NOT_IN_PARTY');
    if (room.hostId !== hostId) return fail('NOT_HOST');

    room.visibility = visibility;
    this.hooks.onState(room);
    return done(visibility);
  }

  /**
   * Las parties públicas que se pueden mostrar en el buscador.
   *
   * Se recorren todas las salas en cada pedido en vez de mantener un índice de
   * públicas: con las decenas de parties que aguanta una instancia, el recorrido
   * es más barato que la clase de bug que trae un índice desincronizado.
   * Si esto alguna vez escala, acá es donde hay que mirar.
   */
  listPublic(): PublicParty[] {
    const parties: PublicParty[] = [];
    for (const room of this.rooms.values()) {
      const listing = room.toPublicListing();
      if (listing) parties.push(listing);
    }
    // Las que están por llenarse primero: son las que antes van a empezar.
    parties.sort((a, b) => b.players - a.players || a.ageMs - b.ageMs);
    return parties.slice(0, MAX_PUBLIC_PARTIES_LISTED);
  }

  /** Sincroniza un cambio de nickname hecho estando dentro de una party. */
  rename(playerId: string, nickname: string, key: string): PartyResult<null> {
    const room = this.roomOf(playerId);
    if (!room) return done(null); // no está en ninguna party: nada que sincronizar

    const player = room.players.get(playerId);
    if (!player) return done(null);
    if (room.hasNickname(nickname, playerId)) return fail('NICK_TAKEN');

    player.nickname = nickname;
    player.key = key;
    room.game?.rename(playerId, nickname);

    this.hooks.onState(room);
    return done(null);
  }

  // ── Partida ───────────────────────────────────────────────

  /** Arranca la partida. Solo el host, y solo desde el lobby. */
  startGame(hostId: string): Result<null, PartyError | GameError> {
    const room = this.roomOf(hostId);
    if (!room) return { ok: false, error: 'NOT_IN_PARTY' };
    if (room.hostId !== hostId) return { ok: false, error: 'NOT_HOST' };
    if (room.phase !== 'lobby') return { ok: false, error: 'ALREADY_PLAYING' };
    if (!isValidSettings(room.settings)) return { ok: false, error: 'INVALID_SETTINGS' };

    const roster = [...room.players.values()].map((player) => ({
      id: player.id,
      nickname: player.nickname,
      connected: player.connected,
    }));

    room.phase = 'playing';
    // Qué motor juega lo decide `settings.kind`. De acá para abajo, la sala trata
    // igual a cualquier juego.
    room.game = createGame(room.settings, roster, {
      // Cada transición del motor reenvía el snapshot de la party entera.
      onChange: () => {
        if (room.game?.isFinished && room.phase !== 'results') {
          room.phase = 'results';
          // Terminó la partida: los que se desconectaron en el camino ya no
          // están protegidos y vuelve a correrles el tiempo de gracia.
          this.scheduleAbsentPlayers(room);
        }
        this.hooks.onState(room);
      },
    });
    // Nadie que se sume ahora juega esta partida: entra en espera.
    for (const player of room.players.values()) player.waiting = false;

    log.info(`${room.code}: arranca la partida`);
    room.game.start();
    return { ok: true, data: null };
  }

  answer(playerId: string, text: string): Result<AnswerOutcome, PartyError | GameError> {
    const room = this.roomOf(playerId);
    if (!room) return { ok: false, error: 'NOT_IN_PARTY' };
    if (!room.game) return { ok: false, error: 'NOT_PLAYING' };
    if (room.game.kind !== 'guess') return { ok: false, error: 'WRONG_GAME' };
    // Entró con la partida empezada: mira, pero juega recién la próxima.
    if (room.players.get(playerId)?.waiting) return { ok: false, error: 'NOT_PLAYING' };

    const outcome = room.game.answer(playerId, text);
    if (outcome === 'NO_FLAG_ACTIVE') return { ok: false, error: 'NO_FLAG_ACTIVE' };
    if (outcome === 'ALREADY_ANSWERED') return { ok: false, error: 'ALREADY_ANSWERED' };
    return { ok: true, data: outcome };
  }

  /**
   * El dibujo de un jugador en Draw Battle. La validación del contenido la hace el
   * motor, con el mismo decodificador que usa el cliente para armarlo.
   */
  submitDrawing(
    playerId: string,
    payload: { round?: unknown; drawing?: unknown; final?: unknown },
  ): Result<null, PartyError | GameError> {
    const room = this.roomOf(playerId);
    if (!room) return { ok: false, error: 'NOT_IN_PARTY' };
    if (!room.game) return { ok: false, error: 'NOT_PLAYING' };
    if (room.game.kind !== 'draw') return { ok: false, error: 'WRONG_GAME' };
    if (room.players.get(playerId)?.waiting) return { ok: false, error: 'NOT_PLAYING' };

    const error = room.game.submitDrawing(playerId, payload.round, payload.drawing, payload.final);
    return error ? { ok: false, error } : { ok: true, data: null };
  }

  /** Vuelve al lobby conservando la party y los jugadores. */
  rematch(hostId: string): Result<null, PartyError | GameError> {
    const room = this.roomOf(hostId);
    if (!room) return { ok: false, error: 'NOT_IN_PARTY' };
    if (room.hostId !== hostId) return { ok: false, error: 'NOT_HOST' };
    if (!room.game) return { ok: false, error: 'NOT_PLAYING' };
    if (!room.game.isFinished) return { ok: false, error: 'GAME_NOT_FINISHED' };

    this.endGame(room);
    this.hooks.onState(room);
    return { ok: true, data: null };
  }

  private endGame(room: Room) {
    room.game?.dispose();
    room.game = null;
    room.phase = 'lobby';
    // Los que miraron desde afuera ya son jugadores para la próxima.
    for (const player of room.players.values()) player.waiting = false;
    this.scheduleAbsentPlayers(room);
  }

  /**
   * Programa la baja de los que quedaron desconectados.
   *
   * Durante la partida no se saca a nadie: se queda en el ranking hasta el
   * final. Pero cuando la partida termina esa protección deja de aplicar, y sin
   * esto un jugador que se fue a mitad de camino quedaría en la sala para siempre.
   */
  private scheduleAbsentPlayers(room: Room) {
    for (const player of room.players.values()) {
      if (!player.connected) this.scheduleAbsence(room, player.id);
    }
  }

  // ── Conexión y desconexión ────────────────────────────────

  /**
   * Marca al jugador como conectado o no.
   *
   * Al desconectarse no se lo elimina enseguida: se le da tiempo a volver
   * (bloqueo del celular, cambio de wifi, F5) y recién después se lo saca.
   */
  setConnected(playerId: string, connected: boolean): Room | null {
    const room = this.roomOf(playerId);
    const player = room?.players.get(playerId);
    if (!room || !player) return null;
    if (player.connected === connected) return room;

    player.connected = connected;
    // La bandera activa puede cerrarse si el que faltaba se fue.
    room.game?.setConnected(playerId, connected);

    if (connected) {
      this.cancel(playerKey(playerId));
      this.cancel(emptyKey(room.code));
      // Volvió el host antes de que venciera la gracia: se queda con la corona.
      if (playerId === room.hostId) this.cancel(hostKey(room.code));
    } else {
      this.scheduleAbsence(room, playerId);
    }

    this.hooks.onState(room);
    return room;
  }

  private scheduleAbsence(room: Room, playerId: string) {
    // Con la partida en curso no se saca a nadie: sigue en el ranking hasta el
    // final aunque se le corte el wifi. Fuera de la partida sí vence la gracia.
    if (room.phase !== 'playing') {
      this.schedule(playerKey(playerId), this.timing.lobbyDisconnectMs, () => {
        this.removePlayer(playerId, 'timeout');
      });
    }

    if (playerId === room.hostId) {
      this.schedule(hostKey(room.code), this.timing.hostGraceMs, () => {
        if (this.transferHost(room, playerId)) this.hooks.onState(room);
      });
    }

    this.scheduleEmptyCheck(room);
  }

  private scheduleEmptyCheck(room: Room) {
    if (room.connectedCount() > 0) return;
    this.schedule(emptyKey(room.code), this.timing.emptyRoomMs, () => {
      this.closeRoom(room, 'closed');
    });
  }

  // ── Interno ───────────────────────────────────────────────

  private removePlayer(playerId: string, reason: LeaveReason) {
    const room = this.roomOf(playerId);
    if (!room) return;

    const player = room.players.get(playerId);
    room.players.delete(playerId);
    this.playerRoom.delete(playerId);
    room.game?.removePlayer(playerId);
    this.cancel(playerKey(playerId));
    if (reason === 'kicked') room.bannedIds.add(playerId);
    log.info(`"${player?.nickname ?? playerId}" salió de ${room.code} (${reason})`);

    if (room.players.size === 0) {
      this.deleteRoom(room);
    } else {
      if (room.hostId === playerId) {
        this.cancel(hostKey(room.code));
        this.transferHost(room, playerId);
      }
      this.scheduleEmptyCheck(room);
      this.hooks.onState(room);
    }

    this.hooks.onPlayerRemoved(playerId, room.code, reason);
  }

  private transferHost(room: Room, previousHostId: string): boolean {
    const heir = room.nextHost(previousHostId);
    if (!heir || heir.id === room.hostId) return false;
    room.hostId = heir.id;
    log.info(`${room.code}: la corona pasa a "${heir.nickname}"`);
    return true;
  }

  private closeRoom(room: Room, reason: LeaveReason) {
    const members = [...room.players.keys()];
    this.deleteRoom(room);
    for (const playerId of members) this.hooks.onPlayerRemoved(playerId, room.code, reason);
  }

  private deleteRoom(room: Room) {
    room.game?.dispose();
    room.game = null;
    for (const playerId of room.players.keys()) {
      this.playerRoom.delete(playerId);
      this.cancel(playerKey(playerId));
    }
    room.players.clear();
    this.rooms.delete(room.code);
    this.cancel(hostKey(room.code));
    this.cancel(emptyKey(room.code));
    log.info(`party ${room.code} cerrada · ${this.rooms.size} activas`);
  }

  private schedule(key: string, delayMs: number, run: () => void) {
    this.cancel(key);
    const timer = setTimeout(() => {
      this.timers.delete(key);
      run();
    }, delayMs);
    // No mantener vivo el proceso solo por un timer de gracia.
    timer.unref();
    this.timers.set(key, timer);
  }

  private cancel(key: string) {
    const timer = this.timers.get(key);
    if (!timer) return;
    clearTimeout(timer);
    this.timers.delete(key);
  }

  /** Corta todos los timers pendientes (cierre del servidor y tests). */
  dispose() {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }
}
