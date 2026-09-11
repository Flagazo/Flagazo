import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['shared/src/**/*.test.ts', 'server/src/**/*.test.ts'],
    environment: 'node',
    // Los tests de integración levantan un servidor real y esperan fases de la
    // partida (la revelación dura 4 segundos), así que 5 s por defecto no alcanza.
    testTimeout: 15_000,
  },
});
