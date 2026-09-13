import { createServer } from 'node:http';
import path from 'node:path';
import express from 'express';
import { Server } from 'socket.io';
import { config } from './config';
import { SessionStore } from './socket/SessionStore';
import { resolveFlagToken, sweepFlagTokens } from './game/flagTokens';
import { createApiRouter } from './http/api';
import type { ApiLimits, OAuthOptions } from './http/api';
import type { AccountDeps } from './auth/accounts';
import type { ProfileOptions } from './auth/profile';
import { createLogger } from './lib/log';
import { createAccountResolver } from './socket/accounts';
import { StatsRecorder } from './stats/recorder';
import { createRoomManager } from './socket/partyChannel';
import { registerSocketHandlers } from './socket/registerSocketHandlers';
import type { GameServer } from './types';

export interface GameServerOptions {
  /** Lo que necesitan las cuentas (base, secreto, emails). Sin esto el juego funciona igual, sin cuentas. */
  accounts?: AccountDeps | null;
  apiLimits?: ApiLimits;
  /** Google y Discord, si están configurados. */
  oauth?: OAuthOptions;
  /** Para los tests: de dónde se bajan las fotos de los proveedores. */
  profile?: ProfileOptions;
}

const log = createLogger('server');

/**
 * Construye la app completa (HTTP + Socket.IO) sin empezar a escuchar.
 * index.ts la arranca; los tests la levantan en un puerto aleatorio.
 */
export function createGameServer(options: GameServerOptions = {}) {
  const app = express();
  app.disable('x-powered-by');
  /*
   * Render pone un proxy delante que termina el HTTPS. Con esto Express confía en
   * sus X-Forwarded-*: sabe que el pedido fue seguro (para marcar la cookie como
   * Secure) y cuál es la IP real (para limitar intentos por IP). Un solo salto:
   * confiar en más dejaría a cualquiera inventarse la IP con un header.
   */
  app.set('trust proxy', 1);

  app.get('/health', (_req, res) => {
    res.json({ ok: true, uptime: Math.round(process.uptime()) });
  });

  // Cuentas. Antes que el frontend, para que /api nunca caiga en el index.html.
  // Las salas se arman más abajo: la API avisa a través de esto cuando ya existen.
  let forgetAccount: (userId: string) => void = () => {};
  const api = createApiRouter(options.accounts ?? null, options.apiLimits, options.oauth, options.profile, {
    onAccountDeleted: (userId) => forgetAccount(userId),
  });
  app.use('/api', api.router);

  /**
   * Bandera activa, servida por un token aleatorio.
   *
   * Va antes que /flags a propósito: mientras se está jugando, la imagen se pide
   * por un id que no dice nada, así el país no aparece en la pestaña de red del
   * navegador. Sin caché, porque el token vale para una sola bandera.
   */
  app.get('/flag/r/:token', (req, res) => {
    const countryId = resolveFlagToken(String(req.params.token));
    if (!countryId || !/^[A-Z]{2}$/.test(countryId)) {
      res.status(404).end();
      return;
    }
    res.setHeader('Cache-Control', 'no-store');
    res.sendFile(path.join(config.flagsDir, `${countryId.toLowerCase()}.svg`));
  });

  /*
   * Banderas locales (Wikimedia Commons). Ej: /flags/ar.svg?v=abc123
   * Se usan una vez revelado el país, cuando ya no hay nada que esconder.
   *
   * La caché es corta a propósito: el archivo cambia de contenido sin cambiar
   * de nombre cada vez que se corre `build:flags`, y una caché larga dejaba a
   * los jugadores con banderas viejas durante días. El `?v=` de las URLs que
   * arma el servidor termina de asegurar que se vea el set actual.
   */
  app.use('/flags', express.static(config.flagsDir, { maxAge: '1h', etag: true }));
  app.use('/flags', (_req, res) => {
    res.status(404).end();
  });

  // En producción, el mismo servidor sirve el frontend compilado.
  if (config.clientDist) {
    const indexHtml = path.join(config.clientDist, 'index.html');
    app.use(express.static(config.clientDist, { index: false, maxAge: '1h' }));
    app.use((req, res, next) => {
      if (req.method !== 'GET' || !req.accepts('html')) return next();
      res.sendFile(indexHtml);
    });
  }

  const httpServer = createServer(app);
  const io: GameServer = new Server(httpServer, {
    /*
     * Límite de tamaño por mensaje, contra abusos.
     *
     * Era 16 KB hasta Draw Battle. Un dibujo son trazos, no una imagen, y con los
     * topes de `DRAW_LIMITS` el más grande posible ronda los 48 KB: 64 KB le da
     * lugar sin dejar de cortar a quien intente mandar megabytes.
     */
    maxHttpBufferSize: 64_000,
  });

  const sessions = new SessionStore(config.sessionTtlMs);
  /*
   * Al terminar cada partida se graban las estadísticas de quienes jugaron con
   * cuenta. Sin esperar: la sala sigue a resultados enseguida, y si la base falla
   * solo se pierde el registro de esa partida, nunca la partida.
   */
  const recorder = options.accounts ? new StatsRecorder(options.accounts.db, options.accounts.statsTimeZone ?? 'UTC') : null;
  const rooms = createRoomManager(io, sessions, recorder ? (match) => {
    recorder.record(match).catch((error: unknown) => {
      log.error('No se pudieron grabar las estadísticas de la partida', error instanceof Error ? error.message : error);
    });
  } : undefined);
  const socketHandlers = registerSocketHandlers(io, sessions, rooms, options.accounts ? createAccountResolver(options.accounts.db) : null);
  forgetAccount = socketHandlers.forgetAccount;

  const sweepTimer = setInterval(() => {
    sessions.sweep();
    sweepFlagTokens();
    api.sweep().catch((error: unknown) => {
      log.warn('No se pudieron limpiar las sesiones vencidas', error instanceof Error ? error.message : error);
    });
  }, 5 * 60 * 1000);
  sweepTimer.unref();

  return {
    app,
    httpServer,
    io,
    sessions,
    rooms,
    async close() {
      clearInterval(sweepTimer);
      rooms.dispose();
      await io.close();
    },
  };
}
