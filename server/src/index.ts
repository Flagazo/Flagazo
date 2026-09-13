import { GAME_NAME } from '@flagazo/shared';
import { createGameServer } from './app';
import type { AccountDeps } from './auth/accounts';
import { config } from './config';
import { openDatabase } from './db/client';
import type { DatabaseHandle } from './db/client';
import { ConsoleMailer, ResendMailer } from './email/mailer';
import type { Mailer } from './email/mailer';
import { discordProvider, googleProvider } from './auth/oauth';
import type { OAuthProviderConfig } from './auth/oauth';
import { createLogger } from './lib/log';

const log = createLogger('server');

/** Secreto fijo de desarrollo: los códigos de la base local sobreviven a reinicios. Nunca en producción. */
const DEV_AUTH_SECRET = 'flagazo-dev-secret-solo-para-localhost-0123456789';

/*
 * La base se abre antes de escuchar: así las migraciones ya están aplicadas
 * cuando llega el primer pedido. Si la base no responde, el servidor arranca
 * igual con las cuentas apagadas; perder las cuentas un rato es mucho mejor que
 * dejar a todos sin poder jugar.
 */
const database = await openDatabase().catch((error: unknown) => {
  log.error(
    'No se pudo abrir la base: las cuentas quedan apagadas',
    error instanceof Error ? error.message : error,
  );
  return null;
});

const { httpServer, close } = createGameServer({ accounts: accountDeps(database), oauth: oauthOptions() });

httpServer.listen(config.port, () => {
  log.info(`${GAME_NAME} escuchando en http://localhost:${config.port}`);
  if (config.clientDist) {
    log.info('Sirviendo el cliente compilado (modo producción)');
  } else {
    log.info('Modo desarrollo: abrí el cliente en http://localhost:5173');
  }
});

/**
 * Las cuentas se encienden solo si está todo lo que necesitan. Con una pieza
 * faltante no se arranca "a medias": sin forma de mandar emails nadie podría
 * verificar su cuenta, y sin secreto los códigos no serían seguros.
 */
function accountDeps(handle: DatabaseHandle | null): AccountDeps | null {
  if (!handle) return null;
  const dev = config.runningFromSource;

  const secret = config.authSecret ?? (dev ? DEV_AUTH_SECRET : null);
  if (!secret || (!dev && secret.length < 32)) {
    log.error('Falta AUTH_SECRET (32 caracteres o más): las cuentas quedan apagadas.');
    return null;
  }

  let mailer: Mailer | null = null;
  if (config.resendApiKey) mailer = new ResendMailer(config.resendApiKey, config.emailFrom, config.emailReplyTo);
  else if (dev) mailer = new ConsoleMailer();
  if (!mailer) {
    log.error('Falta RESEND_API_KEY: sin emails no se pueden verificar cuentas, así que quedan apagadas.');
    return null;
  }

  log.info(`Cuentas encendidas · emails por ${mailer.name}${mailer.name === 'console' ? ' (se muestran acá, no se envían)' : ''}`);
  return { db: handle.db, secret, mailer, statsTimeZone: config.statsTimeZone };
}

/** Los botones de Google y Discord aparecen solo si sus credenciales están cargadas. */
function oauthOptions() {
  const providers: OAuthProviderConfig[] = [];
  if (config.google) providers.push(googleProvider(config.google.clientId, config.google.clientSecret));
  if (config.discord) providers.push(discordProvider(config.discord.clientId, config.discord.clientSecret));
  if (providers.length > 0) {
    log.info(`Inicio de sesión con: ${providers.map((provider) => provider.id).join(', ')}`);
    if (!config.publicUrl && !config.runningFromSource) {
      log.warn('Falta PUBLIC_URL: la URL de vuelta de Google y Discord se deduce de cada pedido.');
    }
  }
  return { providers, publicUrl: config.publicUrl };
}

async function shutdown(signal: string) {
  log.info(`${signal} recibido, cerrando…`);
  await close();
  await database?.close();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
