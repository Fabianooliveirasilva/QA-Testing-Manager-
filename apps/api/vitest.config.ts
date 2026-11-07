import { existsSync, readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

// Integration tests read TEST_DATABASE_URL from the environment, falling back to the root .env.
const rootEnv = new URL('../../.env', import.meta.url);
if (!process.env.TEST_DATABASE_URL && existsSync(rootEnv)) {
  const line = readFileSync(rootEnv, 'utf-8')
    .split('\n')
    .find((l) => l.startsWith('TEST_DATABASE_URL='));
  if (line) process.env.TEST_DATABASE_URL = line.slice('TEST_DATABASE_URL='.length).trim();
}

export default defineConfig({
  test: {
    // Integration files share one real PostgreSQL database; run files serially.
    fileParallelism: false,
    projects: [
      {
        test: {
          name: 'unit',
          include: ['src/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'integration',
          include: ['tests/**/*.test.ts'],
          environment: 'node',
          globalSetup: ['tests/global-setup.ts'],
          testTimeout: 30_000,
          hookTimeout: 120_000,
        },
      },
    ],
  },
});
