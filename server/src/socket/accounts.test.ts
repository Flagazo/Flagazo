/**
 * Cuentas dentro de las salas, por socket: servidor real, base real y la cookie
 * de sesión viajando en el handshake como la manda el navegador.
 */
import type { AddressInfo } from 'node:net';
import { eq } from 'drizzle-orm';
import { io as connect } from 'socket.io-client';
import type { Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { nicknameKey } from '@flagazo/shared';
import type { ClientToServerEvents, RoomState, ServerToClientEvents, SessionInfo } from '@flagazo/shared';
import { createGameServer } from '../app';
import { SessionService } from '../auth/sessions';
import { openMemoryDatabase } from '../db/client';
import type { DatabaseHandle } from '../db/client';
import { users } from '../db/schema';
import { MemoryMailer } from '../email/mailer';

type ClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let database: DatabaseHandle;
let server: ReturnType<typeof createGameServer>;
let url: string;
const clients: ClientSocket[] = [];

beforeAll(async () => {
  database = await openMemoryDatabase();
  server = createGameServer({
    accounts: { db: database.db, mailer: new MemoryMailer(), secret: 'secreto-de-tests-con-mas-de-32-caracteres!!' },
  });
  await new Promise<void>((resolve) => server.httpServer.listen(0, resolve));
  url = `http://localhost:${(server.httpServer.address() as AddressInfo).port}`;
});

afterAll(async () => {
  clients.forEach((client) => client.disconnect());
  await server.close();
  await database.close();
});

let counter = 0;
/** Una cuenta con su cookie de sesión. */
async function account(avatarVersion = 0) {
  counter++;
  const username = `Cuenta${counter}`;
  const [user] = await database.db
    .insert(users)
    .values({ username, usernameKey: nicknameKey(username), emailVerifiedAt: new Date(), avatarVersion })
    .returning();
  const { token } = await new SessionService(database.db).create(user!.id, true);
  return { user: user!, cookie: `flagazo_sid=${token}` };
}

/** Conecta un cliente: con cookie es alguien con sesión; sin cookie, un invitado. */
async function player(options: { cookie?: string; token?: string } = {}) {
  const socket: ClientSocket = connect(url, {
    transports: ['websocket'],
    forceNew: true,
    auth: options.token ? { token: options.token } : {},
    extraHeaders: options.cookie ? { cookie: options.cookie } : {},
  });
  clients.push(socket);
  // Los estados se guardan desde el primer momento: al reconectar, la sala llega
  // pegada a session:ready y un listener agregado después se la perdería.
  const states: RoomState[] = [];
  socket.on('room:state', (room) => states.push(room));
  const session = await new Promise<SessionInfo>((resolve) => socket.once('session:ready', resolve));
  return { socket, session, states };
}

/** Espera hasta que alguno de los estados recibidos cumpla la condición. */
async function stateWhere(client: { states: RoomState[] }, match: (room: RoomState) => boolean): Promise<RoomState> {
  for (let i = 0; i < 40; i++) {
    const found = [...client.states].reverse().find(match);
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('Nunca llegó el estado esperado');
}

async function guest(nickname: string) {
  const joined = await player();
  await joined.socket.emitWithAck('session:setNickname', { nickname });
  return joined;
}

function nextState(socket: ClientSocket, match: (room: RoomState) => boolean = () => true): Promise<RoomState> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Nunca llegó el estado esperado')), 2000);
    const onState = (room: RoomState) => {
      if (!match(room)) return;
      clearTimeout(timer);
      socket.off('room:state', onState);
      resolve(room);
    };
    socket.on('room:state', onState);
  });
}

describe('cuenta y jugador', () => {
  it('con sesión iniciada, el nombre de juego es el username sin tener que escribirlo', async () => {
    const { user, cookie } = await account();
    const { session } = await player({ cookie });
    expect(session.nickname).toBe(user.username);
  });

  it('una cookie inventada o vencida entra como invitado, sin romper nada', async () => {
    const { session } = await player({ cookie: `flagazo_sid=${'x'.repeat(43)}` });
    expect(session.nickname).toBeNull();
  });

  it('con cuenta no se puede jugar con otro nombre que el username', async () => {
    const { user, cookie } = await account();
    const { socket } = await player({ cookie });
    const result = await socket.emitWithAck('session:setNickname', { nickname: 'Otro Nombre' });
    expect(result).toEqual({ ok: true, data: { nickname: user.username } });
  });

  it('invitado crea la sala y entra alguien con cuenta: cada uno se ve como es', async () => {
    const host = await guest('Anfitrión');
    const created = await host.socket.emitWithAck('party:create', {});
    if (!created.ok) throw new Error(created.error);

    const { user, cookie } = await account(3);
    const registered = await player({ cookie });
    const update = nextState(host.socket, (room) => room.players.length === 2);
    const joined = await registered.socket.emitWithAck('party:join', { code: created.data.room.code });
    expect(joined.ok).toBe(true);

    const room = await update;
    expect(room.players).toEqual([
      expect.objectContaining({ nickname: 'Anfitrión', registered: false, avatarUrl: null }),
      expect.objectContaining({
        nickname: user.username,
        registered: true,
        avatarUrl: `/api/avatars/${user.id}.webp?v=3`,
      }),
    ]);
  });

  it('alguien con cuenta crea la sala y entran invitados', async () => {
    const { cookie } = await account();
    const host = await player({ cookie });
    const created = await host.socket.emitWithAck('party:create', {});
    if (!created.ok) throw new Error(created.error);
    expect(created.data.room.players[0]).toMatchObject({ registered: true });

    const visitor = await guest('Visita');
    const joined = await visitor.socket.emitWithAck('party:join', { code: created.data.room.code });
    expect(joined.ok && joined.data.room.players.map((p) => p.registered)).toEqual([true, false]);
  });

  it('la misma cuenta no entra dos veces a la misma sala (dos pestañas)', async () => {
    const { cookie } = await account();
    const first = await player({ cookie });
    const created = await first.socket.emitWithAck('party:create', {});
    if (!created.ok) throw new Error(created.error);

    const secondTab = await player({ cookie });
    const joined = await secondTab.socket.emitWithAck('party:join', { code: created.data.room.code });
    expect(joined).toEqual({ ok: false, error: 'ACCOUNT_IN_PARTY' });
  });

  it('al reconectar (F5, corte de wifi) sigue en la sala y sigue con su cuenta', async () => {
    const { cookie } = await account();
    const first = await player({ cookie });
    const created = await first.socket.emitWithAck('party:create', {});
    if (!created.ok) throw new Error(created.error);
    first.socket.disconnect();

    const again = await player({ cookie, token: first.session.token });
    const room = await stateWhere(again, (state) => state.code === created.data.room.code);
    expect(room.code).toBe(created.data.room.code);
    expect(room.players[0]).toMatchObject({ id: first.session.playerId, registered: true, connected: true });
  });

  it('si el host con cuenta se va, la corona pasa al invitado', async () => {
    const { cookie } = await account();
    const host = await player({ cookie });
    const created = await host.socket.emitWithAck('party:create', {});
    if (!created.ok) throw new Error(created.error);
    const visitor = await guest('Heredero');
    await visitor.socket.emitWithAck('party:join', { code: created.data.room.code });

    const update = nextState(visitor.socket, (room) => room.hostId === visitor.session.playerId);
    await host.socket.emitWithAck('party:leave', {});
    const room = await update;
    expect(room.players).toEqual([expect.objectContaining({ nickname: 'Heredero', registered: false })]);
  });

  it('cerrar sesión adentro de la sala: sigue jugando con el mismo nombre, como invitado', async () => {
    const { user, cookie } = await account(1);
    const host = await player({ cookie });
    const created = await host.socket.emitWithAck('party:create', {});
    if (!created.ok) throw new Error(created.error);

    const update = nextState(host.socket, (room) => room.players[0]!.registered === false);
    expect(await host.socket.emitWithAck('session:signOut', {})).toEqual({ ok: true, data: null });
    expect((await update).players[0]).toMatchObject({ nickname: user.username, registered: false, avatarUrl: null });
  });

  it('cambiar el username o la foto se ve en la sala al refrescar la cuenta', async () => {
    const { user, cookie } = await account();
    const host = await player({ cookie });
    const created = await host.socket.emitWithAck('party:create', {});
    if (!created.ok) throw new Error(created.error);

    const renamed = `Renombrado${counter}`;
    await database.db
      .update(users)
      .set({ username: renamed, usernameKey: nicknameKey(renamed), avatarVersion: 5 })
      .where(eq(users.id, user.id));

    const update = nextState(host.socket, (room) => room.players[0]!.nickname === renamed);
    expect(await host.socket.emitWithAck('session:refreshAccount', {})).toEqual({ ok: true, data: { nickname: renamed } });
    expect((await update).players[0]).toMatchObject({ avatarUrl: `/api/avatars/${user.id}.webp?v=5` });
  });

  it('refrescar no sirve para tomar una cuenta: un invitado sigue siendo invitado', async () => {
    const visitor = await guest('Curioso');
    expect(await visitor.socket.emitWithAck('session:refreshAccount', {})).toEqual({ ok: true, data: { nickname: 'Curioso' } });
  });

  it('si su username ya lo usa un invitado de la sala, se queda con el nombre que tenía', async () => {
    const { user, cookie } = await account();
    // Entra primero como invitado con otro nombre, y un invitado toma su username.
    const tab = await guest('Temporal');
    const created = await tab.socket.emitWithAck('party:create', {});
    if (!created.ok) throw new Error(created.error);
    const other = await guest(user.username);
    await other.socket.emitWithAck('party:join', { code: created.data.room.code });

    // Ahora esa misma pestaña inicia sesión (reconecta con la cookie).
    tab.socket.disconnect();
    const signedIn = await player({ cookie, token: tab.session.token });
    const room = await stateWhere(signedIn, (state) => state.players.length === 2);
    const me = room.players.find((p) => p.id === tab.session.playerId)!;
    expect(me).toMatchObject({ nickname: 'Temporal', registered: true });
  });
});

describe('sin cuentas en el servidor', () => {
  it('todos juegan como invitados, como siempre', async () => {
    const bare = createGameServer();
    await new Promise<void>((resolve) => bare.httpServer.listen(0, resolve));
    const bareUrl = `http://localhost:${(bare.httpServer.address() as AddressInfo).port}`;
    try {
      const socket: ClientSocket = connect(bareUrl, {
        transports: ['websocket'],
        forceNew: true,
        extraHeaders: { cookie: 'flagazo_sid=cualquiera' },
      });
      clients.push(socket);
      await new Promise((resolve) => socket.once('session:ready', resolve));
      await socket.emitWithAck('session:setNickname', { nickname: 'Solo' });
      const created = await socket.emitWithAck('party:create', {});
      expect(created.ok && created.data.room.players[0]).toMatchObject({ nickname: 'Solo', registered: false });
      socket.disconnect();
    } finally {
      await bare.close();
    }
  });
});
