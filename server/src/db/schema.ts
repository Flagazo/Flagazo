/**
 * Esquema de la base de datos.
 *
 * Todo lo que vive acá es persistente: cuentas, sesiones, estadísticas y ranking.
 * Las parties y las partidas en curso siguen en memoria, igual que antes; un
 * invitado nunca toca la base.
 *
 * Cambiar este archivo no cambia la base. Hay que generar la migración con
 * `npm run db:generate -w server`, revisar el SQL que sale y commitearlo. El
 * servidor aplica las pendientes al arrancar.
 */
import {
  bigint,
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Tal como lo eligió: con sus mayúsculas y tildes. Es el nombre dentro del juego. */
    username: text('username').notNull(),
    /** Forma canónica (`nicknameKey`): "Juán" y "juan" chocan. */
    usernameKey: text('username_key').notNull(),
    /** Puede faltar: una cuenta de Discord sin email, por ejemplo. */
    email: text('email'),
    /** Minúsculas y sin espacios (`emailKey`). */
    emailKey: text('email_key'),
    emailVerifiedAt: timestamptz('email_verified_at'),
    /** Argon2id. null si la cuenta entra solo con Google o Discord. */
    passwordHash: text('password_hash'),
    /** Sube con cada foto nueva; va en la URL para invalidar la caché. 0 = sin foto. */
    avatarVersion: integer('avatar_version').notNull().default(0),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
    /** Último acceso: al iniciar sesión y, como mucho una vez por hora, al usarla. */
    lastSeenAt: timestamptz('last_seen_at'),
  },
  (table) => [
    uniqueIndex('users_username_key_unique').on(table.usernameKey),
    // Postgres no considera iguales dos NULL, así que muchas cuentas sin email conviven.
    uniqueIndex('users_email_key_unique').on(table.emailKey),
  ],
);

/**
 * Sesiones iniciadas.
 *
 * El navegador guarda el token en una cookie HttpOnly; acá se guarda solo su
 * SHA-256. Si la base se filtrara, con lo que hay en esta tabla no se puede
 * entrar a ninguna cuenta.
 */
export const authSessions = pgTable(
  'auth_sessions',
  {
    tokenHash: text('token_hash').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** "Mantener sesión iniciada": 30 días renovables. Si no, dura lo que el navegador. */
    persistent: boolean('persistent').notNull(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    lastSeenAt: timestamptz('last_seen_at').notNull().defaultNow(),
    expiresAt: timestamptz('expires_at').notNull(),
  },
  (table) => [
    index('auth_sessions_user_id_idx').on(table.userId),
    index('auth_sessions_expires_at_idx').on(table.expiresAt),
  ],
);

/**
 * Códigos de un solo uso que se mandan por email.
 *
 * Se guarda un HMAC del código con un secreto del servidor (`AUTH_SECRET`), no
 * el código ni un hash simple: seis dígitos son un millón de combinaciones, y
 * con un SHA-256 a secas, quien leyera esta tabla los recalcularía en un segundo.
 */
export const authCodes = pgTable(
  'auth_codes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** 'verify_email' | 'reset_password'. Un código de uno no sirve para el otro. */
    purpose: text('purpose').notNull(),
    codeHash: text('code_hash').notNull(),
    attempts: integer('attempts').notNull().default(0),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    expiresAt: timestamptz('expires_at').notNull(),
    /** Cuándo se usó. Un código usado no vuelve a servir. */
    consumedAt: timestamptz('consumed_at'),
  },
  (table) => [index('auth_codes_user_purpose_created_idx').on(table.userId, table.purpose, table.createdAt)],
);

/**
 * Cuentas de Google o Discord vinculadas a una cuenta de Flagazo.
 *
 * Se identifican por el id que da el proveedor (`sub` en Google, `id` en Discord),
 * nunca por el email: el email se puede cambiar en el proveedor, el id no.
 */
export const authIdentities = pgTable(
  'auth_identities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** 'google' | 'discord'. */
    provider: text('provider').notNull(),
    providerUserId: text('provider_user_id').notNull(),
    /** Lo que dijo el proveedor la última vez. Informativo: no se usa para entrar. */
    email: text('email'),
    emailVerified: boolean('email_verified').notNull().default(false),
    displayName: text('display_name'),
    /** Foto del proveedor, para ofrecerla como avatar. */
    avatarUrl: text('avatar_url'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    lastUsedAt: timestamptz('last_used_at').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('auth_identities_provider_user_unique').on(table.provider, table.providerUserId),
    // Una sola cuenta de cada proveedor por usuario.
    uniqueIndex('auth_identities_user_provider_unique').on(table.userId, table.provider),
  ],
);

/** Bytes crudos. Drizzle no trae `bytea` para Postgres, así que se declara acá. */
const bytea = customType<{ data: Buffer; driverData: Buffer | Uint8Array }>({
  dataType: () => 'bytea',
  // PGlite devuelve Uint8Array y `pg` devuelve Buffer: se unifica en Buffer.
  fromDriver: (value) => (Buffer.isBuffer(value) ? value : Buffer.from(value)),
});

/**
 * Fotos de perfil, ya procesadas: 256×256 en WebP, sin metadatos (unos 10–25 KB).
 *
 * Viven en la base y no en disco porque el disco del plan gratis de Render se
 * borra en cada deploy. Si algún día pesan demasiado, se mudan a un almacenamiento
 * de objetos (Cloudflare R2, S3) sin cambiar nada más: la URL pública es la misma.
 */
export const avatars = pgTable('avatars', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  content: bytea('content').notNull(),
  bytes: integer('bytes').notNull(),
  updatedAt: timestamptz('updated_at').notNull().defaultNow(),
});

// ── Estadísticas y ranking ──────────────────────────────────

/**
 * Partidas terminadas en las que jugó al menos una cuenta.
 *
 * El id lo genera el servidor al arrancar la partida. Es la llave de la
 * idempotencia: grabar la misma partida dos veces choca con la clave primaria y
 * no suma nada.
 */
export const matches = pgTable(
  'matches',
  {
    id: uuid('id').primaryKey(),
    /** 'guess' | 'draw'. */
    kind: text('kind').notNull(),
    /** Variante de Flag Guess, o null en Draw Battle. */
    mode: text('mode'),
    playerCount: integer('player_count').notNull(),
    registeredCount: integer('registered_count').notNull(),
    /** Contó para el ranking (suficientes jugadores que participaron). */
    ranked: boolean('ranked').notNull(),
    startedAt: timestamptz('started_at').notNull(),
    endedAt: timestamptz('ended_at').notNull(),
  },
  (table) => [index('matches_ended_at_idx').on(table.endedAt)],
);

/**
 * Cómo le fue a cada cuenta en cada partida. Con esto se puede reconstruir
 * cualquier estadística o ranking desde cero si algún día cambian las reglas.
 */
export const matchPlayers = pgTable(
  'match_players',
  {
    matchId: uuid('match_id')
      .notNull()
      .references(() => matches.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    placement: integer('placement').notNull(),
    won: boolean('won').notNull(),
    participated: boolean('participated').notNull(),
    /** La métrica `points` que sumó esta partida (ya ponderada). */
    points: integer('points').notNull(),
    /** Todo lo que midió el motor, tal cual, para estadísticas futuras. */
    result: jsonb('result').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.matchId, table.userId] }),
    index('match_players_user_id_idx').on(table.userId),
  ],
);

/**
 * Totales por cuenta, para el perfil sin sumar todas las partidas en cada visita.
 * Una estadística nueva es una columna nueva (con su migración) y una línea en el
 * grabador.
 */
export const userStats = pgTable('user_stats', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  gamesPlayed: integer('games_played').notNull().default(0),
  gamesWon: integer('games_won').notNull().default(0),
  guessGames: integer('guess_games').notNull().default(0),
  guessWins: integer('guess_wins').notNull().default(0),
  drawGames: integer('draw_games').notNull().default(0),
  drawWins: integer('draw_wins').notNull().default(0),
  roundsPlayed: integer('rounds_played').notNull().default(0),
  roundsWon: integer('rounds_won').notNull().default(0),
  correctAnswers: integer('correct_answers').notNull().default(0),
  wrongAnswers: integer('wrong_answers').notNull().default(0),
  missedAnswers: integer('missed_answers').notNull().default(0),
  bestStreak: integer('best_streak').notNull().default(0),
  correctMsTotal: bigint('correct_ms_total', { mode: 'number' }).notNull().default(0),
  guessPoints: bigint('guess_points', { mode: 'number' }).notNull().default(0),
  drawScore: bigint('draw_score', { mode: 'number' }).notNull().default(0),
  drawBestScore: integer('draw_best_score').notNull().default(0),
  updatedAt: timestamptz('updated_at').notNull().defaultNow(),
});

/**
 * El ranking: un valor por cuenta, período y métrica.
 *
 * Nada se borra al cambiar de mes: el ranking actual es una consulta con el mes
 * en curso, y los meses anteriores quedan ahí. `period` es `YYYY-MM` o `all`.
 * `updated_at` desempata: a igual valor, primero quien llegó antes.
 */
export const leaderboardEntries = pgTable(
  'leaderboard_entries',
  {
    period: text('period').notNull(),
    metric: text('metric').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    value: bigint('value', { mode: 'number' }).notNull(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.period, table.metric, table.userId] }),
    // La tabla de un período y una métrica, de mayor a menor.
    index('leaderboard_period_metric_value_idx').on(table.period, table.metric, table.value.desc(), table.updatedAt),
    // Los períodos de una cuenta (su historial).
    index('leaderboard_user_idx').on(table.userId, table.period),
  ],
);

export type UserRow = typeof users.$inferSelect;
export type AuthIdentityRow = typeof authIdentities.$inferSelect;
export type AuthSessionRow = typeof authSessions.$inferSelect;
export type AuthCodeRow = typeof authCodes.$inferSelect;
