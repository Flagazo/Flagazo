import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const SERVER_URL = 'http://localhost:3001';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Expone el dev server en la red local para probar desde el celular.
    host: true,
    // En desarrollo, Vite reenvía al servidor de juego todo lo que no es frontend.
    // Así el cliente siempre habla con "su mismo origen", igual que en producción.
    proxy: {
      '/socket.io': { target: SERVER_URL, ws: true },
      // La bandera activa, servida por token aleatorio mientras se juega.
      // Sin esta línea Vite responde su propio index.html y la imagen no carga.
      '/flag/r': SERVER_URL,
      '/flags': SERVER_URL,
      '/health': SERVER_URL,
    },
  },
});
