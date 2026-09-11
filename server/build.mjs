// Empaqueta el servidor en un único archivo dist/index.js.
// Incluye el código de @flagazo/shared (que es TypeScript) y deja afuera
// el resto de dependencias de node_modules (express, socket.io, …).
import { build } from 'esbuild';

await build({
  entryPoints: ['src/index.ts'],
  outfile: 'dist/index.js',
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  sourcemap: true,
  logLevel: 'info',
  plugins: [
    {
      name: 'external-node-modules',
      setup(b) {
        b.onResolve({ filter: /^[^./]/ }, (args) => {
          if (args.path.startsWith('@flagazo/')) return undefined; // se empaqueta
          return { path: args.path, external: true };
        });
      },
    },
  ],
});
