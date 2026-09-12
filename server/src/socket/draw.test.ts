/**
 * Draw Battle de punta a punta: servidor real, sockets reales.
 *
 * La lógica de rondas y desempates la cubre `DrawBattleGame.test.ts`. Acá se
 * verifica el contrato tal como lo vive el cliente: elegir el juego, arrancar,
 * mandar el dibujo por el socket y recibir la revelación.
 */
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { io as connect } from 'socket.io-client';
import type { Socket } from 'socket.io-client';
import { DRAW_LIMITS, encodeDrawing } from '@flagazo/shared';
import type { ClientToServerEvents, DrawSnapshot, RoomState, ServerToClientEvents, Stroke } from '@flagazo/shared';
import { createGameServer } from '../app';
import { drawing, ellipse } from '../game/draw/fixtures';

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
  await new Promise((resolve) => socket.once('session:ready', resolve));
  await socket.emitWithAck('session:setNickname', { nickname });
  return socket;
}

function waitForDraw(socket: ClientSocket, phase: string, timeoutMs = 10_000): Promise<DrawSnapshot> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`nunca llegó la fase ${phase}`)), timeoutMs);
    const handler = (room: RoomState) => {
      if (room.game?.kind !== 'draw' || room.game.phase !== phase) return;
      clearTimeout(timer);
      socket.off('room:state', handler);
      resolve(room.game);
    };
    socket.on('room:state', handler);
  });
}

async function drawParty(nickname: string) {
  const socket = await newPlayer(nickname);
  const created = await socket.emitWithAck('party:create', {});
  if (!created.ok) throw new Error(created.error);
  const updated = await socket.emitWithAck('party:updateSettings', {
    settings: { kind: 'draw', drawRounds: 5, drawSeconds: 30 },
  });
  if (!updated.ok) throw new Error(updated.error);
  return socket;
}

describe('Draw Battle por socket', () => {
  it('se elige, se dibuja, se manda y se revela con puntaje', async () => {
    const ana = await drawParty('AnaDraw');

    const drawingUp = waitForDraw(ana, 'drawing');
    expect((await ana.emitWithAck('game:start', {})).ok).toBe(true);
    const round = await drawingUp;
    expect(round.prompt?.mode).toBe('name');

    // Es el único jugador: mandar el final cierra la ronda al instante.
    const revealing = waitForDraw(ana, 'reveal');
    const sent = await ana.emitWithAck('draw:submit', {
      round: round.round,
      drawing: encodeDrawing(drawing(ellipse('red', 300, 200, 120, 120))),
      final: true,
    });
    expect(sent).toEqual({ ok: true, data: null });

    const reveal = (await revealing).reveal!;
    expect(reveal.entries).toHaveLength(1);
    expect(reveal.entries[0]!.score).toBeGreaterThanOrEqual(0);
    expect(reveal.flag.flagUrl).toMatch(/^\/flags\/[a-z]{2}\.svg\?v=/);
    ana.disconnect();
  });

  it('no deja responder en Draw Battle ni dibujar en Flag Guess', async () => {
    const ana = await drawParty('AnaWrong');
    const drawingUp = waitForDraw(ana, 'drawing');
    await ana.emitWithAck('game:start', {});
    await drawingUp;

    expect(await ana.emitWithAck('game:answer', { text: 'Japón' })).toEqual({ ok: false, error: 'WRONG_GAME' });
    ana.disconnect();

    const bea = await newPlayer('BeaWrong');
    await bea.emitWithAck('party:create', {});
    const started = new Promise((resolve) => bea.once('room:state', resolve));
    await bea.emitWithAck('game:start', {});
    await started;
    expect(
      await bea.emitWithAck('draw:submit', { round: 1, drawing: encodeDrawing(drawing()), final: true }),
    ).toEqual({ ok: false, error: 'WRONG_GAME' });
    bea.disconnect();
  });

  it('valida la forma del payload y el contenido del dibujo', async () => {
    // Los envíos inválidos no bloquean al jugador, así que la ronda sigue abierta.
    const ana = await drawParty('AnaPayload');
    const drawingUp = waitForDraw(ana, 'drawing');
    await ana.emitWithAck('game:start', {});
    const round = await drawingUp;

    expect(
      await ana.emitWithAck('draw:submit', { round: '1' as unknown as number, drawing: '1|', final: true }),
    ).toEqual({ ok: false, error: 'BAD_REQUEST' });
    expect(
      await ana.emitWithAck('draw:submit', { round: round.round, drawing: 'iVBORw0KGgo=', final: true }),
    ).toEqual({ ok: false, error: 'INVALID_DRAWING' });
    ana.disconnect();
  });

  it('un dibujo grande dentro de los topes entra por el socket', async () => {
    // Se manda como borrador: no cierra la ronda y deja ver que el socket sigue vivo.
    const ana = await drawParty('AnaBig');
    const drawingUp = waitForDraw(ana, 'drawing');
    await ana.emitWithAck('game:start', {});
    const round = await drawingUp;

    // Trazos de zigzag con saltos largos (el peor caso del formato), cerca del tope.
    const strokes: Stroke[] = [];
    let encoded = '';
    for (let s = 0; encoded.length < DRAW_LIMITS.maxEncodedLength * 0.8; s++) {
      const points: number[] = [];
      for (let i = 0; i < 60; i++) points.push(i % 2 === 0 ? 0 : 600, (i * 6 + s) % 400);
      strokes.push({ tool: 'brush', size: 1, color: 'blue', points });
      encoded = encodeDrawing({ strokes });
    }
    expect(encoded.length).toBeGreaterThan(30_000);

    const sent = await ana.emitWithAck('draw:submit', { round: round.round, drawing: encoded, final: false });
    expect(sent).toEqual({ ok: true, data: null });
    expect(ana.connected).toBe(true);
    ana.disconnect();
  });
});
