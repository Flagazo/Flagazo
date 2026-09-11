import { GAME_NAME } from '@flagazo/shared';
import { createGameServer } from './app';
import { config } from './config';
import { createLogger } from './lib/log';

const log = createLogger('server');
const { httpServer, close } = createGameServer();

httpServer.listen(config.port, () => {
  log.info(`${GAME_NAME} escuchando en http://localhost:${config.port}`);
  if (config.clientDist) {
    log.info('Sirviendo el cliente compilado (modo producción)');
  } else {
    log.info('Modo desarrollo: abrí el cliente en http://localhost:5173');
  }
});

async function shutdown(signal: string) {
  log.info(`${signal} recibido, cerrando…`);
  await close();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
