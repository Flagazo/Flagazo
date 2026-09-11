/**
 * Test de integración: levanta el servidor real en un puerto aleatorio
 * y conecta clientes Socket.IO reales.
 */
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { io as connect } from 'socket.io-client';
import type { Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents, SessionInfo } from '@flagazo/shared';
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
  clients.forEach((c) => c.disconnect());
  await server.close();
});

function openClient(token?: string) {
  const socket: ClientSocket = connect(url, {
    auth: token ? { token } : {},
    transports: ['websocket'],
    forceNew: true,
  });
  clients.push(socket);
  const ready = new Promise<SessionInfo>((resolve) => socket.once('session:ready', resolve));
  return { socket, ready };
}

function waitForOnline(socket: ClientSocket, expected: number) {
  return new Promise<void>((resolve) => {
    const handler = ({ online }: { online: number }) => {
      if (online === expected) {
        socket.off('server:presence', handler);
        resolve();
      }
    };
    socket.on('server:presence', handler);
  });
}

describe('tiempo real', () => {
  it('asigna sesión, valida nickname y restaura la sesión al reconectar', async () => {
    const a = openClient();
    const sessionA = await a.ready;
    expect(sessionA.token).toMatch(/^[a-f0-9]{48}$/);
    expect(sessionA.nickname).toBeNull();

    const invalid = await a.socket.emitWithAck('session:setNickname', { nickname: '<x>' });
    expect(invalid).toEqual({ ok: false, error: 'INVALID_CHARS' });

    const valid = await a.socket.emitWithAck('session:setNickname', { nickname: '  Anya ' });
    expect(valid).toEqual({ ok: true, data: { nickname: 'Anya' } });

    // Simula F5: nueva conexión con el mismo token.
    a.socket.disconnect();
    const again = openClient(sessionA.token);
    const restored = await again.ready;
    expect(restored.playerId).toBe(sessionA.playerId);
    expect(restored.nickname).toBe('Anya');

    // Un token inventado recibe una sesión nueva.
    const forged = openClient('f'.repeat(48));
    expect((await forged.ready).playerId).not.toBe(sessionA.playerId);
    again.socket.disconnect();
    forged.socket.disconnect();
  });

  it('difunde la cantidad de jugadores online a todos', async () => {
    const a = openClient();
    await a.ready;
    const b = openClient();
    await b.ready;
    await waitForOnline(a.socket, 2);
    b.socket.disconnect();
    await waitForOnline(a.socket, 1);
    a.socket.disconnect();
  });

  it('sincroniza reloj y sobrevive a payloads basura', async () => {
    const { socket, ready } = openClient();
    await ready;

    const sentAt = Date.now();
    const sync = await socket.emitWithAck('time:sync', { clientSentAt: sentAt });
    expect(sync.clientSentAt).toBe(sentAt);
    expect(Math.abs(sync.serverTime - Date.now())).toBeLessThan(1000);

    // Payloads inválidos y eventos sin ack no deben tirar el servidor.
    const raw = socket as unknown as { emit: (...args: unknown[]) => void; emitWithAck: (...args: unknown[]) => Promise<unknown> };
    raw.emit('session:setNickname', 'no-soy-un-objeto');
    raw.emit('session:setNickname', null);
    expect(await raw.emitWithAck('session:setNickname', [1, 2, 3])).toEqual({ ok: false, error: 'BAD_REQUEST' });
    raw.emit('evento:inexistente', { hack: true });

    const stillAlive = await socket.emitWithAck('session:setNickname', { nickname: 'Juan' });
    expect(stillAlive.ok).toBe(true);
    socket.disconnect();
  });
});
