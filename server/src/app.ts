import { createServer } from 'node:http';
import path from 'node:path';
import express from 'express';
import { Server } from 'socket.io';
import { config } from './config';
import { SessionStore } from './socket/SessionStore';
import { resolveFlagToken, sweepFlagTokens } from './game/flagTokens';
import { createRoomManager } from './socket/partyChannel';
import { registerSocketHandlers } from './socket/registerSocketHandlers';
import type { GameServer } from './types';

/**
 * Construye la app completa (HTTP + Socket.IO) sin empezar a escuchar.
 * index.ts la arranca; los tests la levantan en un puerto aleatorio.
 */
export function createGameServer() {
  const app = express();
  app.disable('x-powered-by');

  app.get('/health', (_req, res) => {
    res.json({ ok: true, uptime: Math.round(process.uptime()) });
  });

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
    // Límite de tamaño por mensaje: ningún evento legítimo del juego se acerca a esto.
    maxHttpBufferSize: 16_000,
  });

  const sessions = new SessionStore(config.sessionTtlMs);
  const rooms = createRoomManager(io, sessions);
  registerSocketHandlers(io, sessions, rooms);

  const sweepTimer = setInterval(() => {
    sessions.sweep();
    sweepFlagTokens();
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
