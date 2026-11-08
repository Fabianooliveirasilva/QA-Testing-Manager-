import { existsSync, readFileSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

// E2E runs the real stack: Vite dev server → API → PostgreSQL (TEST_DATABASE_URL).
function testDatabaseUrl(): string {
  if (process.env.TEST_DATABASE_URL) return process.env.TEST_DATABASE_URL;
  const envFile = new URL('../../.env', import.meta.url);
  const line = existsSync(envFile) ? readFileSync(envFile, 'utf-8').split('\n').find((l) => l.startsWith('TEST_DATABASE_URL=')) : undefined;
  if (!line) throw new Error('TEST_DATABASE_URL is required for E2E tests');
  return line.slice('TEST_DATABASE_URL='.length).trim();
}

const API_PORT = 4100;
const WEB_PORT = 5174;
const databaseUrl = testDatabaseUrl();

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }], ['json', { outputFile: 'test-results/e2e-report.json' }]] : [['list'], ['json', { outputFile: 'test-results/e2e-report.json' }]],
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'pnpm --filter @qtm/api exec prisma migrate deploy && pnpm --filter @qtm/api exec tsx src/server.ts',
      url: `http://localhost:${API_PORT}/api/health`,
      cwd: '../..',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        NODE_ENV: 'test',
        DATABASE_URL: databaseUrl,
        API_PORT: String(API_PORT),
        WEB_ORIGIN: `http://localhost:${WEB_PORT}`,
        APP_URL: `http://localhost:${WEB_PORT}`,
        STORAGE_LOCAL_DIR: './storage-e2e',
        AI_PROVIDER: 'none',
        LOG_LEVEL: 'warn',
      },
    },
    {
      command: `pnpm exec vite --port ${WEB_PORT} --strictPort`,
      url: `http://localhost:${WEB_PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: { VITE_API_PROXY: `http://localhost:${API_PORT}` },
    },
  ],
});
