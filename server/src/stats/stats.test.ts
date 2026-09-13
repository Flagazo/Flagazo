/**
 * Estadísticas y ranking, de punta a punta:
 * 1. la sala avisa una sola vez que terminó la partida, con las cuentas del arranque;
 * 2. el grabador escribe estadísticas y ranking en la base real, sin contar dos veces;
 * 3. la API muestra la tabla del mes y la posición propia.
 */
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { COUNTDOWN_MS, REVEAL_MS, nicknameKey } from '@flagazo/shared';
import type { ApiResult, LeaderboardResponse, UserStatsSummary } from '@flagazo/shared';
import { createGameServer } from '../app';
import { SessionService } from '../auth/sessions';
import { openMemoryDatabase } from '../db/client';
import type { DatabaseHandle } from '../db/client';
import { leaderboardEntries, matchPlayers, userStats, users } from '../db/schema';
import { MemoryMailer } from '../email/mailer';
import { getCountry } from '../data/countries';
import type { PlayerResult } from '../game/Game';
import type { FlagGuessGame } from '../game/FlagGuessGame';
import type { PlayerAccount } from '../rooms/Room';
import { RoomManager } from '../rooms/RoomManager';
import type { FinishedMatch } from '../rooms/RoomManager';
import { StatsRecorder, monthOf, rankingPoints } from './recorder';

// ── 1. La sala avisa ────────────────────────────────────────

describe('fin de partida', () => {
  const SECONDS = 10;
  const FLAGS = 5;
  let rooms: RoomManager;
  let finished: FinishedMatch[];

  beforeEach(() => {
    vi.useFakeTimers();
    finished = [];
    rooms = new RoomManager(
      { onState: () => {}, onPlayerRemoved: () => {}, onGameFinished: (match) => finished.push(match) },
      { hostGraceMs: 20, lobbyDisconnectMs: 40, emptyRoomMs: 60 },
    );
  });
  afterEach(() => {
    rooms.dispose();
    vi.useRealTimers();
  });

  const ana: PlayerAccount = { userId: 'u-ana', username: 'Ana', avatarUrl: null };

  function start() {
    const created = rooms.create({ id: 'ana', nickname: 'Ana', account: ana });
    if (!created.ok) throw new Error(created.error);
    rooms.join(created.data.code, { id: 'invitado', nickname: 'Invitado' });
    rooms.updateSettings('ana', { kind: 'guess', totalRounds: 1, flagsPerRound: FLAGS, secondsPerFlag: SECONDS });
    expect(rooms.startGame('ana').ok).toBe(true);
    return created.data;
  }

  /** Ana acierta todas; el invitado erra todas. */
  function play(room: ReturnType<typeof start>) {
    vi.advanceTimersByTime(COUNTDOWN_MS);
    for (let i = 0; i < FLAGS; i++) {
      const game = room.game as FlagGuessGame;
      rooms.answer('ana', getCountry(game.currentCountryId!)!.displayName.es);
      rooms.answer('invitado', 'zzzz no es un país');
      vi.advanceTimersByTime(REVEAL_MS + 10);
    }
  }

  it('avisa una sola vez, con el resultado calculado por el motor y la cuenta de cada uno', () => {
    const room = start();
    play(room);
    expect(room.phase).toBe('results');
    vi.advanceTimersByTime(10_000);

    expect(finished).toHaveLength(1);
    const [match] = finished;
    expect(match!.kind).toBe('guess');
    expect(match!.matchId).toMatch(/^[0-9a-f-]{36}$/);
    const byId = new Map(match!.players.map((player) => [player.playerId, player]));
    expect(byId.get('ana')).toMatchObject({ account: ana, won: true, placement: 1, participated: true });
    expect(byId.get('ana')!.guess).toMatchObject({ correct: FLAGS, wrong: 0 });
    expect(byId.get('invitado')).toMatchObject({ account: null, won: false, placement: 2, participated: true });
    expect(byId.get('invitado')!.guess).toMatchObject({ correct: 0, wrong: FLAGS, points: 0 });
  });

  it('las cuentas se fijan al empezar: cerrar sesión a mitad de partida no cambia a quién se le carga', () => {
    const room = start();
    rooms.setAccount('ana', null);
    play(room);
    expect(finished[0]!.players.find((player) => player.playerId === 'ana')!.account).toEqual(ana);
  });

  it('cada partida tiene su id: la revancha es otra partida', () => {
    const room = start();
    play(room);
    expect(rooms.rematch('ana').ok).toBe(true);
    expect(rooms.startGame('ana').ok).toBe(true);
    play(room);
    expect(finished).toHaveLength(2);
    expect(finished[0]!.matchId).not.toBe(finished[1]!.matchId);
  });

  it('si el grabador explota, la sala sigue como si nada', () => {
    rooms = new RoomManager(
      {
        onState: () => {},
        onPlayerRemoved: () => {},
        onGameFinished: () => {
          throw new Error('la base se cayó');
        },
      },
      { hostGraceMs: 20, lobbyDisconnectMs: 40, emptyRoomMs: 60 },
    );
    const room = start();
    expect(() => play(room)).not.toThrow();
    expect(room.phase).toBe('results');
    expect(rooms.rematch('ana').ok).toBe(true);
  });
});

// ── 2 y 3. Base y API ───────────────────────────────────────

let database: DatabaseHandle;
let server: ReturnType<typeof createGameServer>;
let url: string;
let recorder: StatsRecorder;

beforeAll(async () => {
  database = await openMemoryDatabase();
  recorder = new StatsRecorder(database.db, 'UTC');
  server = createGameServer({
    accounts: { db: database.db, mailer: new MemoryMailer(), secret: 'secreto-de-tests-con-mas-de-32-caracteres!!' },
  });
  await new Promise<void>((resolve) => server.httpServer.listen(0, resolve));
  url = `http://localhost:${(server.httpServer.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await server.close();
  await database.close();
});

let counter = 0;
async function account(name = 'Jugador') {
  counter++;
  const username = `${name}${counter}`.slice(0, 16);
  const [user] = await database.db
    .insert(users)
    .values({ username, usernameKey: nicknameKey(username), emailVerifiedAt: new Date() })
    .returning();
  const { token } = await new SessionService(database.db).create(user!.id, true);
  const playerAccount: PlayerAccount = { userId: user!.id, username, avatarUrl: null };
  return { user: user!, account: playerAccount, cookie: `flagazo_sid=${token}` };
}

function guessResult(playerId: string, overrides: Partial<PlayerResult> & { points?: number; correct?: number } = {}): PlayerResult {
  const { points = 1000, correct = 5, ...rest } = overrides;
  return {
    playerId,
    placement: 1,
    won: true,
    participated: true,
    roundsPlayed: 1,
    roundsWon: 1,
    guess: { points, correct, wrong: 1, missed: 0, bestStreak: 4, correctMsTotal: correct * 2000 },
    ...rest,
  };
}

function match(players: FinishedMatch['players'], overrides: Partial<FinishedMatch> = {}): FinishedMatch {
  return {
    matchId: randomUUID(),
    kind: 'guess',
    mode: 'normal',
    startedAt: new Date('2026-09-10T20:00:00Z'),
    endedAt: new Date('2026-09-10T20:08:00Z'),
    players,
    ...overrides,
  };
}

async function entry(userId: string, period: string, metric = 'points') {
  const rows = await database.db.select().from(leaderboardEntries).where(eq(leaderboardEntries.userId, userId));
  return rows.find((row) => row.period === period && row.metric === metric)?.value;
}

describe('grabar estadísticas', () => {
  it('suma estadísticas y ranking a las cuentas, y nada a los invitados', async () => {
    const ana = await account('Ana');
    const outcome = await recorder.record(
      match([
        { ...guessResult('p1', { points: 1200, correct: 6 }), account: ana.account },
        { ...guessResult('p2', { points: 300, correct: 2, won: false, placement: 2 }), account: null },
      ]),
    );
    expect(outcome).toBe('recorded');

    const stats = await database.db.query.userStats.findFirst({ where: eq(userStats.userId, ana.user.id) });
    expect(stats).toMatchObject({ gamesPlayed: 1, gamesWon: 1, guessGames: 1, guessWins: 1, correctAnswers: 6, guessPoints: 1200, bestStreak: 4 });
    expect(await entry(ana.user.id, '2026-09')).toBe(1200);
    expect(await entry(ana.user.id, 'all')).toBe(1200);
    expect(await entry(ana.user.id, '2026-09', 'wins')).toBe(1);
    expect(await entry(ana.user.id, '2026-09', 'correct')).toBe(6);

    // El invitado no dejó rastro: ni fila de partida, ni estadísticas.
    const rows = await database.db.select().from(matchPlayers);
    expect(rows.every((row) => row.userId !== null)).toBe(true);
  });

  it('una misma partida no se graba dos veces', async () => {
    const beto = await account('Beto');
    const once = match([
      { ...guessResult('p1', { points: 500 }), account: beto.account },
      { ...guessResult('p2', { won: false, placement: 2 }), account: null },
    ]);
    expect(await recorder.record(once)).toBe('recorded');
    expect(await recorder.record(once)).toBe('duplicate');
    expect(await Promise.all([recorder.record(once), recorder.record(once)])).toEqual(['duplicate', 'duplicate']);

    expect(await entry(beto.user.id, '2026-09')).toBe(500);
    const stats = await database.db.query.userStats.findFirst({ where: eq(userStats.userId, beto.user.id) });
    expect(stats?.gamesPlayed).toBe(1);
  });

  it('dos grabaciones simultáneas de la misma partida nueva: cuenta una sola', async () => {
    const caro = await account('Caro');
    const same = match([
      { ...guessResult('p1', { points: 700 }), account: caro.account },
      { ...guessResult('p2', { won: false, placement: 2 }), account: null },
    ]);
    const outcomes = (await Promise.allSettled([recorder.record(same), recorder.record(same)])).map((result) =>
      result.status === 'fulfilled' ? result.value : 'error',
    );
    expect(outcomes.filter((outcome) => outcome === 'recorded')).toHaveLength(1);
    expect(await entry(caro.user.id, '2026-09')).toBe(700);
  });

  it('si alguien borró su cuenta a mitad de partida, los demás igual suman', async () => {
    const eli = await account('Eli');
    const gone = await account('Ido');
    await database.db.delete(users).where(eq(users.id, gone.user.id));

    const outcome = await recorder.record(
      match([
        { ...guessResult('p1', { points: 650 }), account: eli.account },
        { ...guessResult('p2', { won: false, placement: 2 }), account: gone.account },
      ]),
    );
    expect(outcome).toBe('recorded');
    expect(await entry(eli.user.id, '2026-09')).toBe(650);
    expect(await database.db.select().from(matchPlayers).where(eq(matchPlayers.userId, gone.user.id))).toEqual([]);
  });

  it('jugando solo, suma al perfil pero no al ranking', async () => {
    const solo = await account('Solo');
    await recorder.record(match([{ ...guessResult('p1', { points: 9000 }), account: solo.account }]));
    const stats = await database.db.query.userStats.findFirst({ where: eq(userStats.userId, solo.user.id) });
    expect(stats?.gamesPlayed).toBe(1);
    expect(await entry(solo.user.id, '2026-09')).toBeUndefined();

    // Con otro jugador que solo miró (no respondió nada), tampoco.
    await recorder.record(
      match([
        { ...guessResult('p1', { points: 9000 }), account: solo.account },
        { ...guessResult('p2', { participated: false, won: false, placement: 2, points: 0, correct: 0 }), account: null },
      ]),
    );
    expect(await entry(solo.user.id, '2026-09')).toBeUndefined();
  });

  it('el cambio de mes no borra el mes anterior', async () => {
    const dani = await account('Dani');
    const rival = (id: string) => ({ ...guessResult(id, { won: false, placement: 2 }), account: null });
    await recorder.record(match([{ ...guessResult('p1', { points: 800 }), account: dani.account }, rival('p2')], {
      endedAt: new Date('2026-08-31T23:50:00Z'),
    }));
    await recorder.record(match([{ ...guessResult('p1', { points: 200 }), account: dani.account }, rival('p2')], {
      endedAt: new Date('2026-09-01T00:10:00Z'),
    }));
    expect(await entry(dani.user.id, '2026-08')).toBe(800);
    expect(await entry(dani.user.id, '2026-09')).toBe(200);
    expect(await entry(dani.user.id, 'all')).toBe(1000);
  });

  it('Draw Battle suma con su peso, para compararse parejo con Flag Guess', () => {
    const draw: PlayerResult = {
      playerId: 'p1',
      placement: 1,
      won: true,
      participated: true,
      roundsPlayed: 10,
      roundsWon: 4,
      draw: { totalScore: 600, bestScore: 88, drawings: 10 },
    };
    expect(rankingPoints(draw)).toBe(3600);
    expect(rankingPoints(guessResult('p1', { points: -30 }))).toBe(0);
  });

  it('el mes depende del huso horario elegido', () => {
    // 23:30 del 30 de septiembre en Buenos Aires ya es 1 de octubre en UTC.
    const lateNight = new Date('2026-10-01T02:30:00Z');
    expect(monthOf(lateNight, 'UTC')).toBe('2026-10');
    expect(monthOf(lateNight, 'America/Argentina/Buenos_Aires')).toBe('2026-09');
  });
});

describe('ranking por la API', () => {
  const period = '2031-03';
  const ended = new Date('2031-03-15T12:00:00Z');

  async function playWith(players: Array<{ account: PlayerAccount | null; points: number; at?: Date }>) {
    for (const player of players) {
      await recorder.record(
        match(
          [
            { ...guessResult('yo', { points: player.points }), account: player.account },
            { ...guessResult('rival', { won: false, placement: 2, points: 10 }), account: null },
          ],
          { endedAt: player.at ?? ended },
        ),
      );
    }
  }

  async function table(query = '', cookie?: string) {
    const response = await fetch(`${url}/api/leaderboard/monthly${query}`, { headers: cookie ? { cookie } : {} });
    return (await response.json()) as ApiResult<LeaderboardResponse>;
  }

  it('ordena por puntos, empates comparten puesto (primero quien llegó antes) y no aparece ningún invitado', async () => {
    const primero = await account('Primero');
    const empateA = await account('EmpateA');
    const empateB = await account('EmpateB');
    await playWith([
      { account: primero.account, points: 5000 },
      { account: empateA.account, points: 3000, at: new Date('2031-03-10T10:00:00Z') },
      { account: empateB.account, points: 3000, at: new Date('2031-03-12T10:00:00Z') },
      { account: null, points: 99_999 },
    ]);

    const result = await table(`?period=${period}`);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.entries.map((row) => [row.rank, row.username, row.value])).toEqual([
      [1, primero.account.username, 5000],
      [2, empateA.account.username, 3000],
      [2, empateB.account.username, 3000],
    ]);
    expect(result.data.me).toBeNull();
    expect(result.data.periods).toContain(period);
  });

  it('con sesión, trae la posición propia aunque no esté entre los primeros', async () => {
    const lejano = '2031-04';
    const at = new Date('2031-04-10T12:00:00Z');
    // Se llena la tabla con 50 cuentas por encima.
    for (let i = 0; i < 50; i++) {
      const top = await account('Top');
      await database.db.insert(leaderboardEntries).values({ period: lejano, metric: 'points', userId: top.user.id, value: 10_000 + i, updatedAt: at });
    }
    const yo = await account('Yo');
    await database.db.insert(leaderboardEntries).values({ period: lejano, metric: 'points', userId: yo.user.id, value: 42, updatedAt: at });

    const result = await table(`?period=${lejano}`, yo.cookie);
    if (!result.ok) throw new Error(result.error);
    expect(result.data.entries).toHaveLength(50);
    expect(result.data.me).toMatchObject({ rank: 51, username: yo.account.username, value: 42 });
  });

  it('sin período pide el mes actual; valida período y métrica', async () => {
    const current = await table();
    expect(current.ok && current.data.period).toBe(monthOf(new Date(), 'UTC'));
    expect(current.ok && current.data.metric).toBe('points');

    expect((await table('?period=2026-13')).ok).toBe(false);
    expect((await table("?period=2026-09'--")).ok).toBe(false);
    expect((await table('?metric=dinero')).ok).toBe(false);
    expect((await table('?period=all&metric=wins')).ok).toBe(true);
  });

  it('las estadísticas del perfil, calculadas en el servidor', async () => {
    const eva = await account('Eva');
    await playWith([{ account: eva.account, points: 1500 }]);
    await recorder.record(
      match(
        [
          {
            playerId: 'yo',
            placement: 2,
            won: false,
            participated: true,
            roundsPlayed: 10,
            roundsWon: 3,
            draw: { totalScore: 500, bestScore: 91, drawings: 10 },
            account: eva.account,
          },
          { ...guessResult('rival'), account: null },
        ],
        { kind: 'draw', mode: null },
      ),
    );

    const response = await fetch(`${url}/api/me/stats`, { headers: { cookie: eva.cookie } });
    const body = (await response.json()) as ApiResult<UserStatsSummary>;
    expect(body).toMatchObject({
      ok: true,
      data: {
        gamesPlayed: 2,
        gamesWon: 1,
        guessGames: 1,
        drawGames: 1,
        correctAnswers: 5,
        averageAnswerMs: 2000,
        drawBestScore: 91,
        totalPoints: 1500 + 500 * 6,
      },
    });

    expect((await fetch(`${url}/api/me/stats`)).status).toBe(401);
  });
});
