import { defineConfig, devices } from '@playwright/test';

/** The game server port for e2e (override with HHT_E2E_PORT when 2567 is busy, e.g. a running `pnpm dev`). */
const PORT = process.env.HHT_E2E_PORT ?? '2567';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  retries: 0,
  // software-rendered browsers are heavy; multiplayer specs open two pages each
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4173',
    launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] },
  },
  webServer: [
    {
      // the authoritative game server (in-memory db, dev cheats for tests) — feature 002
      command: 'pnpm --filter @hht/server start',
      env: { HHT_DB: ':memory:', HHT_DEV_CHEATS: '1', HHT_METRICS: '1', HHT_PORT: PORT, HHT_SHIFT_MINUTES: '60', HHT_MM_PER_MIN: '100000' },
      url: `http://localhost:${PORT}/api/health`,
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: 'pnpm build && pnpm preview',
      env: { HHT_SERVER: `http://localhost:${PORT}` },
      url: 'http://localhost:4173',
      // always a fresh build (a stale preview without the /api proxy silently falls back to solo)
      reuseExistingServer: false,
      timeout: 180_000,
    },
  ],
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'], launchOptions: {} } },
    { name: 'webkit', use: { ...devices['Desktop Safari'], launchOptions: {} } },
  ],
});
