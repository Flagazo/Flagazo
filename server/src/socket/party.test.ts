/**
 * Test de integración de parties: servidor real, sockets reales.
 * Verifica el contrato tal como lo ve el cliente, no la lógica interna
 * (eso ya lo cubre RoomManager.test.ts).
 */
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { io as connect } from 'socket.io-client';
import type { Socket } from 'socket.io-client';
import type { ClientToServerEvents, RoomState, ServerToClientEvents } from '@flagazo/shared';
import { createGameServer } from '../app';

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

/** Conecta un cliente y le pone nickname. Devuelve el socket y su playerId. */
async function newPlayer(nickname: string) {
  const socket: ClientSocket = connect(url, { transports: ['websocket'], forceNew: true });
  clients.push(socket);
  const session = await new Promise<{ playerId: string }>((resolve) =>
    socket.once('session:ready', resolve),
  );
  await socket.emitWithAck('session:setNickname', { nickname });
  return { socket, id: session.playerId };
}

/** Espera el próximo evento del servidor, con límite para no colgar el test. */
function next<E extends 'room:state' | 'room:left'>(
  socket: ClientSocket,
  event: E,
): Promise<E extends 'room:state' ? RoomState : { code: string; reason: string }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Nunca llegó "${event}"`)), 2000);
    socket.once(event as 'room:state', (payload) => {
      clearTimeout(timer);
      resolve(payload as never);
    });
  });
}

describe('parties por socket', () => {
  it('exige nickname antes de tocar parties', async () => {
    const socket: ClientSocket = connect(url, { transports: ['websocket'], forceNew: true });
    clients.push(socket);
    await new Promise((resolve) => socket.once('session:ready', resolve));

    expect(await socket.emitWithAck('party:create', {})).toEqual({
      ok: false,
      error: 'NO_NICKNAME',
    });
    socket.disconnect();
  });

  it('le manda "room:state" a quien crea y a quien entra, no solo el ack', async () => {
    // El cliente navega al lobby cuando llega "room:state". Si solo llegara por
    // el ack, el que crea la party se quedaría mirando el menú.
    const ana = await newPlayer('AnaState');
    const anaGetsState = next(ana.socket, 'room:state');
    const created = await ana.socket.emitWithAck('party:create', {});
    if (!created.ok) throw new Error(created.error);
    expect((await anaGetsState).code).toBe(created.data.room.code);

    const bea = await newPlayer('BeaState');
    const beaGetsState = next(bea.socket, 'room:state');
    await bea.socket.emitWithAck('party:join', { code: created.data.room.code });
    expect((await beaGetsState).players).toHaveLength(2);

    ana.socket.disconnect();
    bea.socket.disconnect();
  });

  it('crea, se une, configura, expulsa y bloquea el reingreso', async () => {
    const ana = await newPlayer('Ana');
    const bea = await newPlayer('Bea');

    // ── Crear ──
    const created = await ana.socket.emitWithAck('party:create', {});
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const code = created.data.room.code;
    expect(created.data.room.hostId).toBe(ana.id);
    expect(created.data.room.players).toHaveLength(1);

    // ── Unirse: quien entra lo recibe por ack, el resto por broadcast ──
    const anaSeesBea = next(ana.socket, 'room:state');
    const joined = await bea.socket.emitWithAck('party:join', { code: code.toLowerCase() });
    expect(joined.ok).toBe(true);
    expect((await anaSeesBea).players.map((p) => p.nickname)).toEqual(['Ana', 'Bea']);

    // ── Solo el host configura ──
    expect(await bea.socket.emitWithAck('party:updateSettings', { settings: { totalRounds: 5 } }))
      .toEqual({ ok: false, error: 'NOT_HOST' });

    const beaSeesSettings = next(bea.socket, 'room:state');
    const updated = await ana.socket.emitWithAck('party:updateSettings', {
      settings: { difficulty: 'hard', secondsPerFlag: 30 },
    });
    expect(updated.ok).toBe(true);
    expect((await beaSeesSettings).settings).toMatchObject({
      difficulty: 'hard',
      secondsPerFlag: 30,
    });

    // Un valor fuera de las opciones permitidas no se acepta "a medias".
    expect(await ana.socket.emitWithAck('party:updateSettings', { settings: { totalRounds: 7 } }))
      .toEqual({ ok: false, error: 'BAD_REQUEST' });

    // ── Banderas por ronda: número escrito, no una opción de lista ──
    // Con 3 rondas (el default) entran hasta 33 por ronda sin pasar el tope de 100.
    const beaSeesFlags = next(bea.socket, 'room:state');
    expect((await ana.socket.emitWithAck('party:updateSettings', { settings: { flagsPerRound: 30 } })).ok)
      .toBe(true);
    expect((await beaSeesFlags).settings.flagsPerRound).toBe(30);

    // Fuera del rango escribible o con decimales, no entra.
    for (const flagsPerRound of [4, 101, 12.5, -3]) {
      expect(await ana.socket.emitWithAck('party:updateSettings', { settings: { flagsPerRound } }))
        .toEqual({ ok: false, error: 'BAD_REQUEST' });
    }
    // Dentro del rango pero pasándose del tope de la partida: el error es otro.
    expect(await ana.socket.emitWithAck('party:updateSettings', { settings: { flagsPerRound: 100 } }))
      .toEqual({ ok: false, error: 'INVALID_SETTINGS' });

    // ── Expulsar ──
    const beaKicked = next(bea.socket, 'room:left');
    expect(await ana.socket.emitWithAck('party:kick', { playerId: bea.id })).toEqual({
      ok: true,
      data: null,
    });
    expect(await beaKicked).toEqual({ code, reason: 'kicked' });

    // ── El expulsado no puede volver ──
    expect(await bea.socket.emitWithAck('party:join', { code })).toEqual({
      ok: false,
      error: 'KICKED',
    });

    ana.socket.disconnect();
    bea.socket.disconnect();
  });

  it('rechaza códigos inválidos y nicknames repetidos', async () => {
    const ana = await newPlayer('Ana2');
    const clon = await newPlayer('ana2'); // mismo nombre, distinta capitalización

    const created = await ana.socket.emitWithAck('party:create', {});
    if (!created.ok) throw new Error(created.error);
    const { code } = created.data.room;

    expect(await clon.socket.emitWithAck('party:join', { code: 'nope' })).toEqual({
      ok: false,
      error: 'INVALID_CODE',
    });
    expect(await clon.socket.emitWithAck('party:join', { code })).toEqual({
      ok: false,
      error: 'NICK_TAKEN',
    });

    ana.socket.disconnect();
    clon.socket.disconnect();
  });

  it('restaura la party al reconectar con el mismo token', async () => {
    const socket: ClientSocket = connect(url, { transports: ['websocket'], forceNew: true });
    clients.push(socket);
    const session = await new Promise<{ token: string }>((resolve) =>
      socket.once('session:ready', resolve),
    );
    await socket.emitWithAck('session:setNickname', { nickname: 'Caro' });

    const created = await socket.emitWithAck('party:create', {});
    if (!created.ok) throw new Error(created.error);
    const { code } = created.data.room;
    socket.disconnect();

    // Simula F5: mismo token de sesión, socket nuevo.
    const back: ClientSocket = connect(url, {
      auth: { token: session.token },
      transports: ['websocket'],
      forceNew: true,
    });
    clients.push(back);
    const restored = await next(back, 'room:state');

    expect(restored.code).toBe(code);
    expect(restored.players[0]).toMatchObject({ nickname: 'Caro', connected: true });
    back.disconnect();
  });
});

describe('salas públicas por el cable', () => {
  it('una party privada no se lista y una pública sí', async () => {
    const ana = await newPlayer('Ana-pub');
    const mirona = await newPlayer('Mirona');

    const created = await ana.socket.emitWithAck('party:create', {});
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const code = created.data.room.code;
    // Sin decir nada nace privada.
    expect(created.data.room.visibility).toBe('private');

    const before = await mirona.socket.emitWithAck('party:list', {});
    expect(before.ok).toBe(true);
    if (before.ok) expect(before.data.parties.map((p) => p.code)).not.toContain(code);

    expect(await ana.socket.emitWithAck('party:setVisibility', { visibility: 'public' })).toEqual({
      ok: true,
      data: { visibility: 'public' },
    });

    const after = await mirona.socket.emitWithAck('party:list', {});
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    const listed = after.data.parties.find((p) => p.code === code);
    expect(listed).toMatchObject({ hostNickname: 'Ana-pub', players: 1 });

    await ana.socket.emitWithAck('party:leave', {});
  });

  it('se puede crear pública de una y entrar desde la lista sin tener el código', async () => {
    const ana = await newPlayer('Ana-lista');
    const bea = await newPlayer('Bea-lista');

    const created = await ana.socket.emitWithAck('party:create', { visibility: 'public' });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const code = created.data.room.code;

    // Bea nunca vio el código: lo saca del listado, que es justamente el punto.
    const list = await bea.socket.emitWithAck('party:list', {});
    expect(list.ok).toBe(true);
    if (!list.ok) return;
    const found = list.data.parties.find((p) => p.hostNickname === 'Ana-lista');
    expect(found).toBeDefined();

    const joined = await bea.socket.emitWithAck('party:join', { code: found!.code });
    expect(joined.ok).toBe(true);
    if (joined.ok) expect(joined.data.room.players).toHaveLength(2);

    await bea.socket.emitWithAck('party:leave', {});
    await ana.socket.emitWithAck('party:leave', {});
    expect(code).toBe(found!.code);
  });

  it('el listado no exige nickname: mirar se puede antes de decidir nada', async () => {
    const anonimo: ClientSocket = connect(url, { transports: ['websocket'], forceNew: true });
    clients.push(anonimo);
    await new Promise((resolve) => anonimo.once('session:ready', resolve));

    const list = await anonimo.emitWithAck('party:list', {});
    expect(list.ok).toBe(true);
  });

  it('rechaza una visibilidad inventada en vez de tratarla como privada', async () => {
    const ana = await newPlayer('Ana-basura');

    expect(
      await ana.socket.emitWithAck('party:create', {
        visibility: 'secreta' as 'public',
      }),
    ).toEqual({ ok: false, error: 'BAD_REQUEST' });

    const created = await ana.socket.emitWithAck('party:create', {});
    expect(created.ok).toBe(true);

    expect(
      await ana.socket.emitWithAck('party:setVisibility', { visibility: 'siempre' as 'public' }),
    ).toEqual({ ok: false, error: 'BAD_REQUEST' });

    await ana.socket.emitWithAck('party:leave', {});
  });

  it('solo el host la puede publicar', async () => {
    const ana = await newPlayer('Ana-host');
    const bea = await newPlayer('Bea-host');

    const created = await ana.socket.emitWithAck('party:create', {});
    if (!created.ok) throw new Error(created.error);
    await bea.socket.emitWithAck('party:join', { code: created.data.room.code });

    expect(
      await bea.socket.emitWithAck('party:setVisibility', { visibility: 'public' }),
    ).toEqual({ ok: false, error: 'NOT_HOST' });

    await bea.socket.emitWithAck('party:leave', {});
    await ana.socket.emitWithAck('party:leave', {});
  });
});
