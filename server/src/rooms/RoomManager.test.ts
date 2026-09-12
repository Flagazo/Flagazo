import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { COUNTDOWN_MS, MAX_PLAYERS_PER_PARTY, REVEAL_MS } from '@flagazo/shared';
import type { LeaveReason } from '@flagazo/shared';
import { RoomManager } from './RoomManager';
import type { RoomTiming } from './RoomManager';

/** Tiempos cortos: los tests verifican la lógica, no la paciencia. */
const TIMING: RoomTiming = { hostGraceMs: 20, lobbyDisconnectMs: 40, emptyRoomMs: 60 };

interface Removal {
  playerId: string;
  code: string;
  reason: LeaveReason;
}

let rooms: RoomManager;
let states: string[];
let removals: Removal[];

const player = (id: string, nickname = id) => ({ id, nickname });
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

beforeEach(() => {
  states = [];
  removals = [];
  rooms = new RoomManager(
    {
      onState: (room) => states.push(room.code),
      onPlayerRemoved: (playerId, code, reason) => removals.push({ playerId, code, reason }),
    },
    TIMING,
  );
});

/** Crea una party y devuelve su código. */
function createParty(id = 'host'): string {
  const result = rooms.create(player(id));
  if (!result.ok) throw new Error(result.error);
  return result.data.code;
}

describe('crear y unirse', () => {
  it('crea una party con código válido y al creador como host', () => {
    const code = createParty('ana');
    const room = rooms.getRoom(code)!;

    expect(code).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{5}$/);
    expect(room.hostId).toBe('ana');
    expect(room.toState().players).toEqual([
      { id: 'ana', nickname: 'ana', connected: true, waiting: false },
    ]);
    expect(states).toEqual([code]);
  });

  it('acepta el código en cualquier formato', () => {
    const code = createParty();
    const messy = ` ${code.toLowerCase().slice(0, 3)}-${code.toLowerCase().slice(3)} `;

    expect(rooms.join(messy, player('bea')).ok).toBe(true);
    expect(rooms.getRoom(code)!.players.size).toBe(2);
  });

  it('rechaza códigos mal formados, inexistentes y de otro jugador ya en party', () => {
    const code = createParty();

    expect(rooms.join('XX', player('bea'))).toEqual({ ok: false, error: 'INVALID_CODE' });
    expect(rooms.join('O0I1L', player('bea'))).toEqual({ ok: false, error: 'INVALID_CODE' });
    expect(rooms.join(42, player('bea'))).toEqual({ ok: false, error: 'INVALID_CODE' });
    // Código bien formado que no corresponde a ninguna party viva.
    const ghost = code === 'AAAAA' ? 'BBBBB' : 'AAAAA';
    expect(rooms.join(ghost, player('bea'))).toEqual({ ok: false, error: 'NOT_FOUND' });

    rooms.join(code, player('bea'));
    expect(rooms.create(player('bea'))).toEqual({ ok: false, error: 'ALREADY_IN_PARTY' });
  });

  it('reentrar a la misma party no es un error', () => {
    const code = createParty();
    const again = rooms.join(code, player('host'));
    expect(again.ok).toBe(true);
    expect(rooms.getRoom(code)!.players.size).toBe(1);
  });

  it('rechaza nicknames repetidos ignorando tildes y mayúsculas', () => {
    const code = createParty('Juan');
    expect(rooms.join(code, player('otro', 'JUÁN'))).toEqual({ ok: false, error: 'NICK_TAKEN' });
    expect(rooms.join(code, player('otro', 'Juana')).ok).toBe(true);
  });

  it('rechaza al que llega con la sala llena', () => {
    const code = createParty('p0');
    for (let i = 1; i < MAX_PLAYERS_PER_PARTY; i++) {
      expect(rooms.join(code, player(`p${i}`)).ok).toBe(true);
    }

    expect(rooms.getRoom(code)!.players.size).toBe(MAX_PLAYERS_PER_PARTY);
    expect(rooms.join(code, player('uno-mas'))).toEqual({ ok: false, error: 'FULL' });
  });

  it('entran 30 jugadores', () => {
    // El cupo subió de 12 a 30: que nadie lo baje sin darse cuenta.
    expect(MAX_PLAYERS_PER_PARTY).toBe(30);
  });
});

describe('host', () => {
  it('solo el host cambia settings y expulsa', () => {
    const code = createParty('ana');
    rooms.join(code, player('bea'));

    expect(rooms.updateSettings('bea', { totalRounds: 5 })).toEqual({ ok: false, error: 'NOT_HOST' });
    expect(rooms.kick('bea', 'ana')).toEqual({ ok: false, error: 'NOT_HOST' });
    expect(rooms.kick('ana', 'ana')).toEqual({ ok: false, error: 'CANT_KICK_HOST' });
    expect(rooms.kick('ana', 'fantasma')).toEqual({ ok: false, error: 'TARGET_NOT_FOUND' });

    const updated = rooms.updateSettings('ana', { totalRounds: 5, difficulty: 'hard' });
    expect(updated.ok && updated.data).toMatchObject({ totalRounds: 5, difficulty: 'hard' });
  });

  it('rechaza combinaciones que superan el tope de banderas por partida', () => {
    const code = createParty('ana');
    // 5 rondas × 50 banderas = 250, muy por encima del máximo de 100.
    expect(rooms.updateSettings('ana', { totalRounds: 5, flagsPerRound: 50 })).toEqual({
      ok: false,
      error: 'INVALID_SETTINGS',
    });
    // Nada se aplicó a medias: sigue con la configuración por defecto.
    expect(rooms.getRoom(code)!.settings).toMatchObject({ totalRounds: 3, flagsPerRound: 10 });

    // El borde exacto del tope sí entra.
    expect(rooms.updateSettings('ana', { totalRounds: 5, flagsPerRound: 20 }).ok).toBe(true);
    // Y una ronda única puede llevarse el máximo entero.
    expect(rooms.updateSettings('ana', { totalRounds: 1, flagsPerRound: 100 }).ok).toBe(true);
  });

  it('al irse el host la corona pasa al jugador conectado más antiguo', () => {
    const code = createParty('ana');
    rooms.join(code, player('bea'));
    rooms.join(code, player('caro'));

    rooms.setConnected('bea', false);
    rooms.leave('ana');

    // "bea" llegó primero pero está desconectada: hereda "caro".
    expect(rooms.getRoom(code)!.hostId).toBe('caro');
  });

  it('un expulsado no puede volver a entrar', () => {
    const code = createParty('ana');
    rooms.join(code, player('bea'));

    expect(rooms.kick('ana', 'bea').ok).toBe(true);
    expect(removals).toContainEqual({ playerId: 'bea', code, reason: 'kicked' });
    expect(rooms.join(code, player('bea'))).toEqual({ ok: false, error: 'KICKED' });
  });
});

describe('desconexiones', () => {
  it('marca desconectado sin sacarlo enseguida, y lo recupera al volver', async () => {
    const code = createParty('ana');
    rooms.join(code, player('bea'));

    rooms.setConnected('bea', false);
    expect(rooms.getRoom(code)!.players.get('bea')!.connected).toBe(false);

    await wait(TIMING.lobbyDisconnectMs / 2);
    rooms.setConnected('bea', true);

    await wait(TIMING.lobbyDisconnectMs);
    // Volvió antes de que venciera la gracia: sigue en la party.
    expect(rooms.getRoom(code)!.players.has('bea')).toBe(true);
  });

  it('elimina del lobby al que no vuelve dentro de la gracia', async () => {
    const code = createParty('ana');
    rooms.join(code, player('bea'));

    rooms.setConnected('bea', false);
    await wait(TIMING.lobbyDisconnectMs + 20);

    expect(rooms.getRoom(code)!.players.has('bea')).toBe(false);
    expect(removals).toContainEqual({ playerId: 'bea', code, reason: 'timeout' });
  });

  it('transfiere la corona si el host no vuelve, y la conserva si vuelve a tiempo', async () => {
    const code = createParty('ana');
    rooms.join(code, player('bea'));

    rooms.setConnected('ana', false);
    await wait(TIMING.hostGraceMs / 2);
    rooms.setConnected('ana', true);
    await wait(TIMING.hostGraceMs + 10);
    expect(rooms.getRoom(code)!.hostId).toBe('ana');

    rooms.setConnected('ana', false);
    await wait(TIMING.hostGraceMs + 10);
    expect(rooms.getRoom(code)!.hostId).toBe('bea');
  });

  it('borra la party cuando no queda nadie conectado', async () => {
    const code = createParty('ana');
    rooms.setConnected('ana', false);

    await wait(TIMING.emptyRoomMs + 30);
    expect(rooms.getRoom(code)).toBeUndefined();
    expect(rooms.countRooms()).toBe(0);
  });

  it('borra la party en cuanto se va el último jugador', () => {
    const code = createParty('ana');
    rooms.leave('ana');

    expect(rooms.getRoom(code)).toBeUndefined();
    expect(removals).toContainEqual({ playerId: 'ana', code, reason: 'left' });
    expect(rooms.leave('ana')).toEqual({ ok: false, error: 'NOT_IN_PARTY' });
  });

  it('no deja timers huérfanos de una party ya cerrada', async () => {
    const code = createParty('ana');
    rooms.join(code, player('bea'));
    rooms.setConnected('bea', false); // deja programado el borrado a los 40 ms
    rooms.leave('bea');
    rooms.leave('ana'); // la party se cierra ahora

    const removalsAfterClose = removals.length;
    await wait(TIMING.emptyRoomMs + 30);

    // Ningún timer pendiente volvió a tocar la party ni avisó de más.
    expect(rooms.countRooms()).toBe(0);
    expect(removals.length).toBe(removalsAfterClose);
  });
});

describe('desconexiones durante la partida', () => {
  const SEGUNDOS_POR_BANDERA = 10;
  const BANDERAS = 5;

  // Con timers falsos la partida entera pasa al instante y no hay que esperar
  // los 70 segundos que duraría de verdad.
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  /** Deja la party con dos jugadores y una partida en curso. */
  function partidaEnCurso() {
    const code = createParty('ana');
    rooms.join(code, player('bea'));
    rooms.updateSettings('ana', {
      totalRounds: 1,
      flagsPerRound: BANDERAS,
      secondsPerFlag: SEGUNDOS_POR_BANDERA,
    });
    expect(rooms.startGame('ana').ok).toBe(true);
    return code;
  }

  /** Deja correr la partida hasta la pantalla de resultados. */
  function jugarHastaElFinal() {
    vi.advanceTimersByTime(COUNTDOWN_MS);
    for (let i = 0; i < BANDERAS; i++) {
      vi.advanceTimersByTime(SEGUNDOS_POR_BANDERA * 1000 + REVEAL_MS);
    }
  }

  it('no saca a nadie mientras se está jugando', () => {
    const code = partidaEnCurso();
    rooms.setConnected('bea', false);

    // En el lobby ya la habrían eliminado; en partida sigue en el ranking.
    vi.advanceTimersByTime(TIMING.lobbyDisconnectMs + 20);
    expect(rooms.getRoom(code)!.players.has('bea')).toBe(true);
    expect(rooms.getRoom(code)!.players.get('bea')!.connected).toBe(false);
  });

  it('al terminar la partida vuelve a correrle el tiempo de gracia', () => {
    const code = partidaEnCurso();
    rooms.setConnected('bea', false);

    jugarHastaElFinal();
    expect(rooms.getRoom(code)!.phase).toBe('results');
    // Sobrevivió toda la partida…
    expect(rooms.getRoom(code)!.players.has('bea')).toBe(true);

    // …pero terminada la partida ya no está protegida.
    vi.advanceTimersByTime(TIMING.lobbyDisconnectMs + 20);
    expect(rooms.getRoom(code)!.players.has('bea')).toBe(false);
    expect(removals).toContainEqual({ playerId: 'bea', code, reason: 'timeout' });
  });

  it('el que entra con la partida empezada queda en espera y no puede responder', () => {
    const code = partidaEnCurso();
    rooms.join(code, player('caro'));

    expect(rooms.getRoom(code)!.players.get('caro')!.waiting).toBe(true);
    expect(rooms.answer('caro', 'Argentina')).toEqual({ ok: false, error: 'NOT_PLAYING' });
    // Y no figura en el ranking de esta partida.
    expect(rooms.getRoom(code)!.toState().game!.players.map((p) => p.playerId)).toEqual([
      'ana',
      'bea',
    ]);
  });

  it('los que estaban en espera juegan la revancha', () => {
    const code = partidaEnCurso();
    rooms.join(code, player('caro'));
    jugarHastaElFinal();

    expect(rooms.rematch('ana').ok).toBe(true);
    const room = rooms.getRoom(code)!;
    expect(room.phase).toBe('lobby');
    expect(room.players.get('caro')!.waiting).toBe(false);

    expect(rooms.startGame('ana').ok).toBe(true);
    expect(room.toState().game!.players).toHaveLength(3);
  });
});

describe('cambio de nickname dentro de la party', () => {
  it('actualiza el nombre y rechaza si ya está tomado', () => {
    const code = createParty('ana');
    rooms.join(code, player('bea', 'Bea'));

    expect(rooms.rename('bea', 'Ana', 'ana')).toEqual({ ok: false, error: 'NICK_TAKEN' });
    expect(rooms.rename('bea', 'Beatriz', 'beatriz').ok).toBe(true);
    expect(rooms.getRoom(code)!.players.get('bea')!.nickname).toBe('Beatriz');
  });

  it('no falla si el jugador no está en ninguna party', () => {
    expect(rooms.rename('nadie', 'Zoe', 'zoe')).toEqual({ ok: true, data: null });
  });
});

describe('parties públicas', () => {
  it('nace privada si no se pide otra cosa, y no aparece en la lista', () => {
    const code = createParty('ana');
    expect(rooms.getRoom(code)!.visibility).toBe('private');
    expect(rooms.listPublic()).toEqual([]);
  });

  it('se puede crear pública de entrada', () => {
    const result = rooms.create(player('ana', 'Ana'), 'public');
    expect(result.ok).toBe(true);

    const listed = rooms.listPublic();
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ hostNickname: 'Ana', players: 1, maxPlayers: MAX_PLAYERS_PER_PARTY });
  });

  it('el host la publica y la despublica en cualquier momento', () => {
    const code = createParty('ana');

    expect(rooms.setVisibility('ana', 'public')).toEqual({ ok: true, data: 'public' });
    expect(rooms.listPublic().map((p) => p.code)).toEqual([code]);

    expect(rooms.setVisibility('ana', 'private')).toEqual({ ok: true, data: 'private' });
    expect(rooms.listPublic()).toEqual([]);
  });

  it('solo el host puede cambiarla', () => {
    const code = createParty('ana');
    rooms.join(code, player('bea', 'Bea'));

    expect(rooms.setVisibility('bea', 'public')).toEqual({ ok: false, error: 'NOT_HOST' });
    expect(rooms.setVisibility('nadie', 'public')).toEqual({ ok: false, error: 'NOT_IN_PARTY' });
    expect(rooms.listPublic()).toEqual([]);
  });

  it('deja de listarse cuando empieza la partida y vuelve con la revancha', () => {
    // Con timers falsos la partida entera pasa al instante.
    vi.useFakeTimers();
    try {
      const code = createParty('ana');
      rooms.setVisibility('ana', 'public');
      rooms.join(code, player('bea', 'Bea'));
      rooms.updateSettings('ana', { totalRounds: 1, flagsPerRound: 5, secondsPerFlag: 10 });

      expect(rooms.startGame('ana').ok).toBe(true);
      // Entrar a una partida en curso te deja mirando hasta la revancha: no se ofrece.
      expect(rooms.listPublic()).toEqual([]);

      vi.advanceTimersByTime(COUNTDOWN_MS);
      for (let i = 0; i < 5; i++) vi.advanceTimersByTime(10_000 + REVEAL_MS);
      // En resultados tampoco: la party existe, pero no está esperando gente.
      expect(rooms.listPublic()).toEqual([]);

      expect(rooms.rematch('ana').ok).toBe(true);
      expect(rooms.listPublic().map((p) => p.code)).toEqual([code]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('una party llena no se ofrece', () => {
    const code = createParty('ana');
    rooms.setVisibility('ana', 'public');
    for (let i = 1; i < MAX_PLAYERS_PER_PARTY; i++) rooms.join(code, player(`p${i}`, `P${i}`));

    expect(rooms.getRoom(code)!.isFull()).toBe(true);
    expect(rooms.listPublic()).toEqual([]);
  });

  it('lista las más llenas primero: son las que antes van a empezar', () => {
    rooms.create(player('ana', 'Ana'), 'public');
    const vacia = rooms.roomOf('ana')!.code;

    rooms.create(player('bea', 'Bea'), 'public');
    const llena = rooms.roomOf('bea')!.code;
    rooms.join(llena, player('caro', 'Caro'));

    expect(rooms.listPublic().map((p) => p.code)).toEqual([llena, vacia]);
  });

  it('el listado no filtra ids de jugadores ni el estado de la partida', () => {
    rooms.create(player('ana', 'Ana'), 'public');
    const listing = rooms.listPublic()[0]!;

    // Lo justo para decidir si entrás, y nada más.
    expect(Object.keys(listing).sort()).toEqual([
      'ageMs',
      'code',
      'difficulty',
      // Qué juego es y cuánto dura: sin esto no se sabe si es de adivinar o de dibujar.
      'drawRounds',
      'drawSeconds',
      'flagsPerRound',
      'hostNickname',
      'kind',
      'maxPlayers',
      'mode',
      'players',
      'secondsPerFlag',
      'totalRounds',
    ]);
  });
});
