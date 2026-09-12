/**
 * Test de integración de la partida: servidor real, sockets reales.
 *
 * Verifica el contrato tal como lo vive el cliente — arrancar, responder,
 * revelar y jugar la revancha — sin depender de la lógica interna del motor
 * (eso lo cubre FlagGuessGame.test.ts).
 */
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { io as connect } from 'socket.io-client';
import type { Socket } from 'socket.io-client';
import type {
  ClientToServerEvents,
  GuessSnapshot,
  RoomState,
  ServerToClientEvents,
} from '@flagazo/shared';
import { createGameServer } from '../app';
import { resolveFlagToken } from '../game/flagTokens';
import { getCountry } from '../data/countries';

type ClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let server: ReturnType<typeof createGameServer>;
let url: string;
const clients: ClientSocket[] = [];

beforeAll(async () => {
  server = createGameServer();
  await new Promise<void>((resolve) => server.httpServer.listen(0, resolve));
  url = `http://localhost:${(server.httpServer.address() as AddressInfo).port}`;
});

afterAll(async () => {
  clients.forEach((client) => client.disconnect());
  await server.close();
});

async function newPlayer(nickname: string) {
  const socket: ClientSocket = connect(url, { transports: ['websocket'], forceNew: true });
  clients.push(socket);
  const session = await new Promise<{ playerId: string }>((resolve) =>
    socket.once('session:ready', resolve),
  );
  await socket.emitWithAck('session:setNickname', { nickname });
  return { socket, id: session.playerId };
}

/** Espera el próximo `room:state` que cumpla una condición. */
function waitForRoom(
  socket: ClientSocket,
  matches: (room: RoomState) => boolean,
  what: string,
  timeoutMs = 10_000,
): Promise<RoomState> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off('room:state', handler);
      reject(new Error(`Nunca llegó un estado con ${what}`));
    }, timeoutMs);
    const handler = (room: RoomState) => {
      if (!matches(room)) return;
      clearTimeout(timer);
      socket.off('room:state', handler);
      resolve(room);
    };
    socket.on('room:state', handler);
  });
}

const inPhase = (phase: string) => (room: RoomState) => room.game?.phase === phase;

/** Este archivo prueba Flag Guess: la partida es siempre de adivinar. */
const guess = (room: RoomState) => room.game as GuessSnapshot | null;

/** Crea una party de un solo jugador con la configuración más corta posible. */
async function soloParty(nickname: string, secondsPerFlag = 10) {
  const player = await newPlayer(nickname);
  const created = await player.socket.emitWithAck('party:create', {});
  if (!created.ok) throw new Error(created.error);

  const updated = await player.socket.emitWithAck('party:updateSettings', {
    settings: { totalRounds: 1, flagsPerRound: 5, secondsPerFlag },
  });
  if (!updated.ok) throw new Error(updated.error);

  return { ...player, code: created.data.room.code };
}

/** Qué país es la bandera activa, resolviendo el token igual que hace el servidor. */
function countryOf(room: RoomState): string {
  const token = guess(room)?.flagUrl?.split('/').pop() ?? '';
  const id = resolveFlagToken(token);
  if (!id) throw new Error(`El token "${token}" no resolvió a ningún país`);
  return id;
}

describe('partida por socket', () => {
  it('solo el host arranca, y no dos veces', async () => {
    const ana = await soloParty('AnaGame');
    const bea = await newPlayer('BeaGame');
    await bea.socket.emitWithAck('party:join', { code: ana.code });

    expect(await bea.socket.emitWithAck('game:start', {})).toEqual({
      ok: false,
      error: 'NOT_HOST',
    });

    const started = waitForRoom(ana.socket, inPhase('countdown'), 'la cuenta regresiva');
    expect((await ana.socket.emitWithAck('game:start', {})).ok).toBe(true);
    const room = await started;

    expect(room.phase).toBe('playing');
    expect(room.game?.totalRounds).toBe(1);
    expect(room.game?.players).toHaveLength(2);

    // Ya está en curso: no se puede volver a arrancar.
    expect(await ana.socket.emitWithAck('game:start', {})).toEqual({
      ok: false,
      error: 'ALREADY_PLAYING',
    });

    ana.socket.disconnect();
    bea.socket.disconnect();
  });

  it('acepta la respuesta correcta y la revela cuando termina la bandera', async () => {
    const ana = await soloParty('AnaAnswer');

    const flagUp = waitForRoom(ana.socket, inPhase('flag'), 'una bandera activa');
    await ana.socket.emitWithAck('game:start', {});
    const room = await flagUp;

    // La URL de la bandera activa no dice qué país es.
    expect(guess(room)?.flagUrl).toMatch(/^\/flag\/r\/[a-f0-9]{32}$/);
    expect(room.game?.reveal).toBeNull();

    const country = getCountry(countryOf(room))!;
    // Al ser el único jugador, responder cierra la bandera al instante: hay que
    // estar escuchando la revelación antes de mandar la respuesta.
    const revealing = waitForRoom(ana.socket, inPhase('reveal'), 'la revelación');

    const answered = await ana.socket.emitWithAck('game:answer', {
      // Se responde con el nombre en español; el matcher acepta 78 idiomas.
      text: country.displayName.es,
    });
    expect(answered).toEqual({ ok: true, data: { verdict: 'correct' } });

    const revealed = await revealing;
    expect(guess(revealed)?.reveal?.countryId).toBe(country.id);
    expect(guess(revealed)?.reveal?.flagUrl).toMatch(
      new RegExp(`^/flags/${country.id.toLowerCase()}\\.svg\\?v=.`),
    );
    expect(guess(revealed)?.outcomes[0]).toMatchObject({ correct: true });

    ana.socket.disconnect();
  });

  it('rechaza una segunda respuesta y valida el payload', async () => {
    // Con dos jugadores la bandera sigue abierta después de que responde uno;
    // con uno solo se cerraría al instante y el error sería otro.
    const ana = await soloParty('AnaTwice');
    const bea = await newPlayer('BeaTwice');
    await bea.socket.emitWithAck('party:join', { code: ana.code });

    const flagUp = waitForRoom(ana.socket, inPhase('flag'), 'una bandera activa');
    await ana.socket.emitWithAck('game:start', {});
    await flagUp;

    expect(await ana.socket.emitWithAck('game:answer', { text: 42 as unknown as string })).toEqual({
      ok: false,
      error: 'BAD_REQUEST',
    });

    const first = await ana.socket.emitWithAck('game:answer', { text: 'una respuesta cualquiera' });
    expect(first).toEqual({ ok: true, data: { verdict: 'wrong' } });

    expect(await ana.socket.emitWithAck('game:answer', { text: 'otra' })).toEqual({
      ok: false,
      error: 'ALREADY_ANSWERED',
    });

    ana.socket.disconnect();
    bea.socket.disconnect();
  });

  it('no se puede responder si no hay partida', async () => {
    const ana = await soloParty('AnaIdle');
    expect(await ana.socket.emitWithAck('game:answer', { text: 'Chile' })).toEqual({
      ok: false,
      error: 'NOT_PLAYING',
    });
    ana.socket.disconnect();
  });

  it('juega una partida entera y vuelve al lobby con la revancha', async () => {
    // Un segundo por bandera: la partida completa dura pocos segundos.
    const ana = await soloParty('AnaFull', 10);
    // 5 banderas × 4 s de revelación + la cuenta regresiva: hay que darle aire.
    const done = waitForRoom(ana.socket, inPhase('results'), 'el final de la partida', 45_000);

    await ana.socket.emitWithAck('game:start', {});

    // Responder cada bandera apenas aparece acelera la partida hasta el final.
    ana.socket.on('room:state', (room) => {
      if (room.game?.phase !== 'flag') return;
      const player = room.game.players[0];
      if (player?.answered) return;
      const country = getCountry(countryOf(room));
      void ana.socket.emitWithAck('game:answer', { text: country?.displayName.es ?? 'x' });
    });

    const finished = await done;
    expect(finished.phase).toBe('results');
    // Acertó las 5 banderas de la única ronda, así que se la lleva.
    expect(finished.game?.players[0]?.roundsWon).toBe(1);

    // La revancha vuelve al lobby conservando la party y su configuración.
    const backToLobby = waitForRoom(ana.socket, (room) => room.game === null, 'la vuelta al lobby');
    expect((await ana.socket.emitWithAck('game:rematch', {})).ok).toBe(true);
    const lobby = await backToLobby;

    expect(lobby.phase).toBe('lobby');
    expect(lobby.code).toBe(ana.code);
    expect(lobby.settings).toMatchObject({ totalRounds: 1, flagsPerRound: 5 });

    ana.socket.disconnect();
  }, 60_000);

  it('la revancha solo vale con la partida terminada', async () => {
    const ana = await soloParty('AnaEarly');
    expect(await ana.socket.emitWithAck('game:rematch', {})).toEqual({
      ok: false,
      error: 'NOT_PLAYING',
    });

    const flagUp = waitForRoom(ana.socket, inPhase('flag'), 'una bandera activa');
    await ana.socket.emitWithAck('game:start', {});
    await flagUp;

    expect(await ana.socket.emitWithAck('game:rematch', {})).toEqual({
      ok: false,
      error: 'GAME_NOT_FINISHED',
    });

    ana.socket.disconnect();
  });
});
