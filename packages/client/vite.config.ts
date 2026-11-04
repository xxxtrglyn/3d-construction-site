import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 2500,
  },
  server: { host: false },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
} as Parameters<typeof defineConfig>[0]);
