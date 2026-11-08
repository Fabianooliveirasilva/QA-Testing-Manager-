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

const SECURITY_SUITES = ['tests/security.test.ts', 'tests/access-control.test.ts', 'tests/auth.test.ts', 'tests/attachments.test.ts'];
const dbProject = {
  environment: 'node' as const,
  globalSetup: ['tests/global-setup.ts'],
  testTimeout: 30_000,
  hookTimeout: 120_000,
};

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
          exclude: SECURITY_SUITES,
          ...dbProject,
        },
      },
      {
        // Access control, authentication, upload and attack-payload tests (OWASP-focused).
        test: { name: 'security', include: SECURITY_SUITES, ...dbProject },
      },
    ],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/server.ts'],
      reporter: ['text-summary', 'json-summary', 'html', 'lcov'],
      reportsDirectory: 'coverage',
      // Ratchet set just below the measured baseline (2026-11-08: L 94.5 / S 92.0 / F 93.2 / B 77.2).
      thresholds: { lines: 92, statements: 90, functions: 90, branches: 75 },
    },
  },
});
