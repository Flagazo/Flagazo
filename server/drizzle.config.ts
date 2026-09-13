import { defineConfig } from 'drizzle-kit';

/**
 * Configuración de drizzle-kit, que solo se usa para generar migraciones:
 *
 *   npm run db:generate -w server -- --name que_cambia
 *
 * No necesita conexión a ninguna base. Compara `schema.ts` con las migraciones
 * que ya hay en `drizzle/` y escribe el SQL que falta.
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
});
