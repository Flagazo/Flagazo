import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
// Funciona igual desde src/ (desarrollo con tsx) y desde dist/ (producción).
const serverRoot = path.resolve(here, '..');

/**
 * Las banderas del juego, bajadas de Wikimedia Commons con `npm run build:flags`.
 *
 * Se guardan en el repo con su proporción oficial. Antes se usaba `flag-icons`,
 * pero redibuja todo a 4:3 y eso deforma a las que no tienen esa proporción
 * (Suiza es cuadrada, Qatar es 11:28, Nepal ni siquiera es rectangular).
 */
function resolveFlagsDir(): string {
  const dir = path.join(serverRoot, 'flags');
  if (!existsSync(dir)) {
    throw new Error(`No están las banderas en ${dir}. Corré: npm run build:flags`);
  }
  return dir;
}

/**
 * Sello del set de banderas: el archivo modificado más recientemente.
 *
 * Va como `?v=` en cada URL para poder cachearlas un año sin quedar pegado a
 * una versión vieja. Sin esto, volver a correr `build:flags` no le cambia nada
 * a quien ya tenga las anteriores guardadas en el navegador.
 */
function resolveFlagsVersion(dir: string): string {
  let newest = 0;
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.svg')) continue;
    newest = Math.max(newest, statSync(path.join(dir, file)).mtimeMs);
  }
  return Math.round(newest).toString(36);
}

const clientDist = path.resolve(serverRoot, '..', 'client', 'dist');

const flagsDir = resolveFlagsDir();

export const config = {
  port: Number(process.env.PORT) || 3001,
  flagsDir,
  /** Sello del set de banderas. Viaja como ?v= para invalidar la caché al cambiarlas. */
  flagsVersion: resolveFlagsVersion(flagsDir),
  /** Si existe el build del cliente, el servidor también lo sirve (modo producción). */
  clientDist: existsSync(path.join(clientDist, 'index.html')) ? clientDist : null,
  /** Una sesión sin sockets conectados se borra pasado este tiempo. */
  sessionTtlMs: 60 * 60 * 1000,

  // ── Cuentas ──
  /**
   * Postgres de las cuentas. Es un secreto (lleva usuario y contraseña): vive en
   * las variables de entorno de Render, nunca en el repo.
   *
   * Sin esta variable, en producción las cuentas quedan apagadas y el juego
   * funciona igual que siempre. En desarrollo se usa una base embebida.
   */
  databaseUrl: process.env.DATABASE_URL?.trim() || null,
  /** Las migraciones SQL generadas por drizzle-kit. */
  migrationsDir: path.join(serverRoot, 'drizzle'),
  /**
   * Corriendo con tsx desde `src/` (desarrollo) y no desde el `dist/` compilado.
   * Solo en ese caso vale la base embebida: en producción, sin `DATABASE_URL` las
   * cuentas se apagan en vez de guardarse en un disco que Render borra.
   */
  runningFromSource: path.basename(here) === 'src',
  /** Dónde guarda sus datos la base embebida de desarrollo. */
  devDatabaseDir: path.join(serverRoot, '.data', 'pglite'),
  /**
   * Secreto para firmar los códigos que llegan por email. Al menos 32 caracteres
   * aleatorios. Si cambia, los códigos pendientes dejan de servir (nada más).
   */
  authSecret: process.env.AUTH_SECRET?.trim() || null,
  /** Clave de la API de Resend, con permiso solo para enviar. */
  resendApiKey: process.env.RESEND_API_KEY?.trim() || null,
  /** Remitente. El dominio tiene que estar verificado en Resend. */
  emailFrom: process.env.EMAIL_FROM?.trim() || 'Flagazo <flagazo@flagazo.com>',
  /** A dónde van las respuestas a esos emails. Vacío = al mismo remitente. */
  emailReplyTo: process.env.EMAIL_REPLY_TO?.trim() || null,
  /**
   * La dirección pública del sitio, sin barra final. Con ella se arma la URL a la
   * que vuelven Google y Discord, que tiene que coincidir exacto con la registrada
   * en cada uno. En producción: https://flagazo.com
   */
  publicUrl: process.env.PUBLIC_URL?.trim().replace(/\/+$/, '') || null,
  /**
   * Huso horario del ranking mensual: define en qué mes cae una partida jugada cerca
   * de la medianoche del último día. Nombre IANA, como "America/Argentina/Buenos_Aires".
   */
  statsTimeZone: validTimeZone(process.env.LEADERBOARD_TIMEZONE?.trim()) ?? 'UTC',
  /** Credenciales de "Continuar con Google" (Google Cloud Console). */
  google: credentials(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET),
  /** Credenciales de "Continuar con Discord" (Discord Developer Portal). */
  discord: credentials(process.env.DISCORD_CLIENT_ID, process.env.DISCORD_CLIENT_SECRET),
} as const;

/** El huso horario si existe; si está mal escrito, null (y se usa UTC). */
function validTimeZone(zone: string | undefined): string | null {
  if (!zone) return null;
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone });
    return zone;
  } catch {
    return null;
  }
}

/** Un proveedor queda configurado solo si están las dos mitades. */
function credentials(id: string | undefined, secret: string | undefined) {
  const clientId = id?.trim();
  const clientSecret = secret?.trim();
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}
