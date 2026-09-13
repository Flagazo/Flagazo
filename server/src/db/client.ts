import { mkdirSync } from 'node:fs';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { config } from '../config';
import { createLogger } from '../lib/log';
import * as schema from './schema';

const log = createLogger('db');

/**
 * La base, sea cual sea el motor de abajo.
 *
 * En producción es Postgres de verdad (`pg`); en desarrollo y en los tests,
 * PGlite, que es Postgres compilado a WebAssembly y corre dentro del proceso.
 * Los dos hablan el mismo SQL, así que el resto del código no distingue.
 */
export type Database = PgDatabase<PgQueryResultHKT, typeof schema>;

export interface DatabaseHandle {
  db: Database;
  close(): Promise<void>;
}

/**
 * Abre la base que corresponda y le aplica las migraciones pendientes.
 *
 * Devuelve null si no hay ninguna configurada: el servidor arranca igual, con
 * las cuentas apagadas. Mejor eso que un deploy caído por una variable faltante.
 */
export async function openDatabase(): Promise<DatabaseHandle | null> {
  if (config.databaseUrl) return openPostgres(config.databaseUrl);
  if (config.runningFromSource) {
    mkdirSync(config.devDatabaseDir, { recursive: true });
    log.info(`Sin DATABASE_URL: base embebida de desarrollo en ${config.devDatabaseDir}`);
    return openPglite(config.devDatabaseDir);
  }
  log.warn('Sin DATABASE_URL: las cuentas quedan apagadas. El juego funciona igual.');
  return null;
}

/** Base vacía en memoria, con el esquema al día. Para los tests. */
export function openMemoryDatabase(): Promise<DatabaseHandle> {
  return openPglite();
}

async function openPostgres(url: string): Promise<DatabaseHandle> {
  const { Pool } = await import('pg');
  const { drizzle } = await import('drizzle-orm/node-postgres');
  const { migrate } = await import('drizzle-orm/node-postgres/migrator');

  /*
   * Pocas conexiones a propósito: hay una sola instancia y las consultas son
   * cortas. El SSL lo pide la propia URL (`sslmode=require`), como la entrega Neon.
   */
  const pool = new Pool({ connectionString: url, max: 5, idleTimeoutMillis: 30_000 });
  // Un error de una conexión ociosa (la base reinició, se cortó la red) no debe
  // tirar el proceso: el pool la descarta y abre otra en la próxima consulta.
  pool.on('error', (error) => log.error('Conexión de Postgres caída', error.message));

  const db = drizzle(pool, { schema });
  await migrate(db, { migrationsFolder: config.migrationsDir });
  log.info('Postgres conectado y con las migraciones al día');
  return { db: db as unknown as Database, close: () => pool.end() };
}

async function openPglite(dataDir?: string): Promise<DatabaseHandle> {
  const { PGlite } = await import('@electric-sql/pglite');
  const { drizzle } = await import('drizzle-orm/pglite');
  const { migrate } = await import('drizzle-orm/pglite/migrator');

  const client = new PGlite(dataDir);
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: config.migrationsDir });
  return { db: db as unknown as Database, close: () => client.close() };
}
