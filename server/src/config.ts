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
} as const;
