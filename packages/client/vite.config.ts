import { defineConfig } from 'vite';

/** Same-origin dev/preview: the game server (packages/server, :2567) is reached through /api and /ws (research R14). */
const SERVER = process.env.HHT_SERVER ?? 'http://localhost:2567';
const proxy = {
  '/api': { target: SERVER, changeOrigin: true },
  '/ws': { target: SERVER, changeOrigin: true, ws: true },
};

export default defineConfig({
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 2500,
  },
  server: { host: false, proxy },
  preview: { proxy },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
} as Parameters<typeof defineConfig>[0]);
